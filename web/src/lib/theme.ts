import { useSyncExternalStore } from "react"

// Light, dark, or whatever the system says, and how large everything reads.
// Both are per browser. "system" leaves <html> without data-theme so the CSS
// media query decides; the text size scales the whole page (it's set in px
// throughout, so a root font-size alone wouldn't reach it).

export type Appearance = "system" | "light" | "dark"

const KEY = "mc.appearance"
const listeners = new Set<() => void>()

function read(): Appearance {
  const v = localStorage.getItem(KEY)
  return v === "light" || v === "dark" ? v : "system"
}

function apply(a: Appearance) {
  if (a === "system") delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = a
}

export function setAppearance(a: Appearance) {
  if (a === "system") localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, a)
  apply(a)
  for (const l of listeners) l()
}

export type TextSize = "small" | "default" | "large" | "larger"
export const TEXT_SIZES: Record<TextSize, number> = { small: 0.92, default: 1, large: 1.1, larger: 1.22 }
const SIZE_KEY = "mc.text-size"

function readSize(): TextSize {
  const v = localStorage.getItem(SIZE_KEY)
  return v === "small" || v === "large" || v === "larger" ? v : "default"
}

function applySize(t: TextSize) {
  const z = TEXT_SIZES[t]
  if (z === 1) document.documentElement.style.removeProperty("zoom")
  else document.documentElement.style.setProperty("zoom", String(z))
}

export function setTextSize(t: TextSize) {
  if (t === "default") localStorage.removeItem(SIZE_KEY)
  else localStorage.setItem(SIZE_KEY, t)
  applySize(t)
  for (const l of listeners) l()
}

/** Run once before the first render, so the page never paints in the wrong theme or size. */
export function applyStoredAppearance() {
  apply(read())
  applySize(readSize())
}

export function useAppearance(): Appearance {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, read)
}

export function useTextSize(): TextSize {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, readSize)
}
