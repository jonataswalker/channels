import { describe, expect, test } from "bun:test"

import { shortTitle } from "./format"

describe("shortTitle", () => {
  test("keeps a title that is already short", () => {
    expect(shortTitle("Blue accent color")).toBe("Blue accent color")
  })

  test("stops at the first aside", () => {
    expect(shortTitle("Seat on first approval (owner's pick on #1340): a linked computer gets a seat only when…")).toBe("Seat on first approval")
    expect(shortTitle("Sidebar: tasks grouped by state (owner picked B)")).toBe("Sidebar: tasks grouped by state")
  })

  test("stops at the first sentence, keeping dots inside words", () => {
    expect(shortTitle("Ship kiwi 0.10.3. Then tell everyone.")).toBe("Ship kiwi 0.10.3")
  })

  test("a long clause keeps its several-word head before the colon", () => {
    expect(shortTitle("Coordinator mode on/off is easy to find: the details panel shows 'Coordinator mode: on (atlas relays)'")).toBe("Coordinator mode on/off is easy to find")
    expect(shortTitle("Accent color: replace the kiwi green with a blue the owner likes (our own blue, refined)")).toBe("Accent color")
  })

  test("a one-word label before the colon stays: the row truncates instead", () => {
    expect(shortTitle("Bug: kiwi's Claude Code hooks in a checkout shared by several agents name the wrong seat. In /Users/jow")).toBe(
      "Bug: kiwi's Claude Code hooks in a checkout shared by several agents name the wrong seat"
    )
  })

  test("only the first line, and never empty", () => {
    expect(shortTitle("Fix the build\nmore detail")).toBe("Fix the build")
    expect(shortTitle("(draft)")).toBe("(draft)")
  })
})
