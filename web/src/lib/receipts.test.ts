import { describe, expect, test } from "bun:test"

import type { Message } from "../../../src/protocol.ts"
import type { ChannelState } from "../../../src/state.ts"

import { addMarks, readAt, receipt, recipients, type Marks } from "./receipts"

type Who = { kind?: string; owner?: boolean; active: boolean; joined: number }
const members = new Map<string, Who>([
  ["jon", { kind: "human", owner: true, active: true, joined: 0 }],
  ["ana", { kind: "human", active: true, joined: 0 }],
  ["atlas", { kind: "agent", active: true, joined: 0 }],
  ["win", { kind: "agent", active: true, joined: 0 }],
  ["dev", { kind: "agent", active: true, joined: 0 }],
  ["late", { kind: "agent", active: true, joined: 5_000 }],
  ["gone", { kind: "agent", active: false, joined: 0 }],
  ["mac", { kind: "computer", active: true, joined: 0 }],
])
const state = (over: Partial<Pick<ChannelState, "coordinator" | "tasks">> = {}) =>
  ({ members, tasks: new Map(), coordinator: null, ...over }) as unknown as Pick<ChannelState, "members" | "tasks" | "coordinator">
const msg = (over: Partial<Message> = {}): Message => ({ v: 1, id: "x", from: "jon", kind: "msg", body: "hi", ts: 1_000, rts: 1_000, seq: 10, sigOk: true, ...over }) as Message
const pks = (n: string) => `pk-${n}`
const time = (ts: number) => `t${ts}`

describe("who a message went to", () => {
  test("the agents it names, never people, the sender, or someone gone", () => {
    expect(recipients(msg({ to: ["atlas", "ana", "gone"] }), state())).toEqual(["atlas"])
  })
  test("a person's word in coordinator mode goes to the coordinator; otherwise to every agent there when it was sent", () => {
    expect(recipients(msg(), state({ coordinator: "atlas" }))).toEqual(["atlas"])
    // late joined after it was sent; the computer's seat is no reader.
    expect(recipients(msg(), state()).sort()).toEqual(["atlas", "dev", "win"])
  })
})

describe("read marks", () => {
  test("only marks that move a key forward are kept; the first one past a message dates it", () => {
    let marks: Marks = new Map()
    marks = addMarks(marks, [{ pk: "pk-atlas", seq: 8, at: 100 }])
    marks = addMarks(marks, [{ pk: "pk-atlas", seq: 12, at: 200 }])
    const same = addMarks(marks, [{ pk: "pk-atlas", seq: 12, at: 300 }])
    expect(same).toBe(marks)
    expect(readAt(marks, "pk-atlas", 10)).toBe(200)
    expect(readAt(marks, "pk-atlas", 13)).toBeNull()
    expect(readAt(marks, undefined, 1)).toBeNull()
  })
})

describe("the line under your message", () => {
  const marks = addMarks(new Map(), [
    { pk: "pk-atlas", seq: 10, at: 500 },
    { pk: "pk-win", seq: 11, at: 700 },
  ])
  test("one recipient: Read with its time, or Delivered", () => {
    expect(receipt(msg({ to: ["atlas"] }), state(), marks, pks, time)).toBe("Read t500")
    expect(receipt(msg({ to: ["dev"] }), state(), marks, pks, time)).toBe("Delivered")
  })
  test("several: who has read it, or everyone with the latest time", () => {
    expect(receipt(msg({ to: ["atlas", "win", "dev"] }), state(), marks, pks, time)).toBe("Read by atlas, win")
    expect(receipt(msg({ to: ["atlas", "win"] }), state(), marks, pks, time)).toBe("Read by everyone t700")
  })
  test("nothing for a message to people only", () => {
    expect(receipt(msg({ to: ["ana"] }), state(), marks, pks, time)).toBeNull()
  })
})
