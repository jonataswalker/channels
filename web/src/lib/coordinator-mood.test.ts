import { describe, expect, test } from "bun:test"

import type { Message } from "../../../src/protocol.ts"
import type { ChannelState } from "../../../src/state.ts"

import { coordinatorMood, ERROR_MS, moodInputs, SPEAKING_MS, type MoodInput } from "./coordinator-mood"

const base: MoodInput = { online: true, hold: false, now: 100_000, saidAt: null, failedAt: null, answering: false, working: false }

describe("the coordinator's head", () => {
  test("idle when online with nothing going on", () => {
    expect(coordinatorMood(base)).toEqual({ state: "idle" })
  })
  test("asleep when offline; asleep and frozen on hold, whatever else is true", () => {
    expect(coordinatorMood({ ...base, online: false, working: true })).toEqual({ state: "sleeping" })
    expect(coordinatorMood({ ...base, hold: true, saidAt: base.now, failedAt: base.now, answering: true })).toEqual({ state: "sleeping", paused: true })
  })
  test("speaking for a few seconds after it says something, then back to what it was doing", () => {
    expect(coordinatorMood({ ...base, saidAt: base.now - 1000, working: true }).state).toBe("speaking")
    expect(coordinatorMood({ ...base, saidAt: base.now - SPEAKING_MS, working: true }).state).toBe("working")
  })
  test("a refusal shows briefly, ahead of speaking", () => {
    expect(coordinatorMood({ ...base, failedAt: base.now - 500, saidAt: base.now - 400 }).state).toBe("error")
    expect(coordinatorMood({ ...base, failedAt: base.now - ERROR_MS }).state).toBe("idle")
  })
  test("thinking while a question to it is open; working while work it coordinates is", () => {
    expect(coordinatorMood({ ...base, answering: true, working: true }).state).toBe("thinking")
    expect(coordinatorMood({ ...base, working: true }).state).toBe("working")
  })
  test("a clock behind a message doesn't make it speak forever", () => {
    expect(coordinatorMood({ ...base, saidAt: base.now + 60_000 }).state).toBe("idle")
  })
})

describe("what the head reads from the channel", () => {
  const msg = (seq: number, from: string, extra: Partial<Message> = {}): Message => ({ v: 1, id: `m${seq}`, from, kind: "msg", body: "x", ts: seq * 1000, seq, sigOk: true, ...extra }) as Message
  const member = (name: string, kind: "human" | "agent") => [name, { name, kind, active: true }] as const
  const state = (over: Partial<ChannelState> = {}) =>
    ({
      members: new Map([member("ana", "human"), member("lead", "agent"), member("win", "agent")]),
      tasks: new Map(),
      trust: new Map(),
      rejected: new Map(),
      openAsks: [],
      ...over,
    }) as unknown as ChannelState
  const nobody = { has: () => false }

  test("its newest chat message is what it said; a refused one is a failure", () => {
    const s = state({ trust: new Map([[3, "refused"]]) } as Partial<ChannelState>)
    const i = moodInputs(s, [msg(1, "lead"), msg(2, "win"), msg(3, "lead")], nobody, "lead")
    expect(i.saidAt).toBe(1000)
    expect(i.last).toBe(1)
    expect(i.failedAt).toBe(3000)
  })
  test("an event that lost a race isn't a failure", () => {
    const s = state({ rejected: new Map([[2, "T3 was claimed first"]]) } as Partial<ChannelState>)
    const i = moodInputs(s, [msg(2, "lead", { kind: "event" })], nobody, "lead")
    expect(i.failedAt).toBeNull()
  })
  test("thinking only for a person's question or an escalation to it", () => {
    const fromAgent = state({ openAsks: [msg(4, "win", { kind: "ask", to: ["lead"] })] } as Partial<ChannelState>)
    expect(moodInputs(fromAgent, [], nobody, "lead").answering).toBe(false)
    const fromPerson = state({ openAsks: [msg(5, "ana", { kind: "ask", to: ["lead"] })] } as Partial<ChannelState>)
    expect(moodInputs(fromPerson, [], nobody, "lead").answering).toBe(true)
  })
  test("working: a task in progress whose owner is listening, or its own", () => {
    const task = (owner: string) => new Map([[7, { id: 7, state: "doing", owner }]])
    expect(moodInputs(state({ tasks: task("win") } as unknown as Partial<ChannelState>), [], nobody, "lead").working).toBe(false)
    expect(moodInputs(state({ tasks: task("win") } as unknown as Partial<ChannelState>), [], { has: (n) => n === "win" }, "lead").working).toBe(true)
    expect(moodInputs(state({ tasks: task("lead") } as unknown as Partial<ChannelState>), [], nobody, "lead").working).toBe(true)
  })
})
