// Pairing a terminal with a person's seat (`kiwi tui <join code>`), instead of copying a link that
// carries the key. Shared by the CLI, the web app and the relay.
//
// The terminal makes a one-time key pair and asks the relay to pair. The person's browser shows a
// 6-digit code, the terminal shows one too, and once the person confirms they match, the browser
// seals the seat's identity to the terminal's one-time key. The relay only ever carries the sealed
// box.
//
// A code made from the terminal's key alone could be ground: a relay mints keys until one gives the
// same 6 digits, then swaps its own in and receives the seat. So, as with the join check (sas.ts),
// the code mixes in a secret from each side that nobody can choose after seeing the other's:
//
//   terminal  sends its key and a commit to a random nonce Nt (commit = H(room, pk, xpk, Nt))
//   browser   answers with a random nonce Nb
//   terminal  reveals Nt once it sees Nb; the browser checks it against the commit
//   both      show H(room, pk, xpk, Nt, Nb) as 6 digits
//
// The relay has to fix the key it hands the browser before it learns Nb, so one try is all it gets.

import { b64url } from "./crypto.ts";

const enc = new TextEncoder();

export const PAIR_NONCE_RE = /^[A-Za-z0-9_-]{43}$/;
const ROOM_RE = /^[0-9a-f]{32}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/** How long a pairing waits for the person (the relay forgets it after). */
export const PAIR_TTL_MS = 10 * 60_000;

/** What the seat is sealed under: only a box made for this channel's pairing opens. */
export const pairInfo = (room: string) => `mc/pair\n${room}`;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** Every input is fixed-length and checked, so newline-joined fields can't run into each other. */
function fields(room: string, pk: string, xpk: string, ...nonces: string[]): string {
  if (!ROOM_RE.test(room) || !KEY_RE.test(pk) || !KEY_RE.test(xpk)) throw new Error("bad room or key");
  for (const n of nonces) if (!PAIR_NONCE_RE.test(n)) throw new Error("bad pairing nonce");
  return [room, pk, xpk, ...nonces].join("\n");
}

/** A fresh random nonce, for either side. */
export function pairNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** What the terminal sends first: its nonce, committed to before it sees the browser's. */
export async function pairCommit(room: string, pk: string, xpk: string, nonce: string): Promise<string> {
  return b64url(await sha256(`kiwi-pair-commit\n${fields(room, pk, xpk, nonce)}`));
}

/** The code both sides show: 6 digits, "123-456". */
export async function pairCode(room: string, pk: string, xpk: string, terminalNonce: string, browserNonce: string): Promise<string> {
  const d = await sha256(`kiwi-pair-code\n${fields(room, pk, xpk, terminalNonce, browserNonce)}`);
  const n = ((d[0]! << 16) | (d[1]! << 8) | d[2]!) % 1_000_000;
  const s = String(n).padStart(6, "0");
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/** A pairing as members see it on the relay. */
export interface PairRow {
  id: string;
  pk: string;
  xpk: string;
  commit: string;
  /** The browser's nonce, once one answered. */
  wnonce: string | null;
  /** The terminal's nonce, once it revealed it. */
  tnonce: string | null;
  ts: number;
}

/** The code for a pairing the terminal has revealed, or null while it hasn't (or its reveal doesn't match its commit). */
export async function codeFor(room: string, p: PairRow): Promise<string | null> {
  if (!p.wnonce || !p.tnonce) return null;
  try {
    if ((await pairCommit(room, p.pk, p.xpk, p.tnonce)) !== p.commit) return null;
    return await pairCode(room, p.pk, p.xpk, p.tnonce, p.wnonce);
  } catch {
    return null;
  }
}
