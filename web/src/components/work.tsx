import { useMemo, type ReactNode } from "react"
import type { Message } from "@mc/protocol.ts"
import { colorOf, taskId, type ChannelState } from "@mc/state.ts"
import { agentRows, needsPerson, recentChanges, type AgentRow, type AgentStatus } from "@mc/work.ts"
import { formatAgo, formatFull, memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { PrLink } from "./feed"
import { Monogram } from "./kit"

/**
 * The Work overview (T1150): what every agent is doing right now, what changed, and what's waiting
 * on a person, above the board. Read from the folded state; in strict coordinator-only mode it
 * shows a person nothing an agent said to another agent.
 */
export function WorkOverview({
  state,
  messages,
  me,
  now,
  online,
  onOpenTask,
  onOpenMessage,
}: {
  state: ChannelState
  messages: Message[]
  me: string
  now: number
  online: { has(name: string): boolean; keys(): Iterable<string> }
  onOpenTask: (id: number) => void
  onOpenMessage: (seq: number) => void
}) {
  const here = useMemo(() => new Set(online.keys()), [online])
  const rows = useMemo(() => agentRows(state, messages, me, here, now), [state, messages, me, here, now])
  const changes = useMemo(() => recentChanges(state, messages, 6), [state, messages])
  const needs = useMemo(() => needsPerson(state, me), [state, me])
  const counts = rows.reduce<Partial<Record<AgentStatus, number>>>((c, r) => ((c[r.status] = (c[r.status] ?? 0) + 1), c), {})
  const summary = (["working", "blocked", "idle", "offline"] as const)
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ")

  return (
    <div className="grid gap-8">
      {rows.length > 0 && (
        <section aria-label="Agents">
          <SectionHead title="Agents" note={summary} />
          <ul className="overflow-hidden rounded-card border border-edge bg-raised">
            {rows.map((r, i) => (
              <AgentLine key={r.name} row={r} state={state} now={now} first={i === 0} onOpenTask={onOpenTask} />
            ))}
          </ul>
        </section>
      )}

      {(changes.length > 0 || needs.length > 0) && (
        <div className="grid gap-8 md:grid-cols-2">
          {changes.length > 0 && (
            <section aria-label="Recent changes">
              <SectionHead title="Recent changes" />
              <ol className="grid">
                {changes.map((c) => (
                  <li key={c.seq} className="py-1 text-ui text-ink-3">
                    {c.task !== undefined ? (
                      <button type="button" onClick={() => onOpenTask(c.task!)} className="text-left hover:text-ink-2">
                        <Change name={memberName(state.members.get(c.actor), c.actor)} text={c.text} at={c.at} now={now} />
                      </button>
                    ) : (
                      <Change name={memberName(state.members.get(c.actor), c.actor)} text={c.text} at={c.at} now={now} />
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {needs.length > 0 && (
            <section aria-label="Needs a person">
              <SectionHead title="Needs a person" note={String(needs.length)} />
              <ul className="overflow-hidden rounded-card border border-edge bg-raised">
                {needs.map((n, i) => (
                  <li key={n.seq} className={cx(i > 0 && "border-t border-edge")}>
                    <button type="button" onClick={() => onOpenMessage(n.seq)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-wash">
                      <span className={cx("size-1.5 shrink-0 rounded-full", n.kind === "blocking" ? "bg-alert" : "bg-ink-3")} />
                      <span className="min-w-0 flex-1 truncate text-ui">
                        <span className="font-medium">{memberName(state.members.get(n.from), n.from)}</span>
                        <span className="text-ink-2"> {n.kind === "blocking" ? "is blocked:" : "asks:"} </span>
                        {n.text}
                      </span>
                      <time className="shrink-0 text-meta text-ink-3" title={formatFull(n.at)}>
                        {formatAgo(n.at, now)}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-2 text-title font-semibold">
      {title}
      {note && <span className="text-meta font-normal text-ink-3">{note}</span>}
    </h2>
  )
}

function Change({ name, text, at, now }: { name: string; text: string; at: number; now: number }) {
  return (
    <>
      <span className="font-medium text-ink-2">{name}</span> {text}
      <span className="text-meta">
        {" · "}
        <time title={formatFull(at)}>{formatAgo(at, now)}</time>
      </span>
    </>
  )
}

const CHIP: Record<AgentStatus, { label: (r: AgentRow, now: number) => string; dot: string }> = {
  working: { label: () => "Working", dot: "bg-live" },
  blocked: { label: (r, now) => `Blocked ${since(r.since, now)}`, dot: "bg-warn" },
  idle: { label: (r, now) => `Idle ${since(r.since, now)}`, dot: "bg-ink-3" },
  offline: { label: () => "Away", dot: "bg-transparent border border-ink-3" },
}

/** "20 min", "3 h", "2 d": how long, without "ago". */
function since(ts: number, now: number): string {
  const m = Math.max(1, Math.round((now - ts) / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`
}

function AgentLine({ row, state, now, first, onOpenTask }: { row: AgentRow; state: ChannelState; now: number; first: boolean; onOpenTask: (id: number) => void }) {
  const chip = CHIP[row.status]
  return (
    <li className={cx("grid grid-cols-[20px_minmax(0,1fr)] items-start gap-3 px-4 py-3 md:grid-cols-[20px_140px_minmax(0,1fr)_auto] md:items-center", !first && "border-t border-edge")}>
      <Monogram name={row.name} agent size={20} color={colorOf(state, row.name)} online={row.online} />
      <div className="min-w-0">
        <p className="truncate text-ui font-medium">{memberName(state.members.get(row.name), row.name)}</p>
        {row.role && <p className="truncate text-meta text-ink-3">{row.role}</p>}
      </div>
      <div className="col-start-2 min-w-0 md:col-start-auto">
        {row.doing ? (
          <button type="button" onClick={() => onOpenTask(row.doing!.id)} className="block max-w-full truncate text-left text-ui hover:underline">
            <span className="mr-1.5 text-ink-3 tabular-nums">{taskId(row.doing.id)}</span>
            {row.doing.title}
          </button>
        ) : (
          <p className="text-ui text-ink-3">Nothing in progress</p>
        )}
        {row.statusLine && <p className="truncate text-meta text-ink-3" title={row.statusLine.text}>{row.statusLine.text}</p>}
      </div>
      <Facts>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-wash px-2 py-0.5 text-meta font-medium text-ink-2">
          <span className={cx("size-1.5 rounded-full", chip.dot)} />
          {chip.label(row, now)}
        </span>
        {row.claims.length > 0 && <span title={row.claims.map((c) => c.path).join("\n")}>{row.claims.length === 1 ? "1 claim" : `${row.claims.length} claims`}</span>}
        {row.prs.slice(0, 2).map((pr) => (
          <PrLink key={pr.url} pr={pr} />
        ))}
        <time title={formatFull(row.lastActive)}>{formatAgo(row.lastActive, now)}</time>
      </Facts>
    </li>
  )
}

function Facts({ children }: { children: ReactNode }) {
  return <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta whitespace-nowrap text-ink-3 md:col-start-auto md:justify-end">{children}</div>
}
