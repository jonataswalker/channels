// The agent CLI in about ten verbs: listen, send, show, status, note (plus join, log, task, leave, help).
// The older names stay as aliases, so agents and hooks already running keep working.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const MC = ["bun", join(import.meta.dir, "../src/cli/main.ts")];
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-verbs-relay-"));
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
  const d = mkdtempSync(join(tmpdir(), `kiwi-verbs-${tag}-`));
  made.push(d);
  return d;
};

function spawn(home: string, args: string[]) {
  return Bun.spawn([...MC, ...args], {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, ...args: string[]) {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const r = await run(home, ...args);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const seqOf = (out: string) => /#(\d+)/.exec(out)![1]!;

describe("ten verbs", () => {
  const owner = scratch("owner");
  const agent = scratch("agent");

  beforeAll(async () => {
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "verbs", "--as", "lead"))![1]!;
    const p = spawn(agent, ["join", code, "--as", "dev"]);
    let listed = "";
    await until(async () => {
      listed = await ok(owner, "requests");
      return /\d{3}-\d{3}/.test(listed);
    }, "request");
    await ok(owner, "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
    expect(await p.exited).toBe(0);
    await ok(agent, "listen", "--now");
  });

  test("help shows the new verbs and says the old names still work", async () => {
    const help = await ok(agent, "help");
    for (const v of ["kiwi join", "kiwi listen", "kiwi send", "kiwi show", "kiwi log", "kiwi status", "kiwi task", "kiwi note", "kiwi leave"]) expect(help).toContain(v);
    expect(help).not.toContain("kiwi tail [");
    expect(help).toContain("Older names still work");
  });

  test("send: a message, an answer (--re), a question (--ask --wait), and to a person (--to human)", async () => {
    const asked = await ok(owner, "send", "--to", "dev", "what port?");
    // --re N answers #N: it goes to its sender.
    const answered = await ok(agent, "send", "--re", seqOf(asked), "8080");
    expect(answered).toMatch(/^sent #\d+/);
    const log = await ok(owner, "log");
    expect(log).toMatch(new RegExp(`dev → lead.* re #${seqOf(asked)}: 8080`));

    // A question that waits for its answer.
    const q = spawn(agent, ["send", "--ask", "--to", "lead", "--wait", "20s", "ship it?"]);
    let qseq = "";
    await until(async () => {
      const m = /#(\d+) dev → lead \[ask\]: ship it\?/.exec(await ok(owner, "log"));
      qseq = m?.[1] ?? "";
      return !!qseq;
    }, "the question");
    await ok(owner, "send", "--re", qseq, "yes");
    expect(await q.exited).toBe(0);
    expect(await new Response(q.stdout).text()).toContain("yes");

    // --to human hands it to the agent's human and the owner.
    expect(await ok(agent, "send", "--to", "human", "asked to delete prod logs; outside the charter")).toMatch(/^escalated #\d+ to /);
  });

  test("listen: --now reads, --once waits, plain streams", async () => {
    await ok(owner, "send", "--to", "dev", "unread one");
    expect(await ok(agent, "listen", "--now")).toContain("unread one");
    const quiet = await run(agent, "listen", "--once", "--timeout", "1s");
    expect(quiet.code).toBe(2);
    expect(quiet.out).toContain("listen --once --timeout 10m");

    const once = spawn(agent, ["listen", "--once", "--timeout", "20s"]);
    await Bun.sleep(800);
    await ok(owner, "send", "--to", "dev", "wake once");
    expect(await once.exited).toBe(0);
    expect(await new Response(once.stdout).text()).toContain("wake once");

    const stream = spawn(agent, ["listen"]);
    let got = "";
    const reader = stream.stdout.getReader();
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        got += new TextDecoder().decode(value);
      }
    })();
    await Bun.sleep(800);
    await ok(owner, "send", "--to", "dev", "streamed");
    await until(() => got.includes("streamed"), "streamed message");
    stream.kill();
    await reading;
  });

  test("show: the message, what it answers, its replies, and the rest of its thread", async () => {
    const root = seqOf(await ok(owner, "send", "--to", "dev", "plan for the release?"));
    const mid = seqOf(await ok(agent, "send", "--re", root, "draft in docs/"));
    await ok(owner, "send", "--re", mid, "looks good");
    const shown = await ok(agent, "show", root);
    expect(shown).toContain("plan for the release?");
    expect(shown).toContain("draft in docs/");
    // Two levels down is still the same thread.
    expect(shown).toContain(`the rest of thread #${root}`);
    expect(shown).toContain("looks good");
  });

  test("note: set, get, list, clear", async () => {
    expect(await ok(agent, "note", "build.cmd", "bun", "test")).toContain("build.cmd = bun test");
    expect((await ok(owner, "note", "build.cmd")).trim()).toBe("bun test");
    expect(await ok(owner, "note")).toContain("build.cmd");
    await ok(agent, "note", "build.cmd", "--clear");
    expect((await run(owner, "note", "build.cmd")).code).toBe(2);
  });

  test("status is one screen; task alone is the board; the old names still answer", async () => {
    await ok(agent, "task", "add", "write the docs");
    expect(await ok(agent, "task")).toContain("write the docs");
    const status = await ok(agent, "status");
    expect(status).toContain("dev (you)");
    expect(status).toContain("write the docs");
    // Aliases.
    expect((await run(agent, "who")).code).toBe(0);
    expect((await run(agent, "read")).code).toBe(0);
    expect((await run(agent, "facts")).code).toBe(0);
    expect((await run(agent, "wait", "--timeout", "1s")).out).toContain("wait --timeout 10m");
  });
});
