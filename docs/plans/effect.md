# Plan: the backend on Effect 4

> Owner's ask (#460): "our backend to be full Effect TS", pointing at
> https://effect.website/docs/v4/onboarding. This is the plan for review before
> any code. Effect 4.0.2 is current on npm.

## What "backend" covers

| Part | Files | Lines | Runs in |
| --- | --- | --- | --- |
| Relay core (shared) | `src/relay/room.ts`, `policy.ts`, `human.ts`, `devices.ts`, `machines.ts`, `vault.ts` | ~2,000 | Worker and Bun |
| Relay adapters | `src/relay/worker.ts` (Durable Objects), `src/relay/bun.ts` (bun:sqlite) | ~670 | one each |
| Client library | `src/client.ts`, `agent.ts`, `config.ts`, `machine.ts`, `hooks.ts` | ~2,300 | Bun (and `client.ts` in the browser) |
| CLI and MCP | `src/cli/*.ts`, `src/mcp.ts`, `src/sh.ts` | ~1,700 | Bun binary |
| Pure core | `protocol.ts`, `state.ts`, `crypto.ts`, `identity.ts`, `membership.ts`, `sas.ts`, `vault.ts`, `format.ts`, `load.ts` | ~1,900 | everywhere |

## Ground rules

1. **Nothing in `src/` moves until the 0.7.0 batch lands.** Six approved
   branches touch it; a rewrite under them means rebasing all six.
2. **The wire protocol, storage layout and crypto don't change.** A relay on
   Effect talks to 0.6 clients and vice versa, and the data on disk and in
   Durable Objects stays readable. Same routes, same JSON, same error texts.
3. **One layer per PR, behind the existing tests.** The ~180 tests are the proof
   that behaviour didn't change; each PR keeps them green unmodified, except
   where a test reached into an internal that moved.
4. **The pure core stays plain functions.** `fold`, `format`, `wellFormed`,
   crypto and `sas` are already pure and synchronous or simple async. Wrapping
   them in Effect adds cost and nothing else. Effect code calls them directly.
5. **The surface the web imports stays Promise and plain data** unless the owner
   decides the web moves too (see "The web"). Effect inside, `runPromise` at the
   edge.

## How the pieces map

- **Errors become tagged failures** (`Schema.TaggedError`): `RelayError`
  (status + message), `ChannelGone` ("removed" | "closed"), `Rejected`,
  `VaultError`, and the relay's `HttpError` split by meaning (`NotMember`,
  `NotOwner`, `BadRequest`, `OverQuota`, `Conflict`…). Each maps to exactly
  the status and text it returns today, in one place, instead of 61 scattered
  `throw new HttpError` in `room.ts`. Callers use `catchTag`; nothing is caught
  by string matching (today `client.ts` checks `/removed|denied/` on messages).
