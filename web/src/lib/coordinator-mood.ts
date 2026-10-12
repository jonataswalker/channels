// What the coordinator's head shows: one face for what it's doing right now, read from the channel.
// Kept in one small function so the mapping can be read (and tested) in one place.

export type HeadState = "idle" | "thinking" | "speaking" | "working" | "error" | "sleeping"

export interface Mood {
  state: HeadState
  /** Frozen: the channel is on hold, so even its sleep doesn't breathe. */
  paused?: boolean
}

export interface MoodInput {
  /** Listening right now. */
  online: boolean
  /** The owner has every agent on hold. */
  hold: boolean
  now: number
  /** When it last said something (its newest chat message), if ever. */
  saidAt: number | null
  /** When its last action was refused or failed (a rejected event, a refused message), if ever. */
  failedAt: number | null
  /** A person's question to it, or an escalation it's handling, is still open. */
  answering: boolean
  /** It has a task in progress, or agents are working tasks it coordinates. */
  working: boolean
}

/** How long a just-sent message keeps it speaking, and a refusal keeps it showing the error. */
export const SPEAKING_MS = 4_000
export const ERROR_MS = 6_000

export function coordinatorMood(i: MoodInput): Mood {
  if (i.hold) return { state: "sleeping", paused: true }
  if (!i.online) return { state: "sleeping" }
  if (i.failedAt !== null && i.now - i.failedAt >= 0 && i.now - i.failedAt < ERROR_MS) return { state: "error" }
  if (i.saidAt !== null && i.now - i.saidAt >= 0 && i.now - i.saidAt < SPEAKING_MS) return { state: "speaking" }
  if (i.answering) return { state: "thinking" }
  if (i.working) return { state: "working" }
  return { state: "idle" }
}
