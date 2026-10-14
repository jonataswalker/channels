// What the agents are doing, at a glance, under the composer's field: their faces and one line (who's
// working on what). A click grows the composer upward into the whole team, one row each: what they're
// on (a task opens it), what's queued, or that they're idle or away. Read from the task board every
// member already holds (load.ts), so it says what `kiwi status` says.

import { ArrowUp01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import type { Load } from "@mc/load.ts"
import type { Color } from "@mc/protocol.ts"
import { taskId } from "@mc/state.ts"
import { formatAgo, shortTitle } from "@/lib/format"
import { cx } from "@/lib/utils"
import { CoordinatorAvatar } from "./coordinator-head"
import { Icon } from "./icon"
import { Monogram } from "./kit"

export interface AgentNow {
  name: string
  label: string
  color: Color | null
  online: boolean
  coordinator: boolean
  load: Load
  /** When they last said something in the channel. */
  lastAt?: number
}

const face = (a: AgentNow, size: number) =>
  a.coordinator ? <CoordinatorAvatar size={size} /> : <Monogram name={a.label} agent color={a.color} size={size} online={size > 20 && a.online} />

export function AgentStrip({ agents, now, onOpenTask }: { agents: AgentNow[]; now: number; onOpenTask: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  if (!agents.length) return null
  // Working first, then whoever's here, then whoever's away.
  const ordered = [...agents].sort((a, b) => Number(b.load.current.length > 0) - Number(a.load.current.length > 0) || Number(b.online) - Number(a.online))
  const working = ordered.filter((a) => a.load.current.length > 0)
  const here = agents.filter((a) => a.online).length
  const line = working.length
    ? working
        .slice(0, 2)
        .map((a) => `${a.label} on ${shortTitle(a.load.current[0]!.title)}`)
        .join(" · ") + (working.length > 2 ? ` · ${working.length - 2} more` : "")
    : here
      ? "Nobody's working on a task right now"
      : "No agent is online"

  return (
    <div className="border-t border-line">
      <div className={cx("grid transition-[grid-template-rows] duration-200", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="min-h-0 overflow-hidden">
          <ul aria-label="What the agents are doing" className="max-h-72 overflow-y-auto px-1.5 pt-1.5">
            {ordered.map((a) => (
              <li key={a.name} className="flex items-start gap-3 rounded-ctl px-2 py-2">
                <span className="flex pt-0.5">{face(a, 28)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-ui font-semibold">{a.label}</span>
                    {a.coordinator && <span className="shrink-0 text-stamp text-ink-3">coordinator</span>}
                    <span className="ml-auto shrink-0 text-stamp text-ink-3">{a.online ? "online" : a.lastAt ? `away · ${formatAgo(a.lastAt, now)}` : "away"}</span>
                  </span>
                  {a.load.current.length ? (
                    a.load.current.map((t) => (
                      <button key={t.id} type="button" onClick={() => onOpenTask(t.id)} className="block max-w-full truncate text-left text-meta text-ink-2 hover:text-ink hover:underline">
                        <span className="font-medium text-doing">Working on</span> <span className="tabular-nums">{taskId(t.id)}</span> {t.title}
                      </button>
                    ))
                  ) : (
                    <span className="block text-meta text-ink-3">{a.online ? "Idle" : "Not running"}</span>
                  )}
                  {(a.load.queued.length > 0 || a.load.waiting.length > 0) && (
                    <span className="block text-stamp text-ink-3">
                      {[a.load.queued.length ? `${a.load.queued.length} queued` : null, a.load.waiting.length ? `${a.load.waiting.length} waiting for review` : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-9 w-full items-center gap-2.5 px-3.5 text-left text-meta text-ink-2 transition-colors hover:text-ink">
        <span aria-hidden className="flex shrink-0 -space-x-1.5 [&>*]:rounded-full [&>*]:shadow-[0_0_0_2px_var(--canvas)]">
          {ordered.slice(0, 4).map((a) => (
            <span key={a.name} className="flex">
              {face(a, 20)}
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-ink">{working.length ? `${working.length} working` : `${here} online`}</span> · {line}
        </span>
        <Icon icon={ArrowUp01Icon} size={14} className={cx("shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-180")} />
      </button>
    </div>
  )
}