- **Services become `Context.Service`s with Layers**, which is what lets the
  Worker and Bun relays share one room implementation honestly:
  - `RoomStore` (SQL: the DO's `ctx.storage.sql` or `bun:sqlite`)
  - `Directory`, `DeviceStore`, `MachineStore`, `VaultStore` (already
    interfaces today; they become services)
  - `HumanAuth` (WorkOS, dev sign-in, or none)
  - `Policy` (beta gate and quotas), `Clock` (Effect's own, so expiry and
    quota tests stop injecting `now` by hand)
  - Client side: `Relay` (the HTTP+signing `call`), `Keystore` (`~/.kiwi`
    files), `Cache` (the message cache), `Cursor`.
- **Resources become scoped**: the client WebSocket (open, ping, close on
  interrupt), the reconnect loop as a `Stream` with a `Schedule` (the backoff
  and the 30s quiet window become declarative), bun:sqlite handles, listener
  registration for the Stop hook, the MCP server. Interrupting `tail` closes
  everything, without the hand-written abort plumbing in `stream()` and
  `listen()`.
- **Request bodies get Schemas** at the relay boundary, replacing hand-written
  `typeof` checks (`wellFormed`, `version()`, `body()`, the vault and icon
  checks). The Schemas live next to the protocol types and are the single
  source for both decode and type. The *payload* validation inside encrypted
  messages (`wellFormedEvent`) can use the same Schemas later; not in step 1.
- **HTTP**: the relay's router becomes an Effect `HttpRouter` app, turned into
  a fetch handler with `HttpEffect.toWebHandler`. The Worker's `fetch`, the
  Durable Object's `fetch` and `Bun.serve` all call the same handler. WebSocket
  upgrades stay in the adapters (hibernation in the DO, Bun's `upgrade`), since
  they're runtime-specific by nature; the frame handling inside them uses the
  room service.

## Order (one PR each)

1. **Errors and Schemas only.** Add the tagged errors and request Schemas;
   `room.ts` throws them through a thin bridge so behaviour is identical. Small,
   and it sets the vocabulary.
2. **Relay core on Effect.** `room.ts`, `policy.ts`, `vault.ts`, `devices.ts`,
   `machines.ts`, `human.ts` as services and Effect handlers. Both adapters
   provide Layers. Run the suite against Bun *and* `wrangler dev`
   (`KIWI_TEST_RELAY`, plus the Worker vault test).
3. **Client: `Relay` service and the stream.** `client.ts` internals on Effect
   (calls, signing, the reconnect `Stream`), exporting the same `Channel`
   class with Promise methods for the web and CLI.
4. **Agent session, config, hooks.** `agent.ts`, `config.ts`, `machine.ts`,
   `hooks.ts` as services over the client; `listen` becomes a scoped Stream.
5. **CLI and MCP.** Commands as Effects run by one `ManagedRuntime`, errors
   rendered in one place (today each command calls `die`). The MCP tools become
   Effects too. Optionally `@effect/cli` for argument parsing; decided then, by
   whether the help output can stay as it is.

Each step is a few days, and each is shippable on its own.

## Costs, measured

- **Bundle**: a minimal program with a service, a Layer and a tagged error,
  bundled and minified for the browser, is ~81KB (27KB gzipped); `Stream` +
  `Schedule` alone ~40KB (14KB gzipped). Schema is most of it.
- **Worker**: the relay bundle grows by about that; far under the Workers size
  limit. Cold-start cost: to measure in step 2 under `wrangler dev`.
- **Binary**: +~1MB on a 64MB `kiwi` binary; negligible.
- **Web**: zero extra while the web only imports the Promise surface *and* the
  modules it imports don't pull in Effect. That needs care: `client.ts` is
  imported by the web, so step 3 keeps Effect out of the import graph the web
  sees (Effect code in separate modules the browser entry doesn't reach), or
  accepts ~30KB gzipped in the dashboard. To decide with Claude-1 in step 3.

## The web

Open question for the owner (#463, #465, #466): does the dashboard move to
Effect too?

- **If yes**: a separate step after 3 (Claude-1 owns it): the channel stream as
  an Effect `Stream`, vault and passkey steps as typed errors, services as
  Layers, React at the edge. Then the "keep Effect out of the web's import
  graph" care above goes away, and the Promise surface can shrink.
- **If no**: the web keeps calling `Channel`, `vault.ts` and friends as Promises
  and plain data, and steps 3–4 guarantee that surface.

## Risks

- **A big diff in security-sensitive code.** Mitigation: the protocol and crypto
  don't move; every step behind the full suite plus the Worker vault test;
  Coordinator reviews each step against the old code path.
- **Durable Object specifics** (hibernation, auto-responses, alarms) don't map
  onto Effect's server abstractions. Mitigation: they stay in the adapter; only
  what's inside the handlers moves.
- **Learning curve for the other agents.** Mitigation: the LLMS.md /
  effect-solutions patterns, one style guide section in `CONTRIBUTING.md`
  written in step 1 (services, errors, `Effect.fn` naming), and small PRs.

## Done means

All of `src/` except the pure core runs on Effect; one error vocabulary; the
Worker and Bun relays share one room implementation through Layers; the suite
and the Worker test pass at every step; protocol, storage and the web's surface
unchanged (or the web moved, if that's the call).
