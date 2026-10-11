import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import type { TaskState } from "@mc/protocol.ts"
import { taskId, waitingOn, type ChannelState, type Task } from "@mc/state.ts"
import { formatAgo } from "@/lib/format"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Alert, Button, IconButton, errorText, toast } from "./kit"

export const LABEL: Record<TaskState, string> = { doing: "In progress", blocked: "Blocked", review: "In review", todo: "To do", done: "Done", cancelled: "Cancelled" }
const ORDER: TaskState[] = ["blocked", "doing", "review", "todo", "done", "cancelled"]

/** A task's state as a small circle: empty, half full, dashed, red, or checked. Ink only, except blocked. */
export function StateMark({ state }: { state: TaskState }) {
  if (state === "done") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-ink text-canvas">
        <Icon icon={Tick02Icon} size={11} strokeWidth={2.6} />
      </span>
    )
  }
  if (state === "cancelled") {
    return <span title="Cancelled" className="block size-4 shrink-0 rounded-full border-[1.5px] border-ink-3 opacity-60" />
  }
  return (
    <span
      title={LABEL[state]}
      className={cx(
        "block size-4 shrink-0 rounded-full border-[1.5px]",
        state === "todo" && "border-ink-3",
        state === "doing" && "border-ink-2 bg-[conic-gradient(var(--ink-2)_0_50%,transparent_50%_100%)]",
        state === "review" && "border-dashed border-ink-2",
        state === "blocked" && "border-alert bg-[radial-gradient(var(--alert)_0_38%,transparent_40%)]"
      )}
    />
  )
}

function TaskRow({ task, state, now, onOpen }: { task: Task; state: ChannelState; now: number; onOpen: () => void }) {
  const waits = waitingOn(state, task)
  return (
    <button type="button" onClick={onOpen} className="-mx-3 flex w-[calc(100%+24px)] items-start gap-3 rounded-ctl px-3 py-2 text-left transition-colors hover:bg-wash">
      <span className="flex pt-[3px]">
        <StateMark state={task.state} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx("block text-body leading-snug", (task.state === "done" || task.state === "cancelled") && "text-ink-2")}>{task.title}</span>
        <span className="mt-0.5 flex items-center gap-3 text-meta text-ink-3">
          <span className="tabular-nums">{taskId(task.id)}</span>
          <span className="truncate">{task.owner ?? "Unassigned"}</span>
          {waits.length > 0 && <span className="shrink-0">Waits on {waits.map(taskId).join(", ")}</span>}
          {task.notes.length > 0 && <span className="shrink-0">{task.notes.length === 1 ? "1 note" : `${task.notes.length} notes`}</span>}
          <span className="shrink-0">{formatAgo(task.updatedAt, now)}</span>
        </span>
      </span>
    </button>
  )
}

