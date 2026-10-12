// Agents in threads (T1460): a channel starts coordinated; what an agent says while doing a task goes
// to that task's thread, among the agents working it (and the coordinator); --main and --dm say where
// else; listening delivers your task threads and your direct thread, not other tasks' talk.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const MC = ["bun", join(import.meta.dir, "../src/cli/main.ts")];
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-threads-relay-"));
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

const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-threads-${tag}-`));
  made.push(d);
  return d;
};

function spawn(home: string, args: string[]) {
  return Bun.spawn([...MC, ...args], { cwd: home, env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
  return out;
}

async function join_(owner: string, joiner: string, code: string, name: string) {
  const p = spawn(joiner, ["join", code, "--as", name]);
  let listed = "";
  for (let i = 0; i < 300 && !new RegExp(`\\d{3}-\\d{3}\\s+${name}\\b`).test(listed); i++) {
    listed = await ok(owner, "--as", "human", "requests");
    await Bun.sleep(50);
  }
  await ok(owner, "--as", "human", "approve", new RegExp(`(\\d{3}-\\d{3})\\s+${name}\\b`).exec(listed)![1]!, "--yes");
  expect(await p.exited).toBe(0);
}

describe("agents in threads", () => {
  test("a task's talk stays in its thread; main and direct threads are where you say", async () => {
    const owner = scratch("owner");
    const dev = scratch("dev");
    const dev2 = scratch("dev2");
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "th", "--as", "lead"))![1]!;
    await join_(owner, dev, code, "dev");
    await join_(owner, dev2, code, "dev2");
    // Everyone catches up first, so what follows is all that's new.
    for (const h of [owner, dev, dev2]) await ok(h, "listen", "--now");
    await ok(owner, "--as", "lead", "listen", "--now");

    const added = await ok(owner, "--as", "lead", "task", "add", "fix the build", "--owner", "dev");
    const task = /T(\d+)/.exec(added)![0];
    await ok(dev, "task", "start", task);
    // Doing one task: what dev says goes to its thread.
    expect(await ok(dev, "send", "found it: a stale lockfile")).toContain(`in ${task}'s thread`);
    expect(await ok(dev, "send", "--main", "build fixed soon")).not.toContain("thread");
    expect(await ok(dev2, "send", "--dm", "lead", "got a minute?")).toContain("to lead (direct)");

    const leadHeard = await ok(owner, "--as", "lead", "listen", "--now");
    // The coordinator hears the task's thread, main, and its direct thread.
    expect(leadHeard).toContain(`[${task}]`);
    expect(leadHeard).toContain("found it: a stale lockfile");
    expect(leadHeard).toContain("[direct]");
    const dev2Heard = await ok(dev2, "listen", "--now");
    // dev2 isn't working the task: its thread's talk isn't for dev2.
    expect(dev2Heard).not.toContain("stale lockfile");
    // dev doesn't get dev2's direct thread with lead.
    expect(await ok(dev, "listen", "--now")).not.toContain("got a minute?");
    // Anyone can still read any place.
    expect(await ok(dev2, "log", "-n", "50")).toContain("stale lockfile");
  });
});
