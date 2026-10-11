// Seats: which agent a command or hook acts for, with no -c/--as to type.
//
// A seat is one agent's place in one channel, kept per working directory: `kiwi join`
// writes it, and every later command and hook from that directory finds it. Several
// agents can work from one checkout, so a seat also remembers the harness that joined
// (claude, codex…) and, when the harness says, its session and process:
//
//   - a session finds the seat it joined with;
//   - a restarted agent (new session, same checkout, same harness) takes its old seat
//     back, once the session that held it is gone;
//   - a second live agent in the same checkout never acts as the first.

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { loadConfig, updateConfig, type Config, type SeatRecord } from "./config.ts";

export type Harness = NonNullable<SeatRecord["harness"]>;

/** The agent running this process: its harness, and the session and process when the harness says. */
export interface Here {
  harness?: Harness;
  session?: string;
  /** The harness's own process (Claude Code's CLAUDE_PID): the seat is held while it lives. */
  pid?: number;
}

export type Binding = SeatRecord;

/**
 * Who this process runs for, from the variables each harness sets on its shell
 * commands and hooks (see SESSION_ENV in hooks.ts for where each comes from).
 */
export function here(env: Record<string, string | undefined> = process.env): Here {
  const pid = Number(env.CLAUDE_PID);
  if (env.CLAUDECODE) return { harness: "claude", ...(env.CLAUDE_CODE_SESSION_ID ? { session: env.CLAUDE_CODE_SESSION_ID } : {}), ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}) };
  if (env.CODEX_THREAD_ID) return { harness: "codex", session: env.CODEX_THREAD_ID };
  if (env.GROK_SESSION_ID) return { harness: "grok", session: env.GROK_SESSION_ID };
  if (env.GEMINI_CLI) return { harness: "gemini" };
  if (env.CURSOR_AGENT) return { harness: "cursor" };
  return {};
}

