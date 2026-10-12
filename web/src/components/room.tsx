// The Room: coordinator mode's Main, where you don't read the team, you watch it. The coordinator is
// the one voice, big at the centre; every agent behind it has a face of its own, alive with what it's
// doing, its task and its latest line under it. When the coordinator hands an agent work, a line
// travels from one to the other. What needs you hangs off the face that raised it. Your dialogue with
// the coordinator is docked at the bottom, and a timeline lets you scrub back and watch what happened.

import { ArrowDown01Icon, Cancel01Icon, RotateClockwiseIcon } from "@hugeicons/core-free-icons"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import type { JoinRequest } from "@mc/membership.ts"
import { isColor, type Message } from "@mc/protocol.ts"
import { colorOf, taskId, type ChannelState, type Task } from "@mc/state.ts"
import { coordinatorMood, ERROR_MS, moodInputs, type Mood } from "@/lib/coordinator-mood"
import { PALETTE } from "@/lib/characters"
import { excerpt, formatAgo, formatTime } from "@/lib/format"
import { joinCommand } from "@/lib/join-line"
import { AGENT_SPEAKING_MS, agentInputs, agentMood, currentTask, delegations, dialogueOf, flagsByAgent, presentAt, stageAgents, teamEvents } from "@/lib/room"
import { cx } from "@/lib/utils"
import { Command } from "./add-agent"
import { CoordinatorAvatar, CoordinatorHead, type FaceShape } from "./coordinator-head"
import { useReveal, type TeamPart } from "./hero"
import { Icon } from "./icon"
import { hueOf } from "./kit"
import { Markdown } from "./markdown"
import { StateMark } from "./tasks"

// ---------- what each face looks like ----------

const SHAPES: FaceShape[] = ["square", "circle", "hexagon"]
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7)
/** An agent's head, the same every time: one of three outlines (never the coordinator's wide TV) and its colour. */
export function faceOf(name: string, color: string | null): { shape: FaceShape; shell: string } {
  const c = color && isColor(color) ? color : hueOf(name)
  // Green is the coordinator's: an agent of that hue wears teal instead.
  return { shape: SHAPES[hash(name) % SHAPES.length]!, shell: PALETTE[c === "green" ? "teal" : c].fill }
}
const seedOf = (name: string) => (hash(name) % 97) / 97

const reducedMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

