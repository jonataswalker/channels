import { relayUrl } from "./relay"
// Linking a computer to your account (kiwi setup prints a #link=<key> page),
// the list of your linked computers, and their seats in the channels you own.

import { Channel, RelayError } from "@mc/client.ts"
import { allMembers, saveMember } from "./channel"

/** What `#link=` carries: the computer's key. */
export interface ParsedLink {
  pk: string
}

/** `#link=<computer key>`: the page `kiwi setup` opens to link that computer. Kiwi 0.9.1 to 0.10 added `&x=…&s=…` (its exchange key), no longer used. */
export function parseLinkHash(hash: string): ParsedLink | null {
  const m = /^#link=([A-Za-z0-9_-]{20,})(?:&x=[A-Za-z0-9_-]{20,}&s=[A-Za-z0-9_-]{20,})?$/.exec(hash)
  return m ? { pk: m[1]! } : null
}

async function call<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (init.token) headers["x-human-token"] = init.token
  const res = await fetch(path, { ...init, headers })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; tag?: string }
  // A RelayError, so callers (and the sign-in check) branch on its tag, not its words.
  if (!res.ok) throw new RelayError(res.status, json.error ?? `the relay returned ${res.status}`, json.tag)
  return json
}

/** What the computer asked to be called, and whether it's linked already. */
export const computerInfo = (pk: string) => call<{ label: string; status: "pending" | "linked"; created: number }>(`/v1/machines/${pk}/public`)

export const confirmComputer = (pk: string, token: string) => call<{ status: string; label: string }>(`/v1/machines/${pk}/confirm`, { method: "POST", token, body: "{}" })

export interface Computer {
  pk: string
  label: string
  linked: number
  /** Last time it vouched for an agent or checked its link, to the hour; null if it hasn't since linking. */
  used: number | null
  /** When the relay unlinks it if it stays unused. */
  expires: number
}

export const myComputers = (token: string) => call<{ machines: Computer[] }>("/v1/me/machines", { token }).then((r) => r.machines)

export const removeComputer = (pk: string, token: string) => call<unknown>(`/v1/me/machines/${pk}`, { method: "DELETE", token })

// ---------- seats: your computers letting their own agents in ----------
//
// A computer gets a quiet seat in a channel (Channel.seatComputer) only when its person approves its
// first agent there with "let agents from it in from now on": the owner's signature that it may let its
// own agents in for 90 days, renewed while they use the channel. Removing the computer here takes every
// seat away again, and the agents it let in.

/** The channels this browser owns, opened as their owner. */
function owned(): Channel[] {
  return allMembers()
    .filter((m) => m.identity.pk === m.access.ownerPk)
    .map((m) => new Channel(m.access, relayUrl(), m.identity, (access) => saveMember({ ...m, access })))
}

/** Take a computer's seat away in every channel this browser owns, and remove the agents it let in. */
export async function revokeEverywhere(pk: string): Promise<string[]> {
  const removed: string[] = []
  for (const ch of owned()) removed.push(...(await ch.revokeComputer(pk).catch(() => [])))
  return removed
}