/** The name an agent gets when it doesn't pick one: what it runs in. */
export function baseName(h: Here): string {
  return h.harness ?? "agent";
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Directories too broad to bind: the home folder and the filesystem root. A
 * binding there would make every session in every project act as that agent.
 */
export function tooBroad(dir: string): boolean {
  const d = real(dir);
  return d === real(homedir()) || dirname(d) === d;
}

/** The seats kept for one directory. One seat is stored as a plain object, which clients before 0.10 read too. */
export function seatsAt(cfg: Config, dir: string): Binding[] {
  const v = cfg.bindings?.[dir];
  return (Array.isArray(v) ? v : v ? [v] : []).filter((b) => b && typeof b.alias === "string" && typeof b.as === "string");
}

function store(cfg: Config, dir: string, seats: Binding[]): void {
  const bindings = { ...(cfg.bindings ?? {}) };
  if (!seats.length) delete bindings[dir];
  else bindings[dir] = seats.length === 1 ? seats[0]! : seats;
  cfg.bindings = bindings;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it's just not ours to signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** How long a seat with no process to check stays its session's after that session last used it. */
const STALE_MS = 12 * 3600_000;
/** How often a session's use of its seat is written down (so `seen` is fresh enough for STALE_MS). */
const SEEN_EVERY_MS = 10 * 60_000;

/**
 * Whether a session other than `who` still holds this seat. A seat records its harness's process
 * when the harness says (Claude Code), and then it's held while that process runs. Otherwise
 * (Codex, Grok…) it's held while that session listens or has used it in the last 12 hours.
 */
export function heldElsewhere(b: Binding, who: Here, listening: (alias: string, as: string) => boolean, now = Date.now()): boolean {
  if (!b.session || b.session === who.session) return false;
  if (b.pid) return b.pid !== who.pid && pidAlive(b.pid);
  return listening(b.alias, b.as) || now - (b.seen ?? b.at ?? 0) < STALE_MS;
}

/**
 * Remember that an agent working in `dir` is `b.as` on channel `b.alias`, alongside any other
 * agents working there. Returns false for home/root.
 */
export function bindDirectory(dir: string, b: Binding): boolean {
  if (tooBroad(dir)) return false;
  const at = resolve(dir);
  updateConfig((cfg) => {
    // Without a session nothing could tell two seats apart later, so a sessionless seat replaces the others like it (the last join wins, as before seats).
    const others = seatsAt(cfg, at).filter((s) => !(s.alias === b.alias && s.as === b.as) && !(!b.session && !s.session && s.harness === b.harness));
    store(cfg, at, [...others, { ...b, at: Date.now() }]);
  });
  return true;
}

export interface SeatOptions {
  who?: Here;
  /** Only seats in this channel (by alias). */
  alias?: string;
  /** Is a live process listening for this agent (hooks.ts isListening)? */
  listening?: (alias: string, as: string) => boolean;
  /** Record this session on the seat it takes (default true). */
  claim?: boolean;
}

/**
 * The seat this process acts for in `dir` or its nearest ancestor with seats, never reaching
 * home or root. In order: the seat this session holds; else the one seat there that no other
 * live session holds and that this harness joined (a restart takes its seat back). Two
 * candidates are never guessed between, except that among free seats of the same harness the
 * one used last wins. Null when there's nothing to act for, or another session holds it.
 */
export function bindingFor(dir: string, opts: SeatOptions = {}): Binding | null {
  const who = opts.who ?? here();
  const listening = opts.listening ?? (() => false);
  const cfg = loadConfig();
  for (let d = resolve(dir); !tooBroad(d); d = dirname(d)) {
    const seats = seatsAt(cfg, d).filter((b) => cfg.channels[b.alias] && (!opts.alias || b.alias === opts.alias));
    if (!seats.length) continue;
    const mine = who.session ? seats.find((b) => b.session === who.session) : undefined;
    if (mine) {
      // Note that this session still uses it, so nobody takes it for stale (seats with no process to check).
      if (opts.claim !== false && !mine.pid && Date.now() - (mine.seen ?? mine.at ?? 0) > SEEN_EVERY_MS) {
        updateConfig((c) => store(c, d, seatsAt(c, d).map((b) => (b.alias === mine.alias && b.as === mine.as ? { ...b, seen: Date.now() } : b))));
      }
      return mine;
    }
    // A plain terminal (or a harness that names no session) in a folder with one agent acts as that agent, as before seats.
    if (!who.session && seats.length === 1) return seats[0]!;
    // Seats this agent could be: no other live session holds them, and the harness fits (or one side doesn't say).
    const free = seats.filter((b) => !heldElsewhere(b, who, listening) && (!b.harness || !who.harness || b.harness === who.harness));
    // Several free seats: the one of this session's harness, when there's exactly one; otherwise it would be guessing.
    const ofMine = free.filter((b) => who.harness && b.harness === who.harness);
    const pick = free.length === 1 ? free[0]! : who.session && ofMine.length === 1 ? ofMine[0]! : null;
    if (!pick) return null;
    if (opts.claim !== false && who.session && (pick.session !== who.session || (who.pid && pick.pid !== who.pid))) {
      // The previous holder's process goes with it: this session's, or none.
      const { pid: _gone, ...rest } = pick;
      const taken: Binding = { ...rest, session: who.session, ...(who.pid ? { pid: who.pid } : {}), ...(who.harness && !pick.harness ? { harness: who.harness } : {}), at: Date.now(), seen: Date.now() };
      updateConfig((c) => store(c, d, seatsAt(c, d).map((b) => (b.alias === pick.alias && b.as === pick.as ? taken : b))));
      return taken;
    }
    return pick;
  }
  return null;
}

/** The seats in `dir` or its nearest ancestor that has any, whoever holds them. */
export function seatsNear(dir: string): Binding[] {
  const cfg = loadConfig();
  for (let d = resolve(dir); !tooBroad(d); d = dirname(d)) {
    const seats = seatsAt(cfg, d).filter((b) => cfg.channels[b.alias]);
    if (seats.length) return seats;
  }
  return [];
}
