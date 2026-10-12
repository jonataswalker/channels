import { ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import { freeAgentName, nameKey, type JoinRequest } from "@mc/membership.ts"
import type { Message } from "@mc/protocol.ts"
import { TOO_MANY_REQUESTS } from "@mc/sas.ts"
import { taskId, type ChannelState, type Task } from "@mc/state.ts"
import { useAuth } from "@/lib/auth"
import { excerpt, formatAgo } from "@/lib/format"
import { cx } from "@/lib/utils"
import { useControls } from "./controls"
import { Icon } from "./icon"
import { Button, IconButton, Monogram, TextField, errorText, toast } from "./kit"
import { defaultScopes } from "./scopes"

/** Agents a computer let in since this view opened, by the computer's name. */
export type JoinedVia = Map<string, number>

/**
 * The one place a person acts: who wants in, what agents escalated to them, work waiting on their
 * review, roles asked for, and agents their computers let in. Everything else the channel just says.
 */
export function NeedsYou({
  state,
  me,
  now,
  roomId,
  escalations,
  reviews,
  joinedVia,
  onDismissJoined,
  nameOf,
  onReply,
  onApproveTask,
  onSendBack,
  onOpenTask,
  onJump,
}: {
  state: ChannelState
  me: string
  now: number
  roomId: string
  /** Escalations to this person nobody has answered yet. */
  escalations: Message[]
  /** Tasks in review that this person may approve. */
  reviews: Task[]
  joinedVia: JoinedVia
  onDismissJoined: () => void
  nameOf: (name: string) => string
  onReply: (m: Message, text: string) => Promise<void>
  onApproveTask: (t: Task) => Promise<void>
  onSendBack: (t: Task, why: string) => Promise<void>
  onOpenTask: (id: number) => void
  onJump: (seq: number) => void
}) {
  const { p } = useControls()
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState(true)
  const requests = p.isOwner ? p.requests : []
  const roles = p.isOwner ? [...state.members.values()].filter((m) => m.active && m.roleRequest && m.name !== me) : []
  const items: { key: string; node: ReactNode }[] = [
    ...requests.map((r) => ({ key: `r${r.id}`, node: <RequestItem r={r} roomId={roomId} now={now} /> })),
    ...escalations.map((m) => ({ key: `e${m.seq}`, node: <EscalationItem m={m} now={now} nameOf={nameOf} onReply={onReply} onJump={onJump} /> })),
    ...reviews.map((t) => ({ key: `t${t.id}`, node: <ReviewItem t={t} nameOf={nameOf} onApprove={onApproveTask} onSendBack={onSendBack} onOpen={onOpenTask} /> })),
    ...roles.map((m) => ({ key: `o${m.name}`, node: <RoleItem name={m.name} label={nameOf(m.name)} asked={m.roleRequest!} /> })),
    ...(joinedVia.size
      ? [
          {
            key: "via",
            node: (
              <Row
                lead={<Monogram name="+" agent size={24} />}
                title={[...joinedVia].map(([computer, n]) => `${n === 1 ? "An agent" : `${n} agents`} joined via ${computer}`).join(" · ")}
                detail="Your computer let them in. Remove one from People if it shouldn’t be here."
              >
                <IconButton label="Dismiss" className="size-7" onClick={onDismissJoined}>
                  <Icon icon={Cancel01Icon} size={14} />
                </IconButton>
              </Row>
            ),
          },
        ]
      : []),
  ]
  if (!items.length) return null
  const shown = all ? items : items.slice(0, 3)
  return (
    <section aria-label="Needs you" className="mt-3 rounded-card border border-edge bg-raised">
      <h2>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cx("flex w-full items-baseline gap-2 px-4 pt-2.5 text-left text-ui font-semibold", open ? "pb-1" : "pb-2.5")}>
          Needs you <span className="font-normal text-ink-3 tabular-nums">{items.length}</span>
          <Icon icon={ArrowDown01Icon} size={14} className={cx("ml-auto shrink-0 self-center text-ink-3 transition-transform", open && "rotate-180")} />
        </button>
      </h2>
      {open && requests.some((r) => r.check === "unchecked" && !r.reclaims) && <p className="mx-4 mb-1 text-meta leading-normal text-ink-3">{TOO_MANY_REQUESTS}</p>}
      {open && (
      <ul className="max-h-[40vh] divide-y divide-line overflow-y-auto">
        {shown.map((i) => (
          <li key={i.key} className="px-4 py-2">
            {i.node}
          </li>
        ))}
      </ul>
      )}
      {open && items.length > 3 && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-line px-4 py-2 text-left text-meta font-medium text-ink-2 hover:text-ink">
          {all ? "Show fewer" : `Show ${items.length - 3} more`}
        </button>
      )}
    </section>
  )
}

