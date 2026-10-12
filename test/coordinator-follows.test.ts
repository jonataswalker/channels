// Coordinator-only follows the coordinator role (T1389): removing the coordinator turns it off, so
// no agent is left refused for want of a coordinator that isn't there.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const MC = ["bun", join(import.meta.dir, "../src/cli/main.ts")];
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-cf-relay-"));
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

const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kiwi-cf-"));
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

test("kicking the coordinator turns coordinator-only off", async () => {
  const owner = scratch();
  const agent = scratch();
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "cf", "--as", "lead"))![1]!;
  const p = spawn(agent, ["join", code, "--as", "coord"]);
  let listed = "";
  for (let i = 0; i < 300 && !/\d{3}-\d{3}/.test(listed); i++) {
    listed = await ok(owner, "--as", "human", "requests");
    await Bun.sleep(50);
  }
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await p.exited).toBe(0);
  await ok(owner, "--as", "human", "role", "coord", "coordinator", "--yes");
  await ok(owner, "--as", "human", "mode", "coordinator-only", "on", "--yes");
  expect(await ok(owner, "--as", "human", "status")).toContain("coordinator-only");
  const kicked = await ok(owner, "--as", "human", "kick", "coord", "--yes");
  expect(kicked).toContain("coordinator-only is off");
  expect(await ok(owner, "log", "--all")).toContain("turned off coordinator-only");
});
