// Coordinator mode's own view of Main: one teammate, face to face. The coordinator's head fills the
// top of the pane, and under it what it said to you last, in large calm type, with what you said
// before it above, so the exchange reads as a dialogue. A quiet line says what its team is doing;
// what needs you sits under its words. The whole conversation is one control away.

import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

import type { Message } from "@mc/protocol.ts"
import type { Mood } from "@/lib/coordinator-mood"
import { excerpt, formatAgo } from "@/lib/format"
import { cx } from "@/lib/utils"
import { CoordinatorHead } from "./coordinator-head"
import { Icon } from "./icon"
import { Markdown } from "./markdown"

/** Which view Main opens on in coordinator mode, per channel: the coordinator up close, or the whole conversation. */
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

/**
 * The head's size: big, but never more than about a third of the pane's height; smaller on a phone.
 * With cards under its words (compact) it steps back, so they fit beside it on a laptop screen.
 */
const headSize = (compact: boolean) =>
  innerWidth < 768 ? (compact ? 112 : 160) : compact ? Math.round(Math.min(180, Math.max(160, innerHeight * 0.19))) : Math.round(Math.min(300, Math.max(220, innerHeight * 0.3)))

function useHeadSize(compact: boolean): number {
  const [size, setSize] = useState(() => headSize(compact))
  const [was, setWas] = useState(compact)
  if (was !== compact) {
    setWas(compact)
    setSize(headSize(compact))
  }
  useEffect(() => {
    const on = () => setSize(headSize(compact))
    addEventListener("resize", on)
    return () => removeEventListener("resize", on)
  }, [compact])
  return size
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
function useReveal(m: Message | undefined): { text: string; revealing: boolean } {
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

export function CoordinatorFocus({
  name,
  mood,
  coordinatorSaid,
  youSaid,
  waiting,
  team,
  needs,
  starters,
  onStarter,
  onShowConversation,
  newCount,
  now,
}: {
  name: string
  mood: Mood | undefined
  /** Its newest message in Main. */
  coordinatorSaid: Message | undefined
  /** Your newest message in Main. */
  youSaid: Message | undefined
  /** You spoke after it last did: it's working on an answer. */
  waiting: boolean
  team: TeamPart[]
  /** What needs you, as a short stack (needs-you.tsx). */
  needs: ReactNode
  starters: string[]
  onStarter: (text: string) => void
  onShowConversation: () => void
  /** Said in Main since you last looked, that this view doesn't show. */
  newCount: number
  now: number
}) {
  const compact = !!needs
  const size = useHeadSize(compact)
  // Drawn once at its full size and scaled: growing or shrinking, the head eases instead of jumping.
  const full = useHeadSize(false)
  const { text, revealing } = useReveal(coordinatorSaid)

  // A long message shows its first lines, with Read all.
  const [all, setAll] = useState(false)
  const [long, setLong] = useState(false)
  const words = useRef<HTMLDivElement>(null)
  // A new message opens folded again.
  const [folded, setFolded] = useState(coordinatorSaid?.seq)
  if (coordinatorSaid?.seq !== folded) {
    setFolded(coordinatorSaid?.seq)
    setAll(false)
  }
  useLayoutEffect(() => {
    const el = words.current
    if (!el || revealing) return
    setLong(el.scrollHeight > el.clientHeight + 2)
  }, [text, all, revealing])

  const pane = useRef<HTMLElement>(null)
  // More below than fits: the bottom edge fades, so a cut never looks like an accident.
  const [more, setMore] = useState(false)
  const measure = () => {
    const el = pane.current
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
  }
  useEffect(() => {
    const el = pane.current
    if (!el) return
    const watch = new ResizeObserver(() => measure())
    watch.observe(el)
    if (el.firstElementChild) watch.observe(el.firstElementChild)
    return () => watch.disconnect()
  }, [])

  const empty = !coordinatorSaid && !youSaid
  // You spoke last: your words stay up top and the head thinks; its last answer stays for context.
  const head = waiting && mood && mood.state !== "sleeping" && mood.state !== "error" ? { ...mood, state: "thinking" as const } : revealing && mood?.state !== "sleeping" ? { ...mood, state: "speaking" as const } : mood

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <section
      ref={pane}
      aria-label={`Up close with ${name}`}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={measure}
    >
      <div className="mx-auto flex w-full max-w-[680px] flex-col items-center px-5 pb-8">
        {/* The head, with room above it to hop and below it for its shadow. */}
        <div className={cx("flex shrink-0 flex-col items-center transition-[padding] duration-300 ease-out", compact ? "pt-[max(16px,3vh)]" : "pt-[max(28px,6vh)]")}>
          <div className="flex justify-center transition-[height] duration-300 ease-out" style={{ height: size }}>
            <div className="origin-top transition-transform duration-300 ease-out" style={{ transform: `scale(${size / full})` }}>
              <CoordinatorHead size={full} mood={head} live interactive seed={0.7} label={`${name}, ${head?.state ?? "idle"}`} />
            </div>
          </div>
          <p className="mt-5 text-title font-semibold tracking-[-0.01em]">{name}</p>
          {mood?.state === "sleeping" && <p className="mt-0.5 text-meta text-ink-3">{mood.paused ? "Paused with every agent, until you resume them" : "Away right now: it reads what you say when it's back"}</p>}
          {team.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1.5 text-meta text-ink-3">
              {team.map((t, i) => (
                <span key={t.key} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>·</span>}
                  {t.onClick ? (
                    <button type="button" onClick={t.onClick} className={cx("rounded-row px-0.5 transition-colors hover:text-ink", t.tone === "decide" && "font-medium text-decide hover:text-decide")}>
                      {t.label}
                    </button>
                  ) : (
                    <span>{t.label}</span>
                  )}
                </span>
              ))}
            </p>
          )}
        </div>

        {/* For a screen reader, its words once, whole, as they arrive. */}
        <p aria-live="polite" className="sr-only">
          {coordinatorSaid ? `${name}: ${coordinatorSaid.body}` : ""}
        </p>
        {/* The dialogue: what you said, then its answer. */}
        <div className={cx("flex w-full flex-col", compact ? "mt-5" : "mt-[max(24px,4vh)]")}>
          {empty ? (
            <div className="animate-rise flex flex-col items-center text-center">
              <p className="text-display font-semibold">Tell {name} what you want done.</p>
              <p className="mt-2 max-w-sm text-ui leading-normal text-ink-2">It plans the work, hands it to the agents here, and comes back to you when something needs a decision.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {starters.map((s) => (
                  <button key={s} type="button" onClick={() => onStarter(s)} className="rounded-full bg-field px-3.5 py-1.5 text-ui text-ink-2 transition-colors hover:bg-wash-2 hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {youSaid && (!coordinatorSaid || waiting || youSaid.seq < coordinatorSaid.seq) && (
                <p key={youSaid.seq} className={cx("mb-4 line-clamp-2 text-ui leading-relaxed text-ink-3", waiting && "animate-sent [transform-origin:bottom_left]")}>
                  <span className="font-medium text-ink-2">You</span> <span className="text-ink-3">{excerpt(youSaid.body, 240)}</span>
                </p>
              )}
              {coordinatorSaid ? (
                <article key={coordinatorSaid.seq} className={cx("relative", !revealing && "animate-arrived")}>
                  {/* Arriving word by word, it's plain text (half a code fence would flicker); whole, it's rendered. */}
                  <div ref={words} aria-hidden={revealing || undefined} className={cx("bubble-text text-hero text-ink [&_pre]:text-ui [&_code]:text-[0.85em]", !all && "max-h-[240px] overflow-hidden")}>
                    {revealing ? <p className="whitespace-pre-wrap">{text}</p> : <Markdown>{text}</Markdown>}
                  </div>
                  {!all && long && !revealing && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-canvas to-transparent" />}
                  {waiting && <p className="mt-3 text-meta text-ink-3">{name} is on it…</p>}
                  <div className="mt-3 flex items-center gap-3 text-meta text-ink-3">
                    <span>{formatAgo(coordinatorSaid.rts ?? coordinatorSaid.ts, now)}</span>
                    {!all && long && !revealing && (
                      <button type="button" onClick={() => setAll(true)} className="relative font-medium text-ink-2 hover:text-ink">
                        Read all
                      </button>
                    )}
                  </div>
                </article>
              ) : (
                waiting && <p className="text-hero text-ink-3">{name} is on it…</p>
              )}
            </>
          )}
          {needs && <div className="mt-5 w-full">{needs}</div>}
        </div>

      </div>
    </section>
      <div className="relative shrink-0">
        {/* More below than fits: the bottom edge fades, so a cut never looks like an accident. */}
        <div aria-hidden className={cx("pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-canvas to-transparent transition-opacity duration-200", more ? "opacity-100" : "opacity-0")} />
        {/* The whole conversation, always in reach, never scrolled away. */}
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={onShowConversation}
            title="Show conversation (Esc in the message field)"
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-meta text-ink-3 transition-colors hover:bg-wash hover:text-ink"
          >
            <Icon icon={ArrowDown01Icon} size={12} className="rotate-180" />
            Show conversation
            {newCount > 0 && <span className="text-ink-2">· {newCount} new</span>}
          </button>
        </div>
      </div>
    </div>
  )
}

/** In the whole conversation, the way back to the coordinator up close. */
export function FocusButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-meta text-ink-3 transition-colors hover:bg-wash hover:text-ink" title={`Just ${name}, up close (Esc in the message field)`}>
      Focus
      <Icon icon={ArrowRight01Icon} size={12} />
    </button>
  )
}