function minutesLeft(expires: number, now: number) {
  const m = Math.max(0, Math.round((expires - now) / 60_000))
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`
}

/** What's held and what's known: claimed paths, and the facts agents set for each other. */
function Board({ state, now, onForgetFact }: { state: ChannelState; now: number; onForgetFact: (key: string) => Promise<void> }) {
  const facts = [...state.facts.values()].sort((a, b) => a.key.localeCompare(b.key))
  const [clearing, setClearing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!state.claims.length && !facts.length) return null
  const clear = async (key: string) => {
    setBusy(true)
    try {
      await onForgetFact(key)
      toast(`Cleared ${key}`)
      setClearing(null)
    } catch (err) {
      toast(`Not cleared: ${errorText(err)}`, "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 grid gap-7 border-t border-line pt-6 md:grid-cols-2">
      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-ui font-semibold">Claimed paths</h3>
          <span className="text-meta text-ink-3 tabular-nums">{state.claims.length}</span>
        </div>
        {state.claims.length === 0 && <p className="text-ui text-ink-3">Nobody’s holding a path.</p>}
        {state.claims.map((c) => (
          <div key={`${c.owner}:${c.path}`} className="py-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <code className="truncate font-mono text-ui">{c.path}</code>
              <span className="shrink-0 text-meta text-ink-3">{minutesLeft(c.expires, now)}</span>
            </div>
            <p className="truncate text-meta text-ink-3">{c.note ? `${c.owner}: ${c.note}` : c.owner}</p>
          </div>
        ))}
      </section>
      <section>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-ui font-semibold">Facts</h3>
          <span className="text-meta text-ink-3 tabular-nums">{facts.length}</span>
        </div>
        {facts.length === 0 && <p className="text-ui text-ink-3">No shared values yet.</p>}
        {facts.map((f) => (
          <div key={f.key} className="group -mx-2 flex items-start gap-1 rounded-ctl px-2 py-1.5 hover:bg-wash">
            <button type="button" className="min-w-0 flex-1 text-left" title="Copy value" onClick={() => navigator.clipboard.writeText(f.value).then(() => toast(`Copied ${f.key}`))}>
              <p className="flex min-w-0 items-baseline gap-2 text-ui">
                <span className="shrink-0 font-medium">{f.key}</span>
                <span className="truncate font-mono text-ink-2" title={f.value}>
                  {f.value}
                </span>
              </p>
              <p className="text-meta text-ink-3">
                {f.by} · {formatAgo(f.ts, now)}
              </p>
            </button>
            <IconButton
              label={`Clear ${f.key}`}
              className="size-7 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              onClick={() => setClearing(f.key)}
            >
              <Icon icon={Cancel01Icon} size={14} />
            </IconButton>
          </div>
        ))}
      </section>
      <Alert
        open={clearing !== null}
        onClose={() => setClearing(null)}
        title={`Clear ${clearing ?? "this fact"}?`}
        message="Agents may be relying on it. It’s gone for everyone in the channel, and anyone can set it again."
      >
        <Button variant="secondary" onClick={() => setClearing(null)}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => clearing && void clear(clearing)}>
          Clear
        </Button>
      </Alert>
    </div>
  )
}

/** The board: tasks by state, then claims and facts. `top` sits above it in the same column (the Work overview). */
export function Tasks({ state, now, onOpen, onForgetFact, top }: { state: ChannelState; now: number; onOpen: (id: number) => void; onForgetFact: (key: string) => Promise<void>; top?: ReactNode }) {
  const [showDone, setShowDone] = useState(false)
  const all = [...state.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)

  const empty = (
    <div className="max-w-xs">
      <p className="text-body font-semibold">No tasks yet</p>
      <p className="mt-1 text-ui leading-normal text-ink-2">When agents split up work with kiwi task add, each task and who holds it shows up here.</p>
    </div>
  )
  if (!all.length && !state.claims.length && !state.facts.size && !top) {
    return <div className="flex flex-1 items-center justify-center p-8">{empty}</div>
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={cx("mx-auto px-4 py-6 md:px-8", top ? "max-w-[880px]" : "max-w-[760px]")}>
        {top && <div className="mb-8">{top}</div>}
        {top && all.length > 0 && <h2 className="mb-3 text-title font-semibold">Board</h2>}
        {!all.length && !state.claims.length && !state.facts.size && empty}
        {ORDER.map((s) => {
          const list = all.filter((t) => t.state === s)
          if (!list.length) return null
          const closed = s === "done" || s === "cancelled"
          return (
            <section key={s} className="mb-7">
              <div className="mb-1 flex items-baseline gap-2">
                <h3 className={cx("text-ui font-semibold", s === "blocked" ? "text-alert" : "text-ink")}>{LABEL[s]}</h3>
                <span className="text-meta text-ink-3 tabular-nums">{list.length}</span>
                {closed && (
                  <button type="button" className="ml-auto text-meta font-medium text-ink-2 hover:text-ink" onClick={() => setShowDone((v) => !v)}>
                    {showDone ? "Hide" : "Show"}
                  </button>
                )}
              </div>
              {(!closed || showDone) && list.map((t) => <TaskRow key={t.id} task={t} state={state} now={now} onOpen={() => onOpen(t.id)} />)}
            </section>
          )
        })}
        {!all.length && <p className="mb-7 text-ui text-ink-3">No tasks yet.</p>}
        <Board state={state} now={now} onForgetFact={onForgetFact} />
      </div>
    </div>
  )
}

