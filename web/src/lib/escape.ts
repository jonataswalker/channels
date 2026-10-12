// Esc closes the top layer only. A popover listens before anything under it (capture, on the
// document), closes, and stops the key there, so the field under it doesn't also switch the view or
// end a replay. A field inside the popover (an answer being typed) handles its own Esc first.

/** While an overlay is open: Esc closes it and nothing else. Returns the way to stop listening. */
export function escapeLayer(box: () => HTMLElement | null, close: () => void): () => void {
  const esc = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return
    const t = e.target
    if (t instanceof HTMLElement && box()?.contains(t) && t.matches("input, textarea")) return
    e.preventDefault()
    e.stopPropagation()
    close()
  }
  document.addEventListener("keydown", esc, true)
  return () => document.removeEventListener("keydown", esc, true)
}