const DOCK_KEY = (room: string) => `mc.room.dock.${room}`
function loadDock(room: string): number | null {
  try {
    const n = Number(localStorage.getItem(DOCK_KEY(room)))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
function saveDock(room: string, px: number): void {
  try {
    localStorage.setItem(DOCK_KEY(room), String(Math.round(px)))
  } catch {
    // The height lasts as long as the page.
  }
}

/** The seats beside the coordinator, two to a side; the rest sit in a row under it. */
const FLANK = 4

/**
 * How big things are, from the room the stage has. The coordinator never goes below 200px on a laptop.
 * With room to the sides, the first agents sit beside it (flank), so the stage needs little height;
 * otherwise they sit in a row under it.
 */
function sizes(w: number, h: number, seats: number) {
  const phone = w < 640
  const face = phone ? 72 : seats <= 3 ? 104 : 96
  const side = Math.ceil(Math.min(seats, FLANK) / 2)
  const flank = !phone && seats > 0 && w >= 2 * side * (face + 48) + 420
  const coord = phone ? 120 : Math.round(Math.max(200, Math.min(300, flank ? h - 150 : h * 0.48)))
  return { phone, coord, face, flank }
}

// ---------- the Room ----------

export interface RoomProps {
  roomId: string
  me: string
  coordinator: string
  nameOf: (name: string) => string
  /** The channel now. */
  state: ChannelState
  messages: Message[]
  online: { has: (name: string) => boolean }
  now: number
  /** The coordinator's face now (conversation.tsx reads it the same way). */
  mood: Mood | undefined
  /** You spoke to it and it hasn't answered yet. */
  waiting: boolean
  team: TeamPart[]
  /** What needs you about one agent (its escalations, its tasks in review), as rows for a popover. */
  needsFor: (agent: string) => ReactNode
  /** One join request, as its card's actions. */
  requestFor: (r: JoinRequest) => ReactNode
  /** Join requests waiting on you (the owner's). */
  requests: JoinRequest[]
  escalations: Message[]
  reviews: Task[]
  /** The channel as it stood after a message (the timeline's replay). */
  foldAt: (seq: number) => ChannelState
  /** Is this message in the main conversation. */
  isMain: (m: Message) => boolean
  onOpenAgent: (agent: string) => void
  onOpenTask: (id: number) => void
  onShowConversation: () => void
  newCount: number
  starters: string[]
  onStarter: (text: string) => void
  code: string
  isOwner: boolean
  /** The slim Needs-you banner, at the top of the stage. */
  banner: ReactNode
  /** The point the timeline replays, as the message it stands at (null: live). */
  replay: number | null
  onReplay: (seq: number | null) => void
}

export function Room(p: RoomProps) {
  const stage = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 1000, h: 480 })
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const on = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    on()
    const watch = new ResizeObserver(on)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  // ---------- replay: the stage as it stood at a point in the timeline ----------
  const { replay, onReplay: setReplay } = p
  const { foldAt } = p
  const replayState = useMemo(() => (replay === null ? null : foldAt(replay)), [replay, foldAt])
  const replayMessages = useMemo(() => (replay === null ? null : p.messages.filter((m) => m.seq <= replay)), [replay, p.messages])
  const replayAt = useMemo(() => {
    if (replay === null) return null
    const m = p.messages.find((x) => x.seq === replay)
    return m ? (m.rts ?? m.ts) : null
  }, [replay, p.messages])
  const st = replayState ?? p.state
  const msgs = replayMessages ?? p.messages
  // A face speaks for a few seconds after it posts: a clock that wakes when such a moment starts or ends.
  const [clock, setClock] = useState(0)
  const now = replayAt ?? Math.max(p.now, clock)
  const isOnline = useCallback((n: string) => (replayAt !== null ? presentAt(p.messages, n, replayAt) : p.online.has(n)), [replayAt, p.messages, p.online])
  const coordMood = useMemo(() => {
    if (replayAt === null) return p.mood
    const i = moodInputs(st, msgs, { has: isOnline }, p.coordinator)
    return coordinatorMood({ ...i, online: isOnline(p.coordinator), hold: !!st.hold, now })
  }, [replayAt, p.mood, st, msgs, isOnline, p.coordinator, now])

  // ---------- the faces ----------
  const agents = useMemo(() => stageAgents(st, p.coordinator), [st, p.coordinator])
  const shown = useMemo(() => agents.slice(0, 8), [agents])
  const more = agents.length - shown.length
  const flags = useMemo(() => (replay === null ? flagsByAgent(p.escalations, p.reviews) : new Map()), [replay, p.escalations, p.reviews])
  // Each face's inputs, read once per change of the channel (not per tick of the clock).
  const read = useMemo(() => shown.map((name) => ({ name, task: currentTask(st, name), ...agentInputs(st, msgs, name) })), [shown, st, msgs])
  const faces = read.map((f) => ({ ...f, mood: agentMood({ ...f, online: isOnline(f.name), hold: !!st.hold, now }) }))
  useEffect(() => {
    if (replay !== null) return
    const t = Date.now()
    const ends = read.flatMap((f) => [f.saidAt !== null ? f.saidAt + AGENT_SPEAKING_MS : 0, f.failedAt !== null ? f.failedAt + ERROR_MS : 0]).filter((e) => e > t)
    const timers = [setTimeout(() => setClock(Date.now()), 0), ...(ends.length ? [setTimeout(() => setClock(Date.now()), Math.min(...ends) - t + 50)] : [])]
    return () => timers.forEach(clearTimeout)
  }, [read, replay])
  const ghosts = replay === null ? p.requests : []
  const seatCount = shown.length + (agents.length > shown.length ? 1 : 0) + ghosts.length
  const { phone, coord, face, flank } = sizes(box.w, box.h, seatCount)

  // ---------- delegation: a line from the coordinator to the agent it handed work to ----------
  const coordEl = useRef<HTMLDivElement>(null)
  const blockEl = useRef<HTMLDivElement>(null)
  const faceEls = useRef(new Map<string, HTMLElement>())
  const all = useMemo(() => delegations(p.messages, p.state, p.coordinator), [p.messages, p.state, p.coordinator])
  const seenTo = useRef(all.at(-1)?.seq ?? 0)
  const [flights, setFlights] = useState<{ id: number; d: string }[]>([])
  const [hops, setHops] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const unseen = all.filter((d) => d.seq > seenTo.current)
    if (!unseen.length) return
    seenTo.current = unseen.at(-1)!.seq
    // Only what's handed out now draws a line: history arriving (the cache, a reconnect) doesn't.
    const fresh = unseen.filter((d) => Date.now() - d.at < 10_000)
    if (replay !== null || !fresh.length) return
    // Measured on the next frame, once the faces (a brand-new agent's included) are laid out.
    let done: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      const host = stage.current?.getBoundingClientRect()
      const from = coordEl.current?.getBoundingClientRect()
      const scroll = stage.current?.scrollTop ?? 0
      const calm = reducedMotion()
      const lines: { id: number; d: string }[] = []
      const to = new Set(fresh.map((d) => d.to))
      for (const d of calm ? [] : fresh) {
        const at = faceEls.current.get(d.to)?.getBoundingClientRect()
        if (!host || !from || !at) continue
        const ox = -host.left
        const oy = scroll - host.top
        const head = at.top + Math.min(at.height, face) * 0.45
        const beside = at.right < from.left || at.left > from.right
        if (beside) {
          // An agent beside it: from the coordinator's near ear to the agent's head, a gentle arc.
          const left = at.right < from.left
          const x1 = (left ? from.left : from.right) + ox
          const y1 = from.top + from.height * 0.55 + oy
          const x2 = (left ? at.right - 18 : at.left + 18) + ox
          const y2 = head + oy
          const mx = (x1 + x2) / 2
          lines.push({ id: d.seq, d: `M ${x1} ${y1} C ${mx} ${y1 - 40}, ${mx} ${y2 - 40}, ${x2} ${y2}` })
        } else {
          // An agent under it: from under the coordinator's name and team line, down to the agent's head.
          const x1 = from.left + from.width / 2 + ox
          const y1 = (blockEl.current?.getBoundingClientRect().bottom ?? from.bottom) + 6 + oy
          const x2 = at.left + at.width / 2 + ox
          const y2 = at.top + oy
          const cy = y1 + (y2 - y1) * 0.55
          lines.push({ id: d.seq, d: `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy - 20}, ${x2} ${y2}` })
        }
      }
      setFlights((f) => [...f, ...lines])
      setHops((h) => new Set([...h, ...to]))
      done = setTimeout(
        () => {
          setFlights((f) => f.filter((l) => !lines.includes(l)))
          setHops((h) => new Set([...h].filter((n) => !to.has(n))))
        },
        calm ? 1000 : 1500
      )
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(done)
    }
  }, [all, replay, face])

  // ---------- the flag popover: what an agent (or someone asking in) needs from you ----------
  const [flagOpen, setFlagOpen] = useState<string | null>(null)

  // ---------- the dialogue dock ----------
  const dialogue = useMemo(() => dialogueOf(msgs, st, p.coordinator, p.isMain, 8), [msgs, st, p.coordinator, p.isMain])
  const [dock, setDock] = useState<number | null>(() => loadDock(p.roomId))

  const empty = agents.length === 0 && ghosts.length === 0

  // Every seat around the coordinator, in order: its agents, "+N" for the rest, then whoever asks in.
  const seats: ReactNode[] = [
    ...faces.map(({ name, task: t, line, mood }) => {
      const f = flags.get(name)
      const flagCount = (f?.escalations.length ?? 0) + (f?.reviews.length ?? 0)
      return (
        <AgentFace
          key={name}
          name={name}
          label={p.nameOf(name)}
          size={face}
          mood={mood}
          look={faceOf(name, colorOf(st, name))}
          task={t}
          line={line}
          now={now}
          hop={hops.has(name)}
          calm={reducedMotion()}
          flags={flagCount}
          flagOpen={flagOpen === name}
          onFlag={() => setFlagOpen((o) => (o === name ? null : name))}
          onCloseFlag={() => setFlagOpen(null)}
          flagBody={flagCount ? p.needsFor(name) : null}
          onOpen={() => p.onOpenAgent(name)}
          faceRef={(el) => (el ? faceEls.current.set(name, el) : faceEls.current.delete(name))}
        />
      )
    }),
    ...(more > 0
      ? [
          <li key="more" className="flex flex-col items-center justify-start" style={{ width: face + 40 }}>
            <span className="flex items-center justify-center rounded-full bg-field text-title font-semibold text-ink-2" style={{ width: face * 0.8, height: face * 0.8, marginTop: face * 0.1 }}>
              +{more}
            </span>
          </li>,
        ]
      : []),
    ...ghosts.map((r) => <GhostFace key={r.id} r={r} size={face} open={flagOpen === `r${r.id}`} onToggle={() => setFlagOpen((o) => (o === `r${r.id}` ? null : `r${r.id}`))} onClose={() => setFlagOpen(null)} body={p.requestFor(r)} />),
  ]

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={stage} role="region" className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto" aria-label={`The room: ${p.nameOf(p.coordinator)} and the team`}>
        {p.banner && replay === null && <div className="relative z-30 mx-auto w-full max-w-[792px] px-4">{p.banner}</div>}
        <div className={cx("mx-auto flex w-full max-w-[1100px] flex-col items-center px-4 pb-6", phone ? "pt-3" : p.banner ? "pt-3" : "pt-[max(20px,4vh)]")}>
          <div className={cx("flex w-full justify-center", flank ? "items-start gap-x-8" : "flex-col items-center")}>
            {/* Beside it, the faces sit on its eye line. */}
            {flank && <Seats seats={seats.slice(0, Math.ceil(Math.min(seats.length, FLANK) / 2))} top={(coord - face) / 2} />}
            {/* The coordinator: the one voice, big at the centre. */}
            <div ref={blockEl} className="flex shrink-0 flex-col items-center">
              <div ref={coordEl} className="flex justify-center" style={{ height: coord }}>
                <CoordinatorHead size={coord} mood={coordMood} live interactive={replay === null} seed={0.7} label={`${p.nameOf(p.coordinator)}, ${coordMood?.state ?? "idle"}`} />
              </div>
              <p className="mt-4 text-title font-semibold tracking-[-0.01em]">{p.nameOf(p.coordinator)}</p>
              {coordMood?.state === "sleeping" && replay === null && <p className="mt-0.5 text-meta text-ink-3">{coordMood.paused ? "Paused with every agent, until you resume them" : "Away right now: it reads what you say when it's back"}</p>}
              {p.team.length > 0 && replay === null && <TeamLine team={p.team} />}
            </div>
            {flank && <Seats seats={seats.slice(Math.ceil(Math.min(seats.length, FLANK) / 2), FLANK)} top={(coord - face) / 2} />}
          </div>

          {/* The team: a face for every agent behind it (beside it when there's room, then under it). */}
          {empty ? (
            <Alone name={p.nameOf(p.coordinator)} code={p.code} isOwner={p.isOwner} />
          ) : (
            (!flank || seats.length > FLANK) && (
              <div className={cx("mt-6 w-full", phone ? "-mx-4 overflow-x-auto px-4" : "")}>
                <Seats seats={flank ? seats.slice(FLANK) : seats} row phone={phone} />
              </div>
            )
          )}
        </div>

        {/* The lines of delegation, drawn over the stage. */}
        {flights.length > 0 && (
          <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {flights.map((f) => (
              <path key={f.id} d={f.d} pathLength={1} className="room-flight" fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" />
            ))}
          </svg>
        )}
      </div>

      <Timeline messages={p.messages} state={p.state} now={p.now} nameOf={p.nameOf} replay={replay} onReplay={setReplay} />

      <Dock
        roomId={p.roomId}
        height={dock}
        onHeight={(h) => (setDock(h), saveDock(p.roomId, h))}
        dialogue={dialogue}
        me={p.me}
        coordinator={p.coordinator}
        nameOf={p.nameOf}
        coordMood={coordMood}
        waiting={replay === null && p.waiting}
        replaying={replay !== null}
        starters={p.starters}
        onStarter={p.onStarter}
        onShowConversation={p.onShowConversation}
        newCount={p.newCount}
      />
    </div>
  )
}

