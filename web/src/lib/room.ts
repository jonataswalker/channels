// The Room: what each agent behind the coordinator is doing, read from the channel, as small pure
// functions so the faces, their captions, the lines of delegation and the timeline can be tested on
// their own. coordinator-mood.ts reads the coordinator; this reads everyone else the same way.

import { ignored, type Message } from "../../../src/protocol.ts"
import { dmPlace, isPerson, type ChannelState, type Place, type Task } from "../../../src/state.ts"
import { ERROR_MS, type Mood } from "./coordinator-mood"

/** How long an agent's face keeps speaking after it posts (shorter than the coordinator's: there are several). */
export const AGENT_SPEAKING_MS = 3_000

export interface AgentInput {
  online: boolean
  hold: boolean
  now: number
  /** When it last said something (any place), if ever. */
  saidAt: number | null
  /** When its last chat message was refused or rejected, if ever. */
  failedAt: number | null
  /** It's waiting on someone: a question it asked is open, or a decision it handed a person is pending. */
  thinking: boolean
  /** It owns a task in progress. */
  working: boolean
}

export function agentMood(i: AgentInput): Mood {
  if (i.hold) return { state: "sleeping", paused: true }
  if (!i.online) return { state: "sleeping" }
  if (i.failedAt !== null && i.now - i.failedAt >= 0 && i.now - i.failedAt < ERROR_MS) return { state: "error" }
  if (i.saidAt !== null && i.now - i.saidAt >= 0 && i.now - i.saidAt < AGENT_SPEAKING_MS) return { state: "speaking" }
  if (i.thinking) return { state: "thinking" }
  if (i.working) return { state: "working" }
  return { state: "idle" }
}

type Read = Pick<ChannelState, "members" | "tasks" | "trust" | "rejected" | "openAsks">

/** The task an agent is on: the newest one it has in progress, else in review, else waiting to start. */
export function currentTask(state: Pick<ChannelState, "tasks">, name: string): Task | undefined {
  const mine = [...state.tasks.values()].filter((t) => t.owner === name && t.state !== "done")
  const rank = (t: Task) => (t.state === "doing" ? 0 : t.state === "review" ? 1 : 2)
  return mine.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)[0]
}

/** What one agent's face reads: when it last spoke, its last refusal, its last line, and whether it waits or works. */
export function agentInputs(state: Read, messages: Message[], name: string): Pick<AgentInput, "saidAt" | "failedAt" | "thinking" | "working"> & { line: Message | undefined } {
  let saidAt: number | null = null
  let failedAt: number | null = null
  let line: Message | undefined
  for (const m of messages) {
    if (m.from !== name || m.kind === "event") continue
    const at = m.rts ?? m.ts
    if (state.trust.get(m.seq) === "refused" || ignored(state.trust.get(m.seq)) || state.rejected.has(m.seq)) failedAt = at
    else {
      saidAt = at
      line = m
    }
  }
  // It asked something that's still open, or handed a person a decision nobody has made yet.
  const thinking = state.openAsks.some((m) => m.from === name)
  const working = [...state.tasks.values()].some((t) => t.state === "doing" && t.owner === name)
  return { saidAt, failedAt, thinking, working, line }
}

/**
 * The agents on the stage: everyone active who isn't a person or the coordinator, in the order they
 * joined. In a replay (`asOf`, a time), only those who had joined by then: the fold uses today's
 * roster, so without this an agent that came later would stand there, asleep, before it existed.
 */
export function stageAgents(state: Pick<ChannelState, "members">, coordinator: string | null, asOf: number | null = null): string[] {
  return [...state.members.values()].filter((m) => m.active && !isPerson(m) && m.name !== coordinator && (asOf === null || m.joined <= asOf)).map((m) => m.name)
}

/** How many things agents past the shown faces need from you: the "+N" seat carries them, so a flag never leaves the stage. */
export function hiddenFlags(agents: string[], shown: number, flags: Map<string, { escalations: unknown[]; reviews: unknown[] }>): number {
  let n = 0
  for (const name of agents.slice(shown)) {
    const f = flags.get(name)
    if (f) n += f.escalations.length + f.reviews.length
  }
  return n
}

/**
 * How many agents sit beside the coordinator, per side, inside the column: a seat is its face plus
 * 40px of caption, 16px apart, and 32px from the coordinator. None on a phone; at most two a side.
 */
export function seatsPerSide(column: number, coord: number, face: number): number {
  const seat = face + 40
  const room = (column - coord - 2 * 32 + 16) / 2
  return Math.max(0, Math.min(2, Math.floor(room / (seat + 16))))
}

/**
 * The place an agent's drawer opens on: its task's conversation, or else its direct one with the
 * coordinator. Read once, when the drawer opens, and kept: an agent moving on to its next task mid-
 * sentence mustn't pull the drawer (and the draft in it) along.
 */
