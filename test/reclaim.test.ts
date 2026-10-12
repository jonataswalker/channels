// Getting a seat back: the same key resumes; a new key takes the seat over only
// with the owner's approval, from the same person, never while unseen-online, and
// the old key is out for good.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, RelayError } from "../src/client.ts";
import { generateIdentity, type Identity } from "../src/identity.ts";
import type { JoinRequest } from "../src/membership.ts";
import { startRelay } from "../src/relay/bun.ts";
import { fold } from "../src/state.ts";
import { describeEvent } from "../src/format.ts";
import { memoryBudget } from "./check.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-reclaim-relay-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("seat reclaim", () => {
  let owner: Identity;
  let oldKey: Identity;
  let code: string;
  let ownerCh: Channel;
  let oldCh: Channel;

  beforeAll(async () => {
    owner = await generateIdentity("human");
    oldKey = await generateIdentity("win");
    const made = await Channel.create(relay, owner, { name: "human" }, [{ ...oldKey, info: { name: "win", role: "windows", about: "the PC side" } }]);
    code = made.code;
    ownerCh = new Channel(made.access, relay, owner);
    // The same key resumes without asking: nothing new is granted.
    oldCh = new Channel(await Channel.resume(relay, code, oldKey), relay, oldKey);
    const t = await oldCh.send("", { ev: { op: "task.add", title: "fix the PC edge", owner: "win" } });
    await oldCh.send("", { ev: { op: "claim", paths: ["src/pc"], ttl: 3600 } });
    await oldCh.send("", { ev: { op: "fact.set", key: "pc.ip", value: "10.0.0.9" } });
    await oldCh.send("on it", { re: [t] });
  });

  test("a key that isn't a member can't resume", async () => {
    const stranger = await generateIdentity("win");
    await expect(Channel.resume(relay, code, stranger)).rejects.toBeInstanceOf(RelayError);
  });

});

describe("kiwi join, again", () => {
  const homes: string[] = [];
  const home = () => {
    const d = mkdtempSync(join(tmpdir(), "kiwi-reclaim-"));
    homes.push(d);
    return d;
  };
  afterAll(() => {
    for (const d of homes) rmSync(d, { recursive: true, force: true });
  });
  const spawn = (dir: string, ...args: string[]) =>
    Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), ...args], {
      cwd: dir,
      env: { ...process.env, KIWI_HOME: dir, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: dir, CLAUDECODE: "" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  const run = async (dir: string, ...args: string[]) => {
    const p = spawn(dir, ...args);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out, err };
  };
  /** Retry `check` until it holds (a request reaching the relay takes a moment): no fixed sleeps. */
  const until = async (check: () => Promise<boolean>, ms = 20_000) => {
    const end = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > end) throw new Error("timed out waiting");
      await Bun.sleep(200);
    }
  };
  /** Wait for a line matching `re` on a running process's stdout. */
  const waitFor = async (p: ReturnType<typeof spawn>, re: RegExp, seen: string[]) => {
    const reader = p.stdout.getReader();
    let buf = "";
    for (;;) {
      const m = seen.join("\n").match(re) ?? buf.match(re);
      if (m) return (reader.releaseLock(), m);
      const { value, done } = await reader.read();
      if (done) throw new Error(`process ended before ${re}: ${buf}`);
      buf += new TextDecoder().decode(value);
    }
  };

});

describe("a lost key, without reclaim", () => {
  test("the owner removes the old seat, and the agent joins again under its name", async () => {
    const owner = await generateIdentity("human");
    const oldKey = await generateIdentity("win");
    const made = await Channel.create(relay, owner, { name: "human", kind: "human" }, [{ ...oldKey, info: { name: "win", kind: "agent" } }]);
    const ownerCh = new Channel(made.access, relay, owner);
    // The key is lost: asking again under the same name, from a new key, is offered the next free name.
    const newKey = await generateIdentity("win");
    const first = await Channel.requestJoin(relay, made.code, newKey, { name: "win" });
    expect((await ownerCh.requests({ budget: memoryBudget() })).find((r) => r.id === first.requestId)?.name).toBe("win-2");
    await ownerCh.deny(first.requestId);
    // So the owner removes the old seat; then the same name is free for a new key.
    await ownerCh.remove(oldKey.pk);
    const again = await generateIdentity("win");
    const ask = await Channel.requestJoin(relay, made.code, again, { name: "win" });
    const r = (await ownerCh.requests({ budget: memoryBudget() })).find((x) => x.id === ask.requestId)!;
    expect(r.name).toBe("win");
    if (r.check !== "ready") {
      await Channel.joinStatus(relay, made.code, again, ask.requestId);
    }
    await ownerCh.approve((await ownerCh.requests()).find((x) => x.id === ask.requestId)!);
    const members = await ownerCh.members();
    expect(members.filter((m) => m.name === "win" && m.active).map((m) => m.pk)).toEqual([again.pk]);
    expect(members.find((m) => m.pk === oldKey.pk)?.active).toBe(false);
  });
});