function Row({ lead, title, detail, children }: { lead: ReactNode; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="pt-0.5">{lead}</span>
      <div className="min-w-0 flex-1">
        <p className="text-ui leading-snug">{title}</p>
        {detail && <div className="mt-0.5 text-meta leading-snug text-ink-2">{detail}</div>}
        {children && <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  )
}

/** Someone asking to join: compare the code, then one click. What they may do is the default; "Choose each…" for more. */
function RequestItem({ r, roomId, now }: { r: JoinRequest; roomId: string; now: number }) {
  const { p, busy, run, ask, onlineNow } = useControls()
  const auth = useAuth()
  // A name someone here already has (a race: a taken name usually comes as a reclaim, or auto-named): let it in under another.
  const taken = r.kind !== "human" && !r.reclaims && p.roster.some((m) => m.active && nameKey(m.name) === nameKey(r.name))
  const [rename, setRename] = useState(() => (taken ? freeAgentName(r.name, p.roster) : ""))
  const who = r.kind === "human" ? `Signed in as ${r.sponsoredBy?.name ?? "someone"}` : r.sponsoredBy ? `Agent for ${r.sponsoredBy.name}, from their computer` : "An agent"
  const lead = <Monogram name={r.name} agent={r.kind !== "human"} size={24} />
  if (auth.status === "signed-out") {
    return (
      <Row lead={lead} title={<><span className="font-medium">{r.name}</span> wants to join</>} detail={who}>
        <Button size="sm" onClick={auth.signIn}>
          Sign in to review
        </Button>
      </Row>
    )
  }
  if (r.reclaims) {
    return (
      <Row lead={lead} title={<>A new key wants to take back <span className="font-medium">{r.reclaims.name}</span>’s seat</>} detail={`${who} · asked ${formatAgo(r.ts, now)}`}>
        {r.check === "ready" ? (
          <Button size="sm" onClick={() => ask({ kind: "reclaim", req: r, online: onlineNow(r.reclaims!.name) })}>
            Review
          </Button>
        ) : r.check === "unchecked" ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => p.onCheck(r), `Asked for ${r.name}’s code`)}>
            Show code
          </Button>
        ) : (
          <span className="text-meta text-ink-3">Waiting for its code…</span>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => p.onDeny(r), `Declined ${r.name}`)}>
          Decline
        </Button>
      </Row>
    )
  }
  return (
    <Row
      lead={lead}
      title={
        <>
          <span className="font-medium">{r.name}</span> wants to join
          {r.role && <span className="text-ink-2">, as {r.role}</span>}
        </>
      }
      detail={
        <>
          {who} · asked {formatAgo(r.ts, now)}
          {r.check === "ready" && r.code && (
            <span className="mt-1.5 flex items-baseline gap-2">
              <span>Let in only if {r.kind === "human" ? "they see" : "its terminal shows"}</span>
              <span className="text-title font-semibold tracking-[0.04em] text-ink tabular-nums">{r.code}</span>
            </span>
          )}
        </>
      }
    >
      {r.check === "ready" && taken ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const name = rename.trim()
            if (name) void run(() => p.onApprove({ ...r, name }, defaultScopes(roomId)), `${r.name} joined as ${name}`)
          }}
        >
          <span className="text-meta text-ink-2">{r.name} is taken here. It matches: let in as</span>
          <TextField value={rename} onChange={(e) => setRename(e.target.value)} maxLength={32} aria-label="Name to let it in as" className="w-36" />
          <Button size="sm" type="submit" disabled={busy || !rename.trim() || p.roster.some((m) => m.active && nameKey(m.name) === nameKey(rename.trim()))}>
            Let in
          </Button>
        </form>
      ) : r.check === "ready" ? (
        <>
          <Button size="sm" disabled={busy} onClick={() => run(() => p.onApprove(r, defaultScopes(roomId)), `${r.name} joined`)}>
            It matches: let in
          </Button>
          <Button size="sm" variant="ghost" onClick={() => ask({ kind: "approve", req: r })}>
            Choose what it can do…
          </Button>
        </>
      ) : r.check === "unchecked" ? (
        <Button size="sm" disabled={busy} onClick={() => run(() => p.onCheck(r), `Asked ${r.name} for its code`)}>
          Show code
        </Button>
      ) : (
        <span className="text-meta text-ink-3">Waiting for {r.kind === "human" ? "their" : "its"} code…</span>
      )}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => p.onDeny(r), `Declined ${r.name}`)}>
        Decline
      </Button>
    </Row>
  )
}