/** A run of seats: beside the coordinator (two to a side), or a row under it. */
function Seats({ seats, row, phone, top }: { seats: ReactNode[]; row?: boolean; phone?: boolean; top?: number }) {
  if (!seats.length) return null
  return (
    <ul aria-label="The team" className={cx("flex gap-x-4 gap-y-4", row ? (phone ? "w-max" : "flex-wrap justify-center") : "shrink-0")} style={top ? { marginTop: top } : undefined}>
      {seats}
    </ul>
  )
}

function TeamLine({ team }: { team: TeamPart[] }) {
  return (
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
  )
}

/** The coordinator with nobody behind it yet: how to bring an agent in. */
function Alone({ name, code, isOwner }: { name: string; code: string; isOwner: boolean }) {
  return (
    <div className="mt-6 w-full max-w-[520px] text-center">
      <p className="text-body text-ink-2">{name} works alone for now. Add an agent and it joins the room.</p>
      {isOwner && (
        <div className="text-left">
          <Command text={joinCommand(location.origin, code)} label="Copy the command to add an agent" />
        </div>
      )}
    </div>
  )
}

// ---------- one agent's face ----------

function AgentFace({
  name,
  label,
  size,
  mood,
  look,
  task,
  line,
  now,
  hop,
  calm,
  flags,
  flagOpen,
  onFlag,
  onCloseFlag,
  flagBody,
  onOpen,
  faceRef,
}: {
  name: string
  label: string
  size: number
  mood: Mood
  look: { shape: FaceShape; shell: string }
  task: Task | undefined
  line: Message | undefined
  now: number
  hop: boolean
  calm: boolean
  flags: number
  flagOpen: boolean
  onFlag: () => void
  onCloseFlag: () => void
  flagBody: ReactNode
  onOpen: () => void
  faceRef: (el: HTMLElement | null) => void
}) {
  const [flagEl, setFlagEl] = useState<HTMLButtonElement | null>(null)
  // Only faces doing something move; an idle or sleeping one rests on its still pose.
  const live = hop || (mood.state !== "idle" && mood.state !== "sleeping")
  const what = mood.state === "sleeping" ? (mood.paused ? "paused" : "away") : mood.state
  return (
    <li className="relative flex flex-col items-center" style={{ width: size + 40 }}>
      <button
        type="button"
        ref={faceRef}
        onClick={onOpen}
        aria-label={`${label}, ${what}${task ? `, on ${taskId(task.id)} ${task.title}` : ""}. Open its conversation`}
        className={cx("group/f relative flex w-full flex-col items-center rounded-card px-2 pt-1 pb-2 transition-colors hover:bg-wash", hop && calm && "bg-accent-wash")}
      >
        <span className={cx("transition-opacity duration-500", mood.state === "sleeping" && "opacity-55")}>
          <CoordinatorHead size={size} mood={mood} live={live} hop={hop && !calm} shape={look.shape} shell={look.shell} seed={seedOf(name)} label={`${label}, ${what}`} />
        </span>
        <span className="mt-2 max-w-full truncate text-ui font-semibold">{label}</span>
        {task ? (
          <span className="mt-1 flex max-w-full items-center gap-1 rounded-full bg-field py-0.5 pr-2 pl-1 text-stamp text-ink-2">
            <StateMark state={task.state} />
            <span className="truncate">
              {taskId(task.id)} · {task.title}
            </span>
          </span>
        ) : (
          <span className="mt-1 text-stamp text-ink-3">{mood.state === "sleeping" ? (mood.paused ? "Paused" : "Away") : mood.state === "thinking" ? "Waiting on an answer" : mood.state === "error" ? "Something was refused" : "Free"}</span>
        )}
        {line && (
          <span className="relative mt-1 block w-full">
            <span key={line.seq} className="room-caption block truncate text-stamp text-ink-3" title="">
              {excerpt(line.body, 90)}
            </span>
            {/* Hovering, the latest line in full, up to three lines. */}
            <span className="pointer-events-none absolute top-full left-1/2 z-10 mt-1 hidden w-56 -translate-x-1/2 rounded-ctl bg-raised px-2.5 py-1.5 text-left text-meta leading-snug text-ink-2 shadow-pop group-hover/f:block">
              <span className="line-clamp-3">{line.body}</span>
              <span className="mt-0.5 block text-stamp text-ink-3">{formatAgo(line.rts ?? line.ts, now)}</span>
            </span>
          </span>
        )}
      </button>
      {flags > 0 && (
        <button
          ref={setFlagEl}
          type="button"
          onClick={onFlag}
          aria-expanded={flagOpen}
          aria-label={`${label} needs you: ${flags} ${flags === 1 ? "thing" : "things"}`}
          className="absolute top-0 right-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-decide px-1.5 text-stamp font-semibold text-white shadow-[0_0_0_2px_var(--canvas)] transition-transform hover:scale-105"
        >
          {flags}
        </button>
      )}
      {flagOpen && flagBody && (
        <Popover onClose={onCloseFlag} anchor={flagEl}>
          {flagBody}
        </Popover>
      )}
    </li>
  )
}

