// The timeline's replay folds the channel up to a message, which reads the whole log. Scrubbing back
// and forth asks for the same few points over and over, so keep the last few folds by the message
// they stand at. A new cache comes with every new log (the caller makes one per log), so an entry can
// never outlive the messages it was folded from.

/** `fold(seq)`, remembering the last `size` answers; the oldest is dropped first, and a hit counts as new. */
export function foldCache<T>(fold: (seq: number) => T, size = 24): (seq: number) => T {
  const kept = new Map<number, T>()
  return (seq) => {
    const hit = kept.get(seq)
    if (hit !== undefined) {
      kept.delete(seq)
      kept.set(seq, hit)
      return hit
    }
    const out = fold(seq)
    kept.set(seq, out)
    if (kept.size > size) kept.delete(kept.keys().next().value!)
    return out
  }
}
