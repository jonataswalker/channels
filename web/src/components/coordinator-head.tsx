// The coordinator's face: an animated robot head (robot-heads, MIT) whose screen shows what it's doing
// (coordinator-mood.ts). Every other member keeps its monogram. The library is loaded on first use, so
// it isn't in the first bundle; until then, and wherever a head would be too many, a plain circle
// stands in.

import { lazy, Suspense, useEffect, useState } from "react"

import type { Mood } from "@/lib/coordinator-mood"
import { cx } from "@/lib/utils"

const RobotHead = lazy(() => import("robot-heads").then((m) => ({ default: m.RobotHead })))

/** A design token as a colour a canvas can use: CSS resolves light-dark() and the theme, not the canvas. */
function resolve(token: string): string {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  probe.style.display = "none"
  document.body.appendChild(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c
}

interface Tones {
  shell: string
  screen: string
  trim: string
}

const read = (): Tones => ({ shell: resolve("--accent"), screen: resolve("--head-screen"), trim: resolve("--head-trim") })

/** The head's colours from the tokens, following the theme (the system's, or the one picked in Settings). */
function useTones(): Tones {
  const [tones, setTones] = useState(read)
  useEffect(() => {
    const update = () => setTones(read())
    const media = matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", update)
    const watch = new MutationObserver(update)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] })
    return () => {
      media.removeEventListener("change", update)
      watch.disconnect()
    }
  }, [])
  return tones
}

export function CoordinatorHead({
  size,
  mood,
  live = false,
  interactive = false,
  seed,
  className,
  label,
}: {
  size: number
  mood?: Mood
  /** Animate it. Off, it rests on its current face: a list of heads shouldn't all move at once. */
  live?: boolean
  /** Follow the pointer and hop on a click: only the big heads. */
  interactive?: boolean
  seed?: number
  className?: string
  label?: string
}) {
  const tones = useTones()
  const fallback = <span className={cx("block shrink-0 rounded-full bg-accent", className)} style={{ width: size, height: size }} aria-hidden />
  return (
    <Suspense fallback={fallback}>
      <RobotHead
        // A still head starts over on its front-facing first frame, never frozen mid-glance.
        key={live ? "live" : "still"}
        size={size}
        state={mood?.state ?? "idle"}
        paused={!live || !!mood?.paused}
        interactive={interactive}
        antenna={size > 32}
        floorShadow={size > 64}
        color={tones.shell}
        screenColor={tones.screen}
        trimColor={tones.trim}
        seed={seed}
        className={cx("shrink-0", className)}
        role="img"
        aria-label={label ?? `Coordinator, ${mood?.state ?? "idle"}`}
      />
    </Suspense>
  )
}