/** Someone asking to join: a face that isn't there yet, with the code to compare in its popover. */
function GhostFace({ r, size, open, onToggle, onClose, body }: { r: JoinRequest; size: number; open: boolean; onToggle: () => void; onClose: () => void; body: ReactNode }) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null)
  return (
    <li className="relative flex flex-col items-center" style={{ width: size + 40 }}>
      <button ref={setEl} type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-col items-center rounded-card px-2 pt-1 pb-2 transition-colors hover:bg-wash">
        <span className="flex items-center justify-center rounded-full border-2 border-dashed border-edge-strong text-display text-ink-3" style={{ width: size * 0.8, height: size * 0.8, margin: size * 0.1 }}>
          ?
        </span>
        <span className="mt-2 max-w-full truncate text-ui font-semibold text-ink-2">{r.name}</span>
        <span className="mt-1 rounded-full bg-decide-wash px-2 py-0.5 text-stamp font-medium text-decide">wants to join</span>
      </button>
      {open && (
        <Popover onClose={onClose} anchor={el}>
          {body}
        </Popover>
      )}
    </li>
  )
}

/**
 * What a face's flag (or someone asking in) opens: anchored under the face, or over it when there's no
 * room below, kept inside the window. Drawn on the page, not in the stage, so the stage never clips it.
 */
