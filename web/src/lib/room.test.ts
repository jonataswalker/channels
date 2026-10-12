import { describe, expect, test } from "bun:test"

import type { Message } from "../../../src/protocol.ts"
import type { ChannelState, Task } from "../../../src/state.ts"

import { ERROR_MS } from "./coordinator-mood"
import { AGENT_SPEAKING_MS, agentInputs, agentMood, currentTask, delegations, dialogueOf, flagsByAgent, presentAt, stageAgents, teamEvents, type AgentInput } from "./room"

const msg = (seq: number, from: string, extra: Partial<Message> = {}): Message => ({ v: 1, id: `m${seq}`, from, kind: "msg", body: `said ${seq}`, ts: seq * 1000, seq, sigOk: true, ...extra }) as Message
const member = (name: string, kind: "human" | "agent", at = 0) => [name, { name, kind, active: true, at }] as const
const task = (id: number, over: Partial<Task> = {}): Task => ({ id, title: `T${id}`, state: "todo", createdBy: "lead", createdAt: 0, updatedAt: id, notes: [], workedBy: [], ...over })
const state = (over: Partial<ChannelState> = {}) =>
  ({
    members: new Map([member("ana", "human", 0), member("lead", "agent", 1), member("win", "agent", 2), member("dev", "agent", 3)]),
    tasks: new Map(),
    trust: new Map(),
    rejected: new Map(),
    openAsks: [],
    ...over,
  }) as unknown as ChannelState

const base: AgentInput = { online: true, hold: false, now: 100_000, saidAt: null, failedAt: null, thinking: false, working: false }

describe("an agent's face", () => {
  test("asleep when away or on hold; hold freezes it", () => {
    expect(agentMood({ ...base, online: false, working: true })).toEqual({ state: "sleeping" })
    expect(agentMood({ ...base, hold: true, working: true })).toEqual({ state: "sleeping", paused: true })
  })
  test("error, then speaking, then thinking, then working, then idle", () => {
    expect(agentMood({ ...base, failedAt: base.now - 10, saidAt: base.now - 10, thinking: true, working: true }).state).toBe("error")
    expect(agentMood({ ...base, failedAt: base.now - ERROR_MS, saidAt: base.now - 10, thinking: true }).state).toBe("speaking")
    expect(agentMood({ ...base, saidAt: base.now - AGENT_SPEAKING_MS, thinking: true, working: true }).state).toBe("thinking")
    expect(agentMood({ ...base, working: true }).state).toBe("working")
    expect(agentMood(base).state).toBe("idle")
  })
})

describe("what an agent's face reads", () => {
  test("its last line, anywhere; a refused message is a failure, not a line", () => {
    const s = state({ trust: new Map([[3, "refused"]]) } as Partial<ChannelState>)
    const i = agentInputs(s, [msg(1, "win", { task: 4 }), msg(2, "dev"), msg(3, "win")], "win")
    expect(i.line?.seq).toBe(1)
    expect(i.saidAt).toBe(1000)
    expect(i.failedAt).toBe(3000)
  })
  test("thinking while a question it asked is open; working while it has a task in progress", () => {
    const s = state({ openAsks: [msg(5, "win", { kind: "ask" })], tasks: new Map([[7, task(7, { owner: "win", state: "doing" })]]) } as Partial<ChannelState>)
    const i = agentInputs(s, [], "win")
    expect(i.thinking).toBe(true)
    expect(i.working).toBe(true)
    expect(agentInputs(s, [], "dev")).toMatchObject({ thinking: false, working: false })
  })
  test("its task: in progress first, then review, then waiting; done ones don't count", () => {
    const s = state({ tasks: new Map([[1, task(1, { owner: "win", state: "todo" })], [2, task(2, { owner: "win", state: "review" })], [3, task(3, { owner: "win", state: "done" })]]) } as Partial<ChannelState>)
    expect(currentTask(s, "win")?.id).toBe(2)
    s.tasks.set(4, task(4, { owner: "win", state: "doing" }))
    expect(currentTask(s, "win")?.id).toBe(4)
    expect(currentTask(s, "dev")).toBeUndefined()
  })
})

describe("the stage", () => {
  test("every active agent but the coordinator, in the order they joined; people never", () => {
    expect(stageAgents(state(), "lead")).toEqual(["win", "dev"])
  })
  test("flags sit on the agent that raised them", () => {
    const f = flagsByAgent([msg(9, "win", { esc: true })], [task(2, { owner: "dev", state: "review" })])
    expect(f.get("win")?.escalations.length).toBe(1)
    expect(f.get("dev")?.reviews.length).toBe(1)
  })
})

describe("delegation", () => {
  test("a task made or assigned for an agent, a word in its task, or a direct message, from the coordinator only", () => {
    const s = state({ tasks: new Map([[1, task(1, { owner: "dev" })]]) } as Partial<ChannelState>)
    const list = delegations(
      [
        msg(1, "lead", { kind: "event", ev: { op: "task.add", title: "x", owner: "win" } }),
        msg(2, "lead", { kind: "event", ev: { op: "task.update", task: 1, owner: "dev" } }),
        msg(3, "lead", { task: 1 }),
        msg(4, "lead", { to: ["win"], dm: true }),
        msg(5, "lead", { to: ["ana"], dm: true }),
        msg(6, "win", { kind: "event", ev: { op: "task.add", title: "y", owner: "dev" } }),
      ],
      s,
      "lead"
    )
    expect(list.map(({ seq, to }) => ({ seq, to }))).toEqual([
      { seq: 1, to: "win" },
      { seq: 2, to: "dev" },
      { seq: 3, to: "dev" },
      { seq: 4, to: "win" },
    ])
    expect(list[0]!.at).toBe(1000)
  })
})

describe("the docked dialogue", () => {
  test("people to the coordinator and the coordinator to people, in Main, newest last", () => {
    const s = state()
    const all = [msg(1, "ana"), msg(2, "lead"), msg(3, "win"), msg(4, "ana", { to: ["win"] }), msg(5, "lead", { to: ["win"] }), msg(6, "ana", { to: ["lead"] }), msg(7, "lead", { task: 1 })]
    const main = (m: Message) => m.task === undefined
    expect(dialogueOf(all, s, "lead", main).map((m) => m.seq)).toEqual([1, 2, 6])
    expect(dialogueOf(all, s, "lead", main, 2).map((m) => m.seq)).toEqual([2, 6])
  })
})

describe("the timeline", () => {
  test("team moves and escalations in the window; cards and colours aren't moves", () => {
    const s = state()
    const all = [msg(1, "win", { kind: "event", ev: { op: "task.add", title: "x" } }), msg(2, "win", { kind: "event", ev: { op: "card", os: "macos" } as never }), msg(3, "win", { esc: true }), msg(4, "win"), msg(9, "win", { kind: "event", ev: { op: "hello" } })]
    expect(teamEvents(all, s, 0, 5000).map((m) => m.seq)).toEqual([1, 3])
  })
  test("in a replay an agent is there if it did something in the last quarter hour", () => {
    const all = [msg(1, "win"), msg(2, "dev")]
    expect(presentAt(all, "win", 1000 + 60_000)).toBe(true)
    expect(presentAt(all, "win", 1000 + 16 * 60_000)).toBe(false)
    expect(presentAt(all, "ana", 2000)).toBe(false)
  })
})
