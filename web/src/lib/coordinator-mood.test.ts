import { describe, expect, test } from "bun:test"

import { coordinatorMood, ERROR_MS, SPEAKING_MS, type MoodInput } from "./coordinator-mood"

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