function Popover({ children, onClose, anchor }: { children: ReactNode; onClose: () => void; anchor: HTMLElement | null }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const w = Math.min(340, innerWidth - 32)
      const left = Math.min(innerWidth - 16 - w, Math.max(16, r.left + r.width / 2 - w / 2))
      const h = box.current?.offsetHeight ?? 220
      setAt(innerHeight - r.bottom - 8 >= h || r.top < h ? { left, top: r.bottom + 4 } : { left, bottom: innerHeight - r.top + 4 })
    }
    place()
    addEventListener("resize", place)
    addEventListener("scroll", place, true)
    return () => {
      removeEventListener("resize", place)
      removeEventListener("scroll", place, true)
    }
  }, [anchor])
  useEffect(() => {
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", esc)
    }
  }, [onClose, anchor])
  return createPortal(
    <div ref={box} className="animate-rise fixed z-50 max-h-[70vh] w-[340px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-card bg-raised text-left shadow-pop" style={at ? { left: at.left, top: at.top, bottom: at.bottom } : { visibility: "hidden" }}>
      {children}
    </div>,
    document.body
  )
}

// ---------- the timeline ----------

const WINDOWS = [
  { key: "15m", ms: 15 * 60_000 },
  { key: "1h", ms: 3_600_000 },
  { key: "6h", ms: 6 * 3_600_000 },
  { key: "1d", ms: 24 * 3_600_000 },
] as const

