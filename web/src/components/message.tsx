import { ArrowTurnBackwardIcon, Copy01Icon } from "@hugeicons/core-free-icons"
import { memo, useState, type ReactNode } from "react"

import { describeEvent } from "@mc/format.ts"
import { ignored, type Color, type Message, type Trust } from "@mc/protocol.ts"
import type { ChannelState, Member } from "@mc/state.ts"
import { excerpt, formatAgo, formatFull, formatStamp, memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Monogram, toast } from "./kit"
import { Markdown } from "./markdown"

/** Anyone who isn't a signed-in person is an agent. */
export const isAgent = (m: Pick<Member, "kind"> | undefined) => m?.kind !== "human"

/** Who wrote a message, as far as the transcript needs to know. */
export type Author = Pick<Member, "name" | "kind" | "display" | "sponsor">

/** Time passing in the conversation: a small centred stamp, as Messages puts between bubbles. */
export function TimeMark({ ts }: { ts: number }) {
  return (
    <div className="mt-5 mb-1.5 text-center select-none">
      <time className="text-stamp font-medium text-ink-3" dateTime={new Date(ts).toISOString()} title={formatFull(ts)}>
        {formatStamp(ts)}
      </time>
    </div>
  )
}

/** Something that happened rather than something said: one small, centred line between the bubbles. */
export function EventRow({ m, state, now, onOpenTask, openLabel = "Open" }: { m: Message; state: ChannelState; now: number; onOpenTask?: (id: number) => void; openLabel?: string }) {
  const taskRef = m.ev && "task" in m.ev ? m.ev.task : m.ev?.op === "task.add" ? m.seq : null
  const forged = ignored(state.trust.get(m.seq))
  return (
    <p id={`m${m.seq}`} className={cx("mx-auto max-w-[min(60ch,90%)] py-0.5 text-center text-stamp leading-[15px] text-ink-3 [text-wrap:balance]", forged && "line-through opacity-60")}>
      <span className="font-semibold">{memberName(state.members.get(m.from), m.from)}</span> {describeEvent(m, state)}
      <span>
        {" · "}
        <time title={formatFull(m.ts)}>{formatAgo(m.rts ?? m.ts, now)}</time>
      </span>
      {taskRef !== null && onOpenTask && (
        <button type="button" onClick={() => onOpenTask(taskRef)} className="ml-1.5 font-medium text-accent hover:underline">
          {openLabel}
        </button>
      )}
    </p>
  )
}

/** Forged events, and events aimed at this member, stay on their own line. */
export function standsAlone(m: Message, state: ChannelState, me: string): boolean {
  if (ignored(state.trust.get(m.seq))) return true
  const ev = m.ev
  if (!ev) return false
  if ((ev.op === "role.set" || ev.op === "role.refuse") && ev.member === me) return true
  if (ev.op === "task.add" && ev.owner === me) return true
  if (ev.op === "task.update" && ev.owner === me) return true
  return false
}

function englishList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** A same-day run of events. Three or more collapse to the latest, with a line to open the rest. */
export function EventGroup({ messages, state, now, onOpenTask, highlight, openLabel }: { messages: Message[]; state: ChannelState; now: number; onOpenTask?: (id: number) => void; highlight: number | null; openLabel?: string }) {
  const [open, setOpen] = useState(false)
  const row = (m: Message) => <EventRow key={m.seq} m={m} state={state} now={now} onOpenTask={onOpenTask} openLabel={openLabel} />
  if (messages.length < 3) return <div className="my-1.5">{messages.map(row)}</div>
  const forced = highlight !== null && messages.some((m) => m.seq === highlight)
  const shown = open || forced
  const earlier = messages.slice(0, -1)
  const last = messages[messages.length - 1]!
  const names = englishList([...new Set(earlier.map((m) => memberName(state.members.get(m.from), m.from)))])
  const n = earlier.length
  return (
    <div className="my-1.5">
      {shown ? messages.map(row) : row(last)}
      <button type="button" aria-expanded={shown} onClick={() => setOpen(!shown)} className="mx-auto block rounded-row text-stamp text-ink-3 hover:text-ink-2">
        {shown ? "Hide earlier updates" : `${names}: ${n} earlier update${n === 1 ? "" : "s"}`}
      </button>
    </div>
  )
}