export function drawerPlaceFor(state: Pick<ChannelState, "tasks">, agent: string, coordinator: string | null, me: string): Place {
  const t = currentTask(state, agent)
  return t ? { kind: "task", task: t.id } : dmPlace(coordinator ?? me, agent)
}

/** Decisions and escalations an agent is waiting on a person for, and tasks of its waiting on a review, by agent. */
export function flagsByAgent(escalations: Message[], reviews: Task[]): Map<string, { escalations: Message[]; reviews: Task[] }> {
  const out = new Map<string, { escalations: Message[]; reviews: Task[] }>()
  const at = (name: string) => out.get(name) ?? (out.set(name, { escalations: [], reviews: [] }), out.get(name)!)
  for (const m of escalations) at(m.from).escalations.push(m)
  for (const t of reviews) if (t.owner) at(t.owner).reviews.push(t)
  return out
}

/** The coordinator handing work to an agent: who, and the message that did it. */
export interface Delegation {
  seq: number
  to: string
  /** When it was handed (the relay's time). */
  at: number
}

/**
 * Every time the coordinator handed an agent something: a task made for it or assigned to it, a word
 * in a task's conversation the agent owns, or a direct message to it. People never receive a line.
 */
export function delegations(messages: Message[], state: Pick<ChannelState, "members" | "tasks" | "trust">, coordinator: string): Delegation[] {
  const agent = (n: string | null | undefined): n is string => !!n && n !== coordinator && !!state.members.get(n) && !isPerson(state.members.get(n)!)
  const out: Delegation[] = []
  for (const m of messages) {
    if (m.from !== coordinator || ignored(state.trust.get(m.seq))) continue
    const ev = m.ev
    const at = m.rts ?? m.ts
    if (ev?.op === "task.add" && agent(ev.owner)) out.push({ seq: m.seq, to: ev.owner, at })
    else if (ev?.op === "task.update" && agent(ev.owner)) out.push({ seq: m.seq, to: ev.owner, at })
    else if (m.kind !== "event" && m.task !== undefined && agent(state.tasks.get(m.task)?.owner)) out.push({ seq: m.seq, to: state.tasks.get(m.task)!.owner!, at })
    else if (m.kind !== "event" && m.dm && m.to?.length === 1 && agent(m.to[0])) out.push({ seq: m.seq, to: m.to[0]!, at })
  }
  return out
}

/**
 * The lines to draw, of everything handed out: what came after the last one seen, and only if it was
 * handed out just now (history arriving on a reconnect or from the cache draws nothing).
 */
export function newDelegations(all: Delegation[], seenTo: number, now: number): { fresh: Delegation[]; seenTo: number } {
  const unseen = all.filter((d) => d.seq > seenTo)
  return { fresh: unseen.filter((d) => now - d.at < 10_000), seenTo: unseen.at(-1)?.seq ?? seenTo }
}

/**
 * The docked dialogue: the latest exchanges in the main conversation between people and the
 * coordinator. A person's message counts when it reaches the coordinator (no one named, or the
 * coordinator named); the coordinator's when it's to people (no one named, everyone, or a person).
 */
export function dialogueOf(messages: Message[], state: Pick<ChannelState, "members" | "trust">, coordinator: string, mainOf: (m: Message) => boolean, max = 8): Message[] {
  const person = (n: string) => !!state.members.get(n) && isPerson(state.members.get(n)!)
  const out: Message[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < max; i--) {
    const m = messages[i]!
    if (m.kind === "event" || ignored(state.trust.get(m.seq)) || !mainOf(m)) continue
    const theirs = m.from === coordinator && (!m.to?.length || m.to.includes("*") || m.to.some(person))
    const ours = person(m.from) && (!m.to?.length || m.to.includes(coordinator))
    if (theirs || ours) out.push(m)
  }
  return out.reverse()
}

/** Events the timeline leaves out: what a member says it runs on, colours, and the plumbing older clients send. */
const QUIET_OPS = new Set(["card", "color.set", "claim", "release", "scope.set", "seat.reclaim", "room.create", "room.rename"])

/** What the timeline marks: the team's moves (task changes, joins, holds, role and mode changes) and every escalation. */
export function teamEvents(messages: Message[], state: Pick<ChannelState, "trust">, from: number, to: number): Message[] {
  return messages.filter((m) => {
    const at = m.rts ?? m.ts
    if (at < from || at > to || ignored(state.trust.get(m.seq))) return false
    if (m.esc) return true
    const op = m.ev?.op
    return !!op && !QUIET_OPS.has(op)
  })
}

/** In a replay there's no presence: an agent counts as there if it said or did something in the last quarter hour. */
export const REPLAY_PRESENT_MS = 15 * 60_000

export function presentAt(messages: Message[], name: string, at: number): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    const t = m.rts ?? m.ts
    if (t > at) continue
    if (at - t > REPLAY_PRESENT_MS) return false
    if (m.from === name) return true
  }
  return false
}