function Timeline({ messages, state, now, nameOf, replay, onReplay }: { messages: Message[]; state: ChannelState; now: number; nameOf: (n: string) => string; replay: number | null; onReplay: (seq: number | null) => void }) {
  // It opens on the shortest window that holds the team's last dozen moves, an hour at most.
  const [win, setWin] = useState<(typeof WINDOWS)[number]["key"]>(() => {
    const recent = teamEvents(messages, state, 0, now).slice(-12)
    const oldest = recent[0] ? (recent[0].rts ?? recent[0].ts) : now
    return now - oldest <= WINDOWS[0].ms ? "15m" : "1h"
  })
  const span = WINDOWS.find((w) => w.key === win)!.ms
  const from = now - span
  const events = useMemo(() => teamEvents(messages, state, from, now), [messages, state, from, now])
  const bar = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Message | null>(null)
  const xOf = (m: Message) => ((m.rts ?? m.ts) - from) / span
  // The message nearest a point on the bar, among everything said in the window (not just the ticks).
  const inWindow = useMemo(() => messages.filter((m) => (m.rts ?? m.ts) >= from), [messages, from])
  const seqAt = useCallback(
    (clientX: number) => {
      const r = bar.current?.getBoundingClientRect()
      if (!r || !inWindow.length) return null
      const t = from + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span
      let best: Message | undefined
      for (const m of inWindow) if ((m.rts ?? m.ts) <= t) best = m
      return (best ?? inWindow[0]!).seq
    },
    [inWindow, from, span]
  )
  // Scrubbing: one fold per animation frame at most.
  const frame = useRef(0)
  const scrub = (clientX: number) => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const s = seqAt(clientX)
      if (s !== null) onReplay(s)
    })
  }
  const dragging = useRef(false)
  const at = replay === null ? null : messages.find((m) => m.seq === replay)
  const head = at ? xOf(at) : 1
  const latest = messages.at(-1)?.seq ?? 0
  return (
    <div className="mx-auto flex w-full max-w-[792px] shrink-0 items-center gap-3 px-4 py-1.5" aria-label="Timeline">
      {replay !== null ? (
        <button type="button" onClick={() => onReplay(null)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-decide-wash py-1 pr-3 pl-2 text-meta font-medium text-decide transition-colors hover:bg-decide-wash/80" title="Back to live (Esc)">
          <Icon icon={RotateClockwiseIcon} size={13} />
          Replaying {at ? formatTime(at.rts ?? at.ts) : ""} · Back to live
        </button>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-stamp font-medium text-ink-3">
          <span className="size-1.5 rounded-full bg-live" aria-hidden />
          Live
        </span>
      )}
      <div
        ref={bar}
        role="slider"
        tabIndex={0}
        aria-label="Scrub back through what the team did"
        aria-valuemin={0}
        aria-valuemax={latest}
        aria-valuenow={replay ?? latest}
        aria-valuetext={at ? `Replaying ${formatTime(at.rts ?? at.ts)}` : "Live"}
        className="group/t relative h-7 min-w-0 flex-1 cursor-pointer touch-none"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          scrub(e.clientX)
        }}
        onPointerMove={(e) => {
          if (dragging.current) scrub(e.clientX)
        }}
        onPointerUp={() => (dragging.current = false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onReplay(null)
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
          e.preventDefault()
          const list = events.length ? events : inWindow
          const cur = replay ?? latest
          const next = e.key === "ArrowLeft" ? [...list].reverse().find((m) => m.seq < cur) : list.find((m) => m.seq > cur)
          onReplay(next ? next.seq : e.key === "ArrowRight" ? null : (list[0]?.seq ?? null))
        }}
      >
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" aria-hidden />
        {events.map((m) => (
          <span
            key={m.seq}
            onPointerEnter={() => setHover(m)}
            onPointerLeave={() => setHover((h) => (h?.seq === m.seq ? null : h))}
            className={cx("absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors", m.esc ? "bg-decide" : m.ev?.op?.startsWith("task.") ? "bg-ink-3 group-hover/t:bg-ink-2" : "bg-ink-3/50")}
            style={{ left: `${xOf(m) * 100}%` }}
          />
        ))}
        {/* The playhead: where the stage stands. */}
        <span className={cx("absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full", replay === null ? "bg-live" : "bg-decide")} style={{ left: `${Math.min(1, Math.max(0, head)) * 100}%` }} aria-hidden />
        {hover && (
          <span className="pointer-events-none absolute bottom-full z-20 mb-1 max-w-[280px] -translate-x-1/2 truncate rounded-ctl bg-raised px-2.5 py-1 text-meta text-ink-2 shadow-pop" style={{ left: `${Math.min(0.9, Math.max(0.1, xOf(hover))) * 100}%` }}>
            <span className="text-ink-3">{formatTime(hover.rts ?? hover.ts)}</span> {nameOf(hover.from)} {hover.esc ? "asked you to decide" : excerpt(hover.body, 70)}
          </span>
        )}
      </div>
      <span className="flex shrink-0 items-center rounded-full bg-field p-0.5" role="group" aria-label="How far back">
        {WINDOWS.map((w) => (
          <button key={w.key} type="button" aria-pressed={win === w.key} onClick={() => setWin(w.key)} className={cx("rounded-full px-2 py-0.5 text-stamp font-medium transition-colors", win === w.key ? "bg-raised text-ink shadow-[0_0_0_1px_var(--line)]" : "text-ink-3 hover:text-ink")}>
            {w.key}
          </button>
        ))}
      </span>
    </div>
  )
}