/** What a message asks of the reader, in a few words above its bubble. */
function phrase(m: Message, me: string, nameOf: (n: string) => string, repliedTo: Set<string>): { text: string; alert?: boolean } | null {
  // Questions and blockers always say who they're for; plain messages only when the text doesn't already.
  const named = (t: string) => m.body.includes(`@${t}`) || repliedTo.has(t)
  const targets = m.kind === "ask" || m.kind === "blocking" ? (m.to ?? []) : (m.to ?? []).filter((t) => !named(t))
  // "*" is how a broadcast to all is addressed; say it in words.
  const to = targets.map((t) => (t === "*" ? "everyone" : t === me ? "you" : nameOf(t)))
  const list = to.length > 1 ? `${to.slice(0, -1).join(", ")} and ${to[to.length - 1]}` : to[0]
  // An agent handing a decision to people: as loud as a blocker, and named for what it is.
  if (m.esc) return { text: list ? `escalated to ${list}` : "escalated", alert: true }
  switch (m.kind) {
    case "ask":
      return { text: list ? `asks ${list}` : "asks everyone" }
    case "blocking":
      return { text: list ? `is blocked, needs ${list}` : "is blocked", alert: true }
    case "done":
      return { text: "finished" }
    case "status":
      return { text: "update" }
    case "ack":
      return { text: "acknowledged" }
    default:
      return list ? { text: `to ${list}` } : null
  }
}

interface BubbleProps {
  m: Message
  me: string
  /** Coordinator-only: an agent sent this to a person directly, not through this coordinator. */
  direct?: string
  /** Found by the key that signed the message, so two members sharing a name still read right. */
  author?: Author
  trust?: Trust
  online: boolean
  /** The first bubble of a run from one sender: it carries the sender's name (in a group). */
  first: boolean
  /** The last bubble of a run: it carries the tail, and the sender's face beside it. */
  last: boolean
  /** More than two people here: name who's talking. */
  group: boolean
  /** The message right above is the one this replies to, so there's no need to quote it. */
  adjacentReply: boolean
  highlighted: boolean
  quoted: (seq: number) => Message | undefined
  nameOf: (name: string) => string
  onReply?: (m: Message) => void
  onJump: (seq: number) => void
  /** The thread this message starts, when it has replies: "1 Reply" under it. */
  thread?: ThreadSummary
  onOpenThread?: (root: number) => void
  /** Anchor ids are `m<seq>` in the conversation; the thread panel uses its own prefix so a root can appear in both. */
  anchor?: string
  /** The author's colour: a person's own pick, or their person's for an agent (colorOf). */
  color?: Color | null
  /** A face other than the monogram at the run's foot: the coordinator's head. */
  face?: ReactNode
}

export interface ThreadSummary {
  count: number
  last: number
  people: { name: string; label: string; agent: boolean; color?: Color | null }[]
  /** A reply is addressed to the reader. */
  forYou: boolean
}

/**
 * One message as a bubble: yours on the right in blue, everyone else's on the left in grey with
 * their face at the foot of the run. An escalation is tinted red; a forged one (shown only when the
 * owner asks) is struck through.
 */
