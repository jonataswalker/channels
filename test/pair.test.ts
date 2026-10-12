// Pairing a terminal with a person's seat by a code approved in the browser (pair.ts): no key is
// ever copied, the relay only carries a box sealed to the terminal's one-time key, and a code the
// relay could grind doesn't exist (both sides fix their nonce before seeing the other's).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "../src/client.ts";
import { generateIdentity, type Identity } from "../src/identity.ts";
import { browserCode, codeFor, pairCode, pairCommit, pairNonce, sealedTo, type Chosen, type PairRow } from "../src/pair.ts";
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

describe("the browser trusts only what it fixed when the person chose the terminal", () => {
  test("a relay that swaps the key or commit, or keeps another nonce, gets no code", async () => {
    const room = "0123456789abcdef0123456789abcdef";
    const t = await generateIdentity("pair");
    const nt = pairNonce();
    const listed: PairRow = { id: "x", pk: t.pk, xpk: t.xpk!, commit: await pairCommit(room, t.pk, t.xpk!, nt), wnonce: null, tnonce: null, ts: 0 };
    const c: Chosen = { nonce: pairNonce(), pk: listed.pk, xpk: listed.xpk, commit: listed.commit, kept: null };
    c.kept = c.nonce;
    const revealed = { ...listed, wnonce: c.nonce, tnonce: nt };
    const good = await browserCode(room, c, revealed);
    expect(good).toBe(await pairCode(room, t.pk, t.xpk!, nt, c.nonce));
    // The relay lists a nonce it ground instead of the browser's: the browser still uses its own.
    expect(await browserCode(room, c, { ...revealed, wnonce: pairNonce() })).toBe(good);
    // It swaps in its own key and a commit for it after the person chose: nothing.
    const evil = await generateIdentity("evil");
    const ne = pairNonce();
    expect(await browserCode(room, c, { ...revealed, pk: evil.pk, xpk: evil.xpk!, commit: await pairCommit(room, evil.pk, evil.xpk!, ne), tnonce: ne })).toBeNull();
    // Another browser (or an agent) opened the row first: this one shows nothing.
    expect(await browserCode(room, { ...c, kept: pairNonce() }, revealed)).toBeNull();
    // And the seat goes to the key the browser fixed, whatever the row says now.
    expect(sealedTo(c, { ...revealed, xpk: evil.xpk! }).xpk).toBe(t.xpk!);
  });
});

/** A relay in front of the real one that, once the terminal has revealed, shows it a different browser nonce. */
function grindingProxy(target: string) {
  let revealed = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
      const res = await fetch(target + url.pathname + url.search, { method: req.method, headers: req.headers, body });
      if (/\/pairs\/[0-9a-f-]{36}\/reveal$/.test(url.pathname) && res.ok) revealed = true;
      if (req.method === "GET" && /\/pairs\/[0-9a-f-]{36}$/.test(url.pathname) && revealed) {
        const j = (await res.json()) as { wnonce: string | null };
        return Response.json({ ...j, wnonce: pairNonce() });
      }
      return new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers });
    },
  });
  return { url: server.url.origin, stop: () => server.stop(true) };
}

async function terminal(code: string, relayUrl: string, env: Record<string, string> = {}) {
  const term = mkdtempSync(join(tmpdir(), "kiwi-pair-term-"));
  made.push(term);
  const p = Bun.spawn([...MC, "tui", code], { cwd: term, env: { ...process.env, KIWI_HOME: term, KIWI_RELAY: relayUrl, KIWI_NO_HOOKS: "1", ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let out = "";
  const read = async (s: ReadableStream<Uint8Array>) => {
    const r = s.getReader();
    for (;;) {
      const { value, done } = await r.read();
      if (done) return;
      out += new TextDecoder().decode(value);
    }
  };
  const reading = Promise.all([read(p.stdout), read(p.stderr)]);
  return { term, p, output: () => out, done: async () => ((await p.exited), await reading, out) };
}

/** The person's browser: choose the only waiting terminal, wait for its reveal, and return the code it shows. */
async function chooseAndCode(browser: Channel, room: string) {
  const row = await until(async () => (await runIt(browser.fx.pairs()))[0], "a pairing to show up");
  const c: Chosen = { nonce: pairNonce(), pk: row.pk, xpk: row.xpk, commit: row.commit, kept: null };
  c.kept = await runIt(browser.fx.pairOpen(row.id, c.nonce));
  const revealed = await until(async () => (await runIt(browser.fx.pairs())).find((x) => x.id === row.id && x.tnonce), "the terminal's reveal");
  return { row: revealed, c, code: await browserCode(room, c, revealed) };
}

describe("kiwi tui <join code>", () => {
  test("the terminal shows a code, the browser approves the same one, and the seat arrives sealed", async () => {
    const owner = await generateIdentity("human");
    const made_ = await Channel.create(relay, owner, { name: "human" });
    const browser = new Channel(made_.access, relay, owner);
    const t = await terminal(made_.code, relay);
    const pending = await until(async () => (await runIt(browser.fx.pairs()))[0], "a pairing to show up");
    // It says what it is, for the person to tell terminals apart.
    expect(pending.label).toContain("@");
    // Answering before the terminal shows a code is refused.
    await expect(runIt(browser.fx.pairAnswer(pending, owner))).rejects.toThrow("hasn't shown a code");
    const { row, c, code } = await chooseAndCode(browser, made_.access.roomId);
    expect(code).toMatch(/^\d{3}-\d{3}$/);
    await until(async () => t.output().includes(`code ${code}`), "the same code in the terminal");
    await runIt(browser.fx.pairAnswer(sealedTo(c, row), owner));
    const out = await t.done();
    expect(t.p.exitCode).toBe(0);
    expect(out).toContain("approved.");
    const room = readdirSync(join(t.term, "identities"))[0]!;
    const kept = JSON.parse(readFileSync(join(t.term, "identities", room, "human.json"), "utf8")) as Identity;
    expect(kept.pk).toBe(owner.pk);
    expect(await runIt(browser.fx.pairs())).toEqual([]);
  });

  test("a relay that shows the terminal another browser nonce after it revealed is caught", async () => {
    const owner = await generateIdentity("human");
    const made_ = await Channel.create(relay, owner, { name: "human" });
    const browser = new Channel(made_.access, relay, owner);
    const proxy = grindingProxy(relay);
    try {
      const t = await terminal(made_.code, proxy.url);
      await chooseAndCode(browser, made_.access.roomId);
      const out = await t.done();
      expect(t.p.exitCode).not.toBe(0);
      expect(out).toContain("changed after this terminal showed its code");
      expect(readdirSyncSafe(join(t.term, "identities"))).toEqual([]);
    } finally {
      proxy.stop();
    }
  });

  test("never inside an agent's harness: the seat would land where the agent can read it", async () => {
    const owner = await generateIdentity("human");
    const made_ = await Channel.create(relay, owner, { name: "human" });
    const t = await terminal(made_.code, relay, { CLAUDECODE: "1" });
    const out = await t.done();
    expect(t.p.exitCode).toBe(1);
    expect(out).toContain("run kiwi tui in a terminal of your own");
    expect(await runIt(new Channel(made_.access, relay, owner).fx.pairs())).toEqual([]);
  });
});

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
