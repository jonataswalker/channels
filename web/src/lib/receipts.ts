// Read receipts: under your newest message, whether the agents it went to have read it. Agents tell
// the relay how far they've read (a seq, never content: kiwi's listen, hooks and MCP do it as they
// hand messages on), the relay passes each mark to every client, and this works out what a message's
// own recipients have read. People don't send marks, so only agents are counted.

import type { Message, ReadMark } from "../../../src/protocol.ts"
import { isPerson, threadMembers, type ChannelState } from "../../../src/state.ts"

/** The marks this view has heard for one key, oldest first (each further on than the last). */
export type Marks = Map<string, ReadMark[]>

/** How many marks to keep per key: enough to date the messages on screen. */
const KEEP = 50

/** Add marks heard live (or on connect); a mark that doesn't move a key forward changes nothing. */
export function addMarks(prev: Marks, marks: readonly ReadMark[]): Marks {
  let next: Marks | null = null
  for (const r of marks) {
    const list = (next ?? prev).get(r.pk) ?? []
    if ((list.at(-1)?.seq ?? 0) >= r.seq) continue
    next ??= new Map(prev)
    next.set(r.pk, [...list, r].slice(-KEEP))
  }
  return next ?? prev
}

/** When `pk` had read up to `seq`: the first mark this view heard that reached it, or null. */
export function readAt(marks: Marks, pk: string | undefined, seq: number): number | null {
  if (!pk) return null
  for (const r of marks.get(pk) ?? []) if (r.seq >= seq) return r.at
  return null
}

/**
 * The agents a message went to: the ones it names, else a task's agents for a word in its thread,
 * else the coordinator for a person's word in coordinator mode, else every agent. Only agents that
 * were in the channel when it was sent, and never its sender.
 */
export function recipients(m: Message, state: Pick<ChannelState, "members" | "tasks" | "coordinator">): string[] {
  const named = m.to?.length && !m.to.includes("*") ? m.to : null
  const sender = state.members.get(m.from)
  const base = named
    ? named
    : m.task !== undefined && state.tasks.has(m.task)
      ? threadMembers(state, { kind: "task", task: m.task })
      : state.coordinator && sender && isPerson(sender)
        ? [state.coordinator]
        : [...state.members.keys()]
  const at = m.rts ?? m.ts
  return [...new Set(base)].filter((n) => {
    const who = state.members.get(n)
    return n !== m.from && !!who && who.active && !isPerson(who) && (who.kind as string | undefined) !== "computer" && who.joined <= at
  })
}

/** What sits under a message of yours: "Read 10:42", "Read by atlas, win", "Read by 2 of 5", or "Delivered". */
export function receipt(
  m: Message,
  state: Pick<ChannelState, "members" | "tasks" | "coordinator">,
  marks: Marks,
  pkOf: (name: string) => string | undefined,
  time: (ts: number) => string
): string | null {
  const to = recipients(m, state)
  if (!to.length) return null
  const read = to.map((n) => ({ n, at: readAt(marks, pkOf(n), m.seq) })).filter((r): r is { n: string; at: number } => r.at !== null)
  if (!read.length) return "Delivered"
  const last = time(Math.max(...read.map((r) => r.at)))
  if (to.length === 1) return `Read ${last}`
  if (read.length === to.length) return `Read by everyone ${last}`
  return read.length <= 3 ? `Read by ${read.map((r) => r.n).join(", ")}` : `Read by ${read.length} of ${to.length}`
}
