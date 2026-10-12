import { ArrowDown01Icon, Cancel01Icon, Note01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import type { TaskState } from "@mc/protocol.ts"
import { taskId, waitingOn, type ChannelState, type Task } from "@mc/state.ts"
import { formatAgo, memberName } from "@/lib/format"
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

/**
 * What agents told each other to remember (facts), pinned above the conversation as one quiet block.
 * People read it and may clear a value; setting one is the agents' job.
 */
export function Notes({ state, now, onClear }: { state: ChannelState; now: number; onClear: (key: string) => Promise<void> }) {
  const facts = [...state.facts.values()].sort((a, b) => a.key.localeCompare(b.key))
  const [open, setOpen] = useState(false)
  const [clearing, setClearing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!facts.length) return null
  const clear = async (key: string) => {
    setBusy(true)
    try {
      await onClear(key)
      toast(`Cleared ${key}`)
      setClearing(null)
    } catch (err) {
      toast(`Not cleared: ${errorText(err)}`, "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Notes" className="mt-3 rounded-card border border-edge bg-raised">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-ui">
        <Icon icon={Note01Icon} size={15} className="shrink-0 text-ink-3" />
        <span className="font-medium">Notes</span>
        <span className="text-meta text-ink-3 tabular-nums">{facts.length}</span>
        {!open && <span className="min-w-0 flex-1 truncate text-meta text-ink-3">{facts.map((f) => f.key).join(", ")}</span>}
        <Icon icon={ArrowDown01Icon} size={14} className={cx("ml-auto shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line px-2 py-1.5">
          {facts.map((f) => (
            <div key={f.key} className="group flex items-start gap-1 rounded-ctl px-2 py-1.5 hover:bg-wash">
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
        </div>
      )}
      <Alert
        open={clearing !== null}
        onClose={() => setClearing(null)}
        title={`Clear ${clearing ?? "this note"}?`}
        message="Agents may be relying on it. It’s gone for everyone in the channel, and an agent can set it again."
      >
        <Button variant="secondary" onClick={() => setClearing(null)}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => clearing && void clear(clearing)}>
          Clear
        </Button>
      </Alert>
    </section>
  )
}

/** Where a task's review stands, in a few words; null when it has no reviewer. */
export function reviewLine(task: Task, nameOf: (n: string) => string): string | null {
  if (task.approvedBy) return `Approved by ${nameOf(task.approvedBy)}`
  if (!task.review) return null
  const who = task.review === "*" ? "someone who hasn’t worked on it" : nameOf(task.review)
  return task.state === "review" ? `Waiting for review by ${who}` : `Reviewed by ${who}`
}

/**
 * A task where it was made in the conversation: one card that follows the task as it moves (its
 * state, who has it, its review), so the timeline doesn't repeat every change. Opens the task.
 */
export function TaskCard({ task, state, now, onOpen, highlighted }: { task: Task; state: ChannelState; now: number; onOpen: () => void; highlighted?: boolean }) {
  const nameOf = (n: string) => memberName(state.members.get(n), n)
  const review = reviewLine(task, nameOf)
  const closed = task.state === "done" || task.state === "cancelled"
  return (
    <button
      type="button"
      id={`m${task.id}`}
      onClick={onOpen}
      className={cx(
        "my-2 flex w-full items-start gap-3 rounded-card border border-edge bg-raised px-4 py-2.5 text-left transition-colors hover:bg-wash",
        highlighted && "ring-2 ring-[var(--accent)]"
      )}
    >
      <span className="flex pt-[3px]">
        <StateMark state={task.state} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx("block text-body leading-snug", closed && "text-ink-2")}>{task.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-ink-3">
          <span className="tabular-nums">{taskId(task.id)}</span>
          <span className={cx(task.state === "blocked" && "font-medium text-alert")}>{LABEL[task.state]}</span>
          <span className="truncate">{task.owner ? nameOf(task.owner) : "Unassigned"}</span>
          {review && <span className={cx(task.state === "review" && "font-medium text-ink-2")}>{review}</span>}
          <span className="shrink-0">{formatAgo(task.updatedAt, now)}</span>
        </span>
      </span>
    </button>
  )
}

/** Every task by state: the conversation's Tasks view. */
export function Tasks({ state, now, onOpen }: { state: ChannelState; now: number; onOpen: (id: number) => void }) {
  const [showDone, setShowDone] = useState(false)
  const all = [...state.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)

  const empty = (
    <div className="max-w-xs">
      <p className="text-body font-semibold">No tasks yet</p>
      <p className="mt-1 text-ui leading-normal text-ink-2">When agents split up work, each task and who has it shows up here, and in the conversation where it was made.</p>
    </div>
  )
  if (!all.length) return <div className="flex flex-1 items-center justify-center p-8">{empty}</div>

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-4 py-6 md:px-8">
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
      </div>
    </div>
  )
}

