import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon, GitPullRequestIcon } from "@hugeicons/core-free-icons"
import { useMemo, useState, type ReactNode } from "react"
import type { Message } from "@mc/protocol.ts"
import { colorOf, taskId, type ChannelState, type Task } from "@mc/state.ts"
import { taskFeed, taskPrs } from "@mc/work.ts"
import { formatAgo, formatFull, memberName } from "@/lib/format"
import { Feed, PrLink } from "./feed"
import { Icon } from "./icon"
import { Button, IconButton, Monogram } from "./kit"
import { Markdown } from "./markdown"
import { isAgent } from "./message"
import { LABEL, StateMark } from "./tasks"

const ORDER = ["doing", "review", "todo", "done"] as const

/** The board's order: in progress, review, open, done; oldest first within each. */
export function boardOrder(state: ChannelState): number[] {
  return [...state.tasks.values()].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.id - b.id).map((t) => t.id)
}

/**
 * One task as its own page, like a Linear issue: what it is, then its whole story as one feed (its
 * events, every thread that names it, the PRs linked there), with its properties beside it.
 * Comments are task notes, so the story stays on the task.
 */
export function TaskPage({
  id,
  state,
  messages,
  me,
  now,
  onOpen,
  onClose,
  noteBlocked,
  onNote,
}: {
  id: number
  state: ChannelState
  messages: Message[]
  me: string
  now: number
  onOpen: (id: number) => void
  onClose: () => void
  /** Why this member can't add notes (their scopes), or null if they can. */
  noteBlocked: string | null
  onNote: (note: string) => Promise<void>
}) {
  const task = state.tasks.get(id)
  const items = useMemo(() => taskFeed(state, messages, id, me), [state, messages, id, me])
  const order = useMemo(() => boardOrder(state), [state])
  const at = order.indexOf(id)

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`Task ${taskId(id)}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4 md:px-5">
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-title font-semibold" aria-label="Breadcrumb">
          <button type="button" onClick={onClose} className="font-medium text-ink-3 hover:text-ink">
            Tasks
          </button>
          <span className="text-ink-3">/</span>
          <span className="tabular-nums">{taskId(id)}</span>
        </nav>
        {at >= 0 && (
          <span className="text-meta text-ink-3 tabular-nums">
            {at + 1} / {order.length}
          </span>
        )}
        <IconButton label="Previous task" disabled={at <= 0} onClick={() => onOpen(order[at - 1]!)}>
          <Icon icon={ArrowUp01Icon} size={16} />
        </IconButton>
        <IconButton label="Next task" disabled={at < 0 || at >= order.length - 1} onClick={() => onOpen(order[at + 1]!)}>
          <Icon icon={ArrowDown01Icon} size={16} />
        </IconButton>
        <IconButton label="Close task" onClick={onClose}>
          <Icon icon={Cancel01Icon} size={16} />
        </IconButton>
      </header>

      {!task ? (
        <div className="p-8">
          <p className="text-body font-semibold">This task is gone</p>
          <p className="mt-1 text-ui text-ink-2">It was pruned from the channel’s history.</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="min-w-0 flex-1">
            <div className="mx-auto max-w-[760px] px-6 pt-8 pb-16">
              <h1 className="flex items-center gap-2.5 text-display font-semibold tracking-[-0.01em]">
                <StateMark state={task.state} />
                <span className="min-w-0">{task.title}</span>
              </h1>
              {task.detail && (
                <div className="mt-2 max-w-[680px] text-body text-ink-2">
                  <Markdown>{task.detail}</Markdown>
                </div>
              )}
              <div className="mt-6 lg:hidden">
                <Properties task={task} state={state} now={now} items={items} />
              </div>
              <h2 className="mt-8 mb-2 text-title font-semibold">Activity</h2>
              <Feed items={items} state={state} now={now} />
              <NoteBox task={task} blocked={noteBlocked} onNote={onNote} />
            </div>
          </div>
          <aside className="hidden w-[272px] shrink-0 border-l border-edge px-5 pt-8 lg:block">
            <Properties task={task} state={state} now={now} items={items} />
          </aside>
        </div>
      )}
    </section>
  )
}

function Properties({ task, state, now, items }: { task: Task; state: ChannelState; now: number; items: ReturnType<typeof taskFeed> }) {
  const prs = taskPrs(items)
  const owner = task.owner ? state.members.get(task.owner) : undefined
  return (
    <dl className="grid grid-cols-2 gap-4 lg:block lg:space-y-4">
      <Prop label="Status">
        <StateMark state={task.state} />
        {LABEL[task.state]}
      </Prop>
      <Prop label="Assignee">
        {task.owner ? (
          <>
            <Monogram name={task.owner} agent={isAgent(owner)} size={18} color={colorOf(state, task.owner)} />
            {memberName(owner, task.owner)}
          </>
        ) : (
          <span className="text-ink-3">Nobody yet</span>
        )}
      </Prop>
      {task.review && (
        <Prop label="Review">
          <span className="text-ink-2">
            {task.review === "*" ? "Anyone who hasn’t worked on it" : memberName(state.members.get(task.review), task.review)}
            {task.approvedBy ? `, approved by ${memberName(state.members.get(task.approvedBy), task.approvedBy)}` : task.state === "review" ? ", waiting" : ""}
          </span>
        </Prop>
      )}
      {prs.length > 0 && (
        <Prop label="Pull requests">
          <span className="grid gap-1">
            {prs.map((pr) => (
              <span key={pr.url} className="flex items-center gap-2">
                <Icon icon={GitPullRequestIcon} size={16} className="text-ink-3" />
                <PrLink pr={pr} />
              </span>
            ))}
          </span>
        </Prop>
      )}
      <Prop label="Created">
        <span className="text-ink-2" title={formatFull(task.createdAt)}>
          by {memberName(state.members.get(task.createdBy), task.createdBy)}, {formatAgo(task.createdAt, now)}
        </span>
      </Prop>
    </dl>
  )
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="mb-1.5 text-meta font-medium text-ink-3">{label}</dt>
      <dd className="flex items-center gap-2 text-ui">{children}</dd>
    </div>
  )
}

/** Comments are task notes: they stay on the task, and the board shows them. */
function NoteBox({ task, blocked, onNote }: { task: Task; blocked: string | null; onNote: (note: string) => Promise<void> }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  if (blocked) return <p className="mt-4 rounded-card border border-edge bg-raised px-4 py-3 text-ui text-ink-3">{blocked}</p>
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await onNote(text.trim())
      setText("")
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="mt-4 flex items-end gap-2 rounded-card border border-edge bg-raised px-4 py-3 focus-within:border-edge-strong"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
        }}
        rows={1}
        aria-label={`Comment on ${taskId(task.id)}`}
        placeholder={`Comment on ${taskId(task.id)}…`}
        className="min-h-[22px] flex-1 resize-none bg-transparent text-body outline-none placeholder:text-ink-3"
      />
      <Button type="submit" size="sm" disabled={!text.trim() || busy}>
        Comment
      </Button>
    </form>
  )
}
