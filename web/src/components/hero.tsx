// What coordinator mode's Main view shares with the rest: which view a channel opens on (the Room, or
// the whole conversation), the word-by-word reveal of the coordinator's newest line, and the team
// line's parts. The Room itself is room.tsx.

import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { useEffect, useRef, useState } from "react"

import type { Message } from "@mc/protocol.ts"
import { Icon } from "./icon"

/** Which view Main opens on in coordinator mode, per channel: the Room ("focus", as stored), or the whole conversation. */
export type MainView = "focus" | "conversation"

const VIEW_KEY = (room: string) => `mc.view.${room}`

export function loadMainView(room: string): MainView {
  try {
    return localStorage.getItem(VIEW_KEY(room)) === "conversation" ? "conversation" : "focus"
  } catch {
    return "focus"
  }
}

export function saveMainView(room: string, view: MainView): void {
  try {
    localStorage.setItem(VIEW_KEY(room), view)
  } catch {
    // Private mode or a full disk: the choice lasts as long as the page.
  }
}

const reducedMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

/**
 * A new message from the coordinator, word by word: fast (about 50 words a second), never longer than
 * two seconds, and at once with reduced motion or for a message that was already there when the view opened.
 */
export function useReveal(m: Message | undefined): { text: string; revealing: boolean } {
  const first = useRef(m?.seq ?? 0)
  const [shown, setShown] = useState<{ seq: number; words: number } | null>(null)
  const seq = m?.seq ?? 0
  const body = m?.body ?? ""
  useEffect(() => {
    if (!seq || seq <= first.current || reducedMotion() || Date.now() - (m?.rts ?? m?.ts ?? 0) > 15_000) return
    first.current = seq
    const parts = body.split(/(\s+)/)
    const words = parts.filter((p) => p.trim()).length
    if (words < 4) return
    const rate = Math.max(50, words / 2) // words per second: at most two seconds in all
    const start = performance.now()
    let frame = 0
    const tick = () => {
      const n = Math.min(words, Math.ceil(((performance.now() - start) / 1000) * rate))
      setShown({ seq, words: n })
      if (n < words) frame = requestAnimationFrame(tick)
      else setShown(null)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [seq, body, m?.rts, m?.ts])
  if (!shown || shown.seq !== seq) return { text: body, revealing: false }
  let left = shown.words
  let out = ""
  for (const p of body.split(/(\s+)/)) {
    if (p.trim()) {
      if (!left) break
      left--
    }
    out += p
  }
  return { text: out, revealing: true }
}

export interface TeamPart {
  key: string
  label: string
  onClick?: () => void
  tone?: "decide"
}

/** In the whole conversation, the way back to the Room: the coordinator and its team. */
export function FocusButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-meta text-ink-3 transition-colors hover:bg-wash hover:text-ink" title={`${name} and the team (Esc in the message field)`}>
      Room
      <Icon icon={ArrowRight01Icon} size={12} />
    </button>
  )
}