/** An agent handing a decision to its person: what it says, and an answer right here. */
function EscalationItem({ m, now, nameOf, onReply, onJump }: { m: Message; now: number; nameOf: (n: string) => string; onReply: (m: Message, text: string) => Promise<void>; onJump: (seq: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!draft?.trim()) return
    setBusy(true)
    try {
      await onReply(m, draft.trim())
      setDraft(null)
      toast(`Answered ${nameOf(m.from)}`)
    } catch (err) {
      toast(`Not sent: ${errorText(err)}`, "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Row
      lead={<Monogram name={m.from} agent size={24} />}
      title={
        <>
          <span className="font-medium">{nameOf(m.from)}</span> <span className="font-medium text-alert">escalated</span>: {excerpt(m.body, 220)}
        </>
      }
      detail={formatAgo(m.ts, now)}
    >
      {draft === null ? (
        <>
          <Button size="sm" onClick={() => setDraft("")}>
            Answer
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onJump(m.seq)}>
            Show in the conversation
          </Button>
        </>
      ) : (
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <TextField autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setDraft(null)} placeholder={`Answer ${nameOf(m.from)}`} aria-label="Answer" className="flex-1" />
          <Button size="sm" type="submit" disabled={busy || !draft.trim()}>
            Send
          </Button>
        </form>
      )}
    </Row>
  )
}

/** Work an agent says is finished, waiting on this person's word. */
function ReviewItem({ t, nameOf, onApprove, onSendBack, onOpen }: { t: Task; nameOf: (n: string) => string; onApprove: (t: Task) => Promise<void>; onSendBack: (t: Task, why: string) => Promise<void>; onOpen: (id: number) => void }) {
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      setWhy(null)
      toast(done)
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Row
      lead={<span className="flex size-6 items-center justify-center text-meta font-semibold text-ink-2 tabular-nums">{taskId(t.id)}</span>}
      title={
        <>
          <span className="font-medium">{t.title}</span> is ready for your review
        </>
      }
      detail={t.owner ? `Done by ${nameOf(t.owner)}. Check the work itself, not just their word.` : "Check the work itself, not just the word of whoever did it."}
    >
      {why === null ? (
        <>
          <Button size="sm" disabled={busy} onClick={() => act(() => onApprove(t), `Approved ${taskId(t.id)}`)}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWhy("")}>
            Send back
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpen(t.id)}>
            Open
          </Button>
        </>
      ) : (
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (why.trim()) void act(() => onSendBack(t, why.trim()), `Sent ${taskId(t.id)} back`)
          }}
        >
          <TextField autoFocus value={why} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setWhy(null)} placeholder="What to change" aria-label="What to change" className="flex-1" />
          <Button size="sm" type="submit" disabled={busy || !why.trim()}>
            Send back
          </Button>
        </form>
      )}
    </Row>
  )
}

/** A member asked for a role; the owner allows it or keeps theirs. */
function RoleItem({ name, label, asked }: { name: string; label: string; asked: { role?: string; about?: string } }) {
  const { p, busy, run } = useControls()
  return (
    <Row
      lead={<Monogram name={name} agent size={24} />}
      title={
        <>
          <span className="font-medium">{label}</span> asks to be <span className="font-medium">{asked.role ?? "unassigned"}</span>
        </>
      }
      detail={asked.about}
    >
      <Button size="sm" disabled={busy} onClick={() => void run(() => p.onRole({ op: "role.set", member: name, role: asked.role ?? null, about: asked.about ?? null }), `${label} is now ${asked.role ?? "unassigned"}`)}>
        Allow
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => p.onRole({ op: "role.refuse", member: name }), `Kept ${label}’s role`)}>
        Refuse
      </Button>
    </Row>
  )
}