// ---------- the docked dialogue ----------

function Dock({
  height,
  onHeight,
  dialogue,
  me,
  coordinator,
  nameOf,
  coordMood,
  waiting,
  replaying,
  starters,
  onStarter,
  onShowConversation,
  newCount,
}: {
  roomId: string
  height: number | null
  onHeight: (px: number) => void
  dialogue: Message[]
  me: string
  coordinator: string
  nameOf: (n: string) => string
  coordMood: Mood | undefined
  waiting: boolean
  replaying: boolean
  starters: string[]
  onStarter: (text: string) => void
  onShowConversation: () => void
  newCount: number
}) {
  const panel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // The newest of the coordinator's lines types in as it speaks; the rest are already there.
  const newestTheirs = [...dialogue].reverse().find((m) => m.from === coordinator)
  const { text, revealing } = useReveal(replaying ? undefined : newestTheirs)
  // Stick to the newest exchange.
  useLayoutEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [dialogue.length, text])

  // Dragging the handle resizes the dock; it keeps between a fifth and two thirds of the pane.
  const drag = useRef<{ y: number; h: number } | null>(null)
  const clamp = (h: number) => {
    const total = panel.current?.parentElement?.clientHeight ?? 800
    return Math.round(Math.min(total * 0.66, Math.max(Math.min(160, total * 0.2), h)))
  }
  return (
    <div ref={panel} className="relative flex shrink-0 flex-col bg-canvas" style={{ height: height ?? "clamp(200px, 32%, 340px)" }}>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the dialogue"
        tabIndex={0}
        className="group/h flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, h: panel.current?.clientHeight ?? 240 }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (drag.current) onHeight(clamp(drag.current.h + (drag.current.y - e.clientY)))
        }}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
          e.preventDefault()
          onHeight(clamp((panel.current?.clientHeight ?? 240) + (e.key === "ArrowUp" ? 24 : -24)))
        }}
      >
        <span className="h-1 w-9 rounded-full bg-wash-2 transition-colors group-hover/h:bg-ink-3/50" />
      </div>
      <div className="mx-auto flex w-full max-w-[792px] shrink-0 items-center justify-between px-4 pb-1">
        <span className="text-stamp font-medium text-ink-3">{replaying ? "What you and " + nameOf(coordinator) + " had said by then" : `You and ${nameOf(coordinator)}`}</span>
        <button type="button" onClick={onShowConversation} title="Show conversation (Esc in the message field)" className="flex items-center gap-1 rounded-full px-2 py-0.5 text-stamp text-ink-3 transition-colors hover:bg-wash hover:text-ink">
          <Icon icon={ArrowDown01Icon} size={11} className="rotate-180" />
          Show conversation
          {newCount > 0 && <span className="text-ink-2">· {newCount} new</span>}
        </button>
      </div>
      {/* For a screen reader, the coordinator's newest words once, whole. */}
      <p aria-live="polite" className="sr-only">
        {newestTheirs && !replaying ? `${nameOf(coordinator)}: ${newestTheirs.body}` : ""}
      </p>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[792px] flex-col gap-1.5 px-4 pb-3">
          {dialogue.length === 0 ? (
            <div className="flex flex-col items-center py-4 text-center">
              <p className="text-title font-semibold">Tell {nameOf(coordinator)} what you want done.</p>
              <p className="mt-1 max-w-sm text-ui leading-normal text-ink-2">It plans the work, hands it to the agents here, and comes back to you when something needs a decision.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {starters.map((s) => (
                  <button key={s} type="button" onClick={() => onStarter(s)} className="rounded-full bg-field px-3 py-1 text-ui text-ink-2 transition-colors hover:bg-wash-2 hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            dialogue.map((m, i) => {
              const mine = m.from === me
              const theirs = m.from === coordinator
              const prev = dialogue[i - 1]
              const typing = theirs && m.seq === newestTheirs?.seq && revealing
              return (
                <div key={m.seq} className={cx("flex items-end gap-2", mine ? "justify-end pl-12" : "pr-12", prev && prev.from !== m.from && "mt-2")}>
                  {!mine && <span className="w-6 shrink-0">{(!dialogue[i + 1] || dialogue[i + 1]!.from !== m.from) && (theirs ? <CoordinatorAvatar size={24} mood={m.seq === newestTheirs?.seq ? (revealing && coordMood?.state !== "sleeping" ? { state: "speaking" } : coordMood) : undefined} live={m.seq === newestTheirs?.seq} seed={0.3} /> : null)}</span>}
                  <div className={cx("min-w-0 max-w-[min(85%,620px)] rounded-bubble px-3 py-1.5 text-body", mine ? "bg-bubble-me text-bubble-me-ink" : "bg-bubble-them text-ink")}>
                    {!mine && !theirs && <p className="text-stamp font-medium text-ink-3">{nameOf(m.from)}</p>}
                    <div aria-hidden={typing || undefined} className="bubble-text [&_pre]:text-ui">
                      {typing ? <p className="whitespace-pre-wrap">{text}</p> : <Markdown>{m.body}</Markdown>}
                    </div>
                  </div>
                </div>
              )
            })
          )}
          {waiting && (
            <p className="mt-1 flex items-center gap-2 pl-8 text-meta text-ink-3">
              <span className="room-dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
              {nameOf(coordinator)} is on it…
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** The drawer an agent's face opens: its conversation (its task's, or its direct one with the coordinator), live. */
export function AgentDrawer({ title, subtitle, face, onClose, children, composer }: { title: string; subtitle: string; face: ReactNode; onClose: () => void; children: ReactNode; composer: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose()
    addEventListener("keydown", esc)
    return () => removeEventListener("keydown", esc)
  }, [onClose])
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  })
  return (
    <div className="absolute inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="room-scrim absolute inset-0 bg-overlay" />
      <aside role="dialog" aria-label={title} className="room-drawer relative flex h-full w-full max-w-[520px] flex-col bg-canvas shadow-pop">
        <header className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          {face}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-title font-semibold">{title}</span>
            <span className="block truncate text-meta text-ink-3">{subtitle}</span>
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-wash hover:text-ink">
            <Icon icon={Cancel01Icon} size={16} />
          </button>
        </header>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {children}
        </div>
        {composer}
      </aside>
    </div>
  )
}