export const Bubble = memo(function Bubble({ m, me, author, trust, online, first, last, group, adjacentReply, highlighted, quoted, nameOf, onReply, onJump, thread, onOpenThread, anchor = "m", color, direct, face }: BubbleProps) {
  const forged = ignored(trust)
  const mine = m.from === me
  const repliedTo = new Set((m.re ?? []).map((seq) => quoted(seq)?.from).filter((f): f is string => !!f))
  // Your own bubbles don't need saying who they're to, unless you handed something to people.
  const said = mine && !m.esc ? null : phrase(m, me, nameOf, repliedTo)
  const sponsor = author?.sponsor && isAgent(author) ? `Agent for ${author.sponsor.name}` : isAgent(author) ? "Agent" : "Person"
  const who = memberName(author, m.from)
  // Image-only messages carry the file names as their body; don't print them.
  const imageOnly = !!m.imgs?.length && m.body === m.imgs.map((i) => i.name).join(", ")
  const alert = !!m.esc || m.kind === "blocking"
  const tone = mine ? "var(--bubble-me)" : alert ? "var(--bubble-alert)" : "var(--bubble-them)"
  // Quote what this answers, unless it's the bubble right above.
  const quotes = adjacentReply ? [] : (m.re ?? []).map((seq) => ({ seq, q: quoted(seq) })).filter(({ q }) => !q || q.kind !== "event")

  return (
    <div id={`${anchor}${m.seq}`} className={cx("group/b relative flex items-end gap-2", mine ? "justify-end pl-12" : "pr-12", first ? "mt-2.5" : "mt-0.5")}>
      {!mine && <div className="w-7 shrink-0 self-end">{last && (face ?? <Monogram name={who} agent={isAgent(author)} online={online} color={color} size={28} />)}</div>}

      <div className={cx("flex min-w-0 max-w-[min(78%,620px)] flex-col", mine ? "items-end" : "items-start")}>
        {first && (!mine || said) && (
          <p className={cx("mb-0.5 flex max-w-full items-baseline gap-1 px-3 text-stamp text-ink-3", mine && "justify-end")}>
            {!mine && group && (
              <span className="truncate font-medium" title={sponsor}>
                {who}
              </span>
            )}
            {said && <span className={cx("truncate", said.alert && "font-semibold text-alert")}>{said.text}</span>}
          </p>
        )}

        {quotes.map(({ seq, q }) => (
          <button key={seq} type="button" onClick={() => onJump(seq)} className={cx("mb-0.5 flex max-w-full items-center gap-1 px-3 text-left text-stamp text-ink-3 transition-colors hover:text-ink-2", mine && "self-end")}>
            <Icon icon={ArrowTurnBackwardIcon} size={12} className="shrink-0" />
            <span className="truncate">
              <span className="font-medium text-ink-2">{q ? nameOf(q.from) : "Earlier message"}</span> {q ? excerpt(q.body, 80) : ""}
            </span>
          </button>
        ))}

        {!imageOnly && (
          <div
            style={{ ["--bubble-tone" as string]: tone }}
            className={cx(
              "bubble-text isolate max-w-full min-w-0 rounded-bubble px-3 py-[7px] text-body [&_pre]:max-w-full",
              last && "bubble-tail",
              last && (mine ? "from-me" : "from-them"),
              mine ? "bg-bubble-me text-bubble-me-ink [&_a]:text-bubble-me-ink [&_a]:decoration-white/50 [&_code]:bg-white/20 [&_pre]:border-white/20 [&_pre]:bg-black/15 [&_pre]:text-white [&_li]:marker:text-white/70" : alert ? "bg-bubble-alert text-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--alert)_28%,transparent)]" : "bg-bubble-them text-bubble-them-ink",
              forged && "line-through opacity-60",
              highlighted && "animate-flash outline-2 outline-offset-2 outline-[var(--accent)]"
            )}
          >
            <Markdown>{m.body}</Markdown>
          </div>
        )}

        {m.imgs?.length ? (
          <div className={cx("mt-0.5 flex flex-wrap gap-1", mine && "justify-end")}>
            {m.imgs.map((img, i) => {
              const url = `data:${img.mime};base64,${img.data}`
              return (
                <a key={i} href={url} target="_blank" rel="noreferrer" title={img.name}>
                  <img src={url} alt={img.name} loading="lazy" className="max-h-72 max-w-full rounded-bubble object-cover shadow-[0_0_0_0.5px_var(--line)]" />
                </a>
              )
            })}
          </div>
        ) : null}

        {direct && !forged && <p className="mt-0.5 px-3 text-stamp text-ink-3">Sent directly, not through {nameOf(direct)}.</p>}
        {forged && (
          <p className="mt-0.5 px-3 text-stamp text-alert">
            {trust === "refused" ? `Not allowed by your settings, so every view leaves it out.` : `Forged: not signed by ${m.from}’s key, so every view leaves it out.`}{" "}
            {m.pk ? `Signed by key ${m.pk.slice(0, 8)}.` : "Unsigned."}
          </p>
        )}

        {thread && onOpenThread && (
          <button type="button" onClick={() => onOpenThread(m.seq)} className="mt-0.5 px-3 text-left text-meta font-medium text-accent hover:underline">
            {thread.count === 1 ? "1 Reply" : `${thread.count} Replies`}
            {thread.forYou && <span className="ml-1.5 font-normal text-ink-3">· for you</span>}
          </button>
        )}
      </div>

      {/* Reply and copy, beside the bubble on hover: on its inner side, so they never cover anything. */}
      <div className={cx("absolute bottom-0 hidden items-center gap-0.5 group-focus-within/b:flex group-hover/b:flex", mine ? "left-0" : "right-0")}>
        {onReply && (
          <button type="button" aria-label="Reply" title="Reply" onClick={() => onReply(m)} className="flex size-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-wash-2 hover:text-ink">
            <Icon icon={ArrowTurnBackwardIcon} size={15} />
          </button>
        )}
        <button
          type="button"
          aria-label="Copy text"
          title="Copy text"
          onClick={() => navigator.clipboard.writeText(m.body).then(() => toast("Copied"))}
          className="flex size-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-wash-2 hover:text-ink"
        >
          <Icon icon={Copy01Icon} size={14} />
        </button>
      </div>
    </div>
  )
})
