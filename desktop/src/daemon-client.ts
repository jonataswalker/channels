// Talking to "kiwi daemon" over its local socket.
//
// CONTRACT (for the daemon side to match; see the plan's "The daemon"):
//   path: $KIWI_HOME/daemon.sock (a named pipe on Windows: \\.\pipe\kiwi-daemon-<user>)
//   framing: newline-delimited JSON, one request per line, one response per line
//   request:  { "id": number, "method": string, "params"?: object }
//   response: { "id": number, "ok": true, "result": unknown }
//           | { "id": number, "ok": false, "error": string }
//   methods this shell needs:
//     hello -> { version, machine: { pk, xpk }, paired: { person, name, label } | null }
//     adopt { cert, person: { pk, xpk, name } } -> { ok: true }
//       (cert is the MachineCert the app made for this machine's key)
// Only these two are used here; listen/listening/stop stay the CLI's business.

import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { MachineCert } from "../../src/person.ts";

export interface HelloResult {
  version: string;
  machine: { pk: string; xpk: string };
  paired: { person: string; name: string; label: string } | null;
}

export interface AdoptParams {
  cert: MachineCert;
  person: { pk: string; xpk: string; name: string };
}

const idOf = (u: string) => u.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "kiwi";

export function kiwiHome(): string {
  return process.env["KIWI_HOME"] ?? path.join(os.homedir(), ".kiwi");
}

export function daemonSocketPath(home: string = kiwiHome()): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\kiwi-daemon-${idOf(process.env["USERNAME"] ?? os.userInfo().username)}`;
  return path.join(home, "daemon.sock");
}

interface RpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function call(sock: string, method: string, params?: object, timeoutMs = 5_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(sock);
    const timer = setTimeout(() => (conn.destroy(), reject(new Error("the daemon didn't answer"))), timeoutMs);
    let buf = "";
    conn.on("connect", () => conn.write(`${JSON.stringify({ id: 1, method, params: params ?? {} })}\n`));
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      clearTimeout(timer);
      conn.destroy();
      try {
        const res = JSON.parse(buf.slice(0, nl)) as RpcResponse;
        if (res.ok) resolve(res.result ?? null);
        else reject(new Error(typeof res.error === "string" ? res.error : "the daemon refused"));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    conn.on("error", (err) => (clearTimeout(timer), reject(err)));
  });
}

/** The daemon's hello, or null when none is listening (stale socket included). */
export async function daemonHello(home: string = kiwiHome(), timeoutMs = 5_000): Promise<HelloResult | null> {
  try {
    const r = (await call(daemonSocketPath(home), "hello", {}, timeoutMs)) as Partial<HelloResult>;
    if (!r || typeof r.version !== "string" || !r.machine || typeof r.machine.pk !== "string") return null;
    return r as HelloResult;
  } catch {
    return null;
  }
}

/** Hand the daemon its cert from the person. Throws when it refuses. */
export async function daemonAdopt(home: string, params: AdoptParams, timeoutMs = 10_000): Promise<void> {
  await call(daemonSocketPath(home), "adopt", params as unknown as Record<string, unknown>, timeoutMs);
}
