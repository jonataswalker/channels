// Pairing a terminal with a person's seat by a code approved in the browser (pair.ts): no key is
// ever copied, the relay only carries a box sealed to the terminal's one-time key, and a code the
// relay could grind doesn't exist (both sides fix their nonce before seeing the other's).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "../src/client.ts";
import { generateIdentity, type Identity } from "../src/identity.ts";
import { codeFor, pairCode, pairCommit, pairNonce, type PairRow } from "../src/pair.ts";
import { startRelay } from "../src/relay/bun.ts";
import * as Effect from "effect/Effect";
import { AgentLive } from "../src/agent.ts";

setDefaultTimeout(60_000);

/** Channel's Effects, run as Promises against the real relay (what the browser does). */
const runIt = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);

const MC = ["bun", join(import.meta.dir, "../src/cli/main.ts")];
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-pair-relay-"));
const made: string[] = [dataDir];
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

async function until<T>(get: () => Promise<T | null | undefined>, label: string, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

describe("pairing codes", () => {
  test("a reveal that doesn't match the commit gives no code", async () => {
    const room = "0123456789abcdef0123456789abcdef";
    const t = await generateIdentity("pair");
    const nt = pairNonce();
    const nb = pairNonce();
    const p: PairRow = { id: "x", pk: t.pk, xpk: t.xpk!, commit: await pairCommit(room, t.pk, t.xpk!, nt), wnonce: nb, tnonce: nt, ts: 0 };
    expect(await codeFor(room, p)).toBe(await pairCode(room, t.pk, t.xpk!, nt, nb));
    expect(await codeFor(room, { ...p, tnonce: pairNonce() })).toBeNull();
    // A relay that swaps in its own key after the browser's nonce is out can't keep the terminal's commit.
    const evil = await generateIdentity("evil");
    expect(await codeFor(room, { ...p, xpk: evil.xpk! })).toBeNull();
    expect(await codeFor(room, { ...p, tnonce: null })).toBeNull();
  });
});

describe("kiwi tui <join code>", () => {
  test("the terminal shows a code, the browser approves the same one, and the seat arrives sealed", async () => {
    // The owner's seat, as their browser holds it.
    const owner = await generateIdentity("human");
    const made_ = await Channel.create(relay, owner, { name: "human" });
    const browser = new Channel(made_.access, relay, owner);
    const term = mkdtempSync(join(tmpdir(), "kiwi-pair-term-"));
    made.push(term);
    const p = Bun.spawn([...MC, "tui", made_.code], { cwd: term, env: { ...process.env, KIWI_HOME: term, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let out = "";
    const reader = p.stdout.getReader();
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        out += new TextDecoder().decode(value);
      }
    })();

    // The browser sees the terminal waiting, opens it with its nonce, and waits for the terminal's reveal.
    const pending = await until(async () => (await browser.fx.pairs().pipe(runIt))[0], "a pairing to show up");
    // Answering before the terminal shows a code is refused.
    await expect(browser.fx.pairAnswer(pending, owner).pipe(runIt)).rejects.toThrow("hasn't shown a code");
    await browser.fx.pairOpen(pending.id, pairNonce()).pipe(runIt);
    const ready = await until(async () => (await browser.fx.pairs().pipe(runIt)).find((x) => x.id === pending.id && x.tnonce), "the terminal's reveal");
    const browserCode = await codeFor(made_.access.roomId, ready);
    expect(browserCode).toMatch(/^\d{3}-\d{3}$/);
    await until(async () => out.includes(`code ${browserCode}`), "the same code in the terminal");

    // The person says they match: the seat goes over sealed, once.
    await browser.fx.pairAnswer(ready, owner).pipe(runIt);
    expect(await p.exited).toBe(0);
    await reading;
    expect(out).toContain("approved.");
    expect(out).toContain("Your seat is on this computer now");
    const room = readdirSync(join(term, "identities"))[0]!;
    const kept = JSON.parse(readFileSync(join(term, "identities", room, "human.json"), "utf8")) as Identity;
    expect(kept.pk).toBe(owner.pk);
    // Nothing is left waiting, and the box was handed over only once.
    expect(await browser.fx.pairs().pipe(runIt)).toEqual([]);
  });
});
