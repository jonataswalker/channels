import { describe, expect, test } from "bun:test"

import { foldCache } from "./fold-cache"

describe("the replay's folds", () => {
  test("scrubbing back and forth over the same points folds each once", () => {
    let folds = 0
    const at = foldCache((seq: number) => (folds++, { seq }))
    for (const seq of [5, 9, 5, 9, 5]) at(seq)
    expect(folds).toBe(2)
    expect(at(9)).toEqual({ seq: 9 })
  })
  test("only the last few are kept, the least recently used going first", () => {
    let folds = 0
    const at = foldCache((seq: number) => (folds++, seq), 2)
    at(1)
    at(2)
    at(1) // 1 is the newest now
    at(3) // drops 2
    folds = 0
    at(1)
    expect(folds).toBe(0)
    at(2)
    expect(folds).toBe(1)
  })
})
