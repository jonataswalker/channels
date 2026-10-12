import { ArrowDown01Icon, ArrowLeft01Icon, PauseCircleIcon, PlayCircleIcon, Search01Icon, SidebarRightIcon } from "@hugeicons/core-free-icons"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { droppedCount } from "@mc/format.ts"
import { memberLoad } from "@mc/load.ts"
import { ignored, type Color, type Message } from "@mc/protocol.ts"
import { describeScopes, wireScopes } from "@mc/scopes.ts"
import type { Member as RosterMember } from "@mc/membership.ts"
import type { HumanSession } from "@mc/client.ts"
import { seatedComputers } from "@/lib/computers"
import { colorOf, keptFromPeople, taskId, type ChannelState, type Task } from "@mc/state.ts"
import { useAuth } from "@/lib/auth"
import { channelTitle, forgetChannel, LEFT_CHANNEL, loadMember, loadRecent, saveMember, saveRecent, useChannel, useClock, useKnownChannels, type StoredMember } from "@/lib/channel"
import { markSeen, setOpenNews } from "@/lib/news"
import { useIcons, useLiveIcon } from "@/lib/icons"
import { excerpt, memberName } from "@/lib/format"
import { usePlaceSlot } from "@/lib/place-slot"
import { coordinatorMood, ERROR_MS, moodInputs, SPEAKING_MS, type Mood } from "@/lib/coordinator-mood"
import { dmPlace, markSeenIn, MAIN, placeFromKey, placeKey, seenIn, sendFrom, useSeen, threadMembers, type Place, type PlaceSummary } from "@/lib/threads"
import { drawerPlaceFor } from "@/lib/room"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { CoordinatorAvatar } from "./coordinator-head"
import { Composer } from "./composer"
import { AddAgent } from "./add-agent"
import { ChannelControls, HoldBanner, HoldDialog } from "./controls"
import { Icon } from "./icon"
import { InfoPanel } from "./info-panel"
import { Button, IconButton, Monogram, Spinner, TextField, errorText, toast } from "./kit"
import { Bubble, EventGroup, EventRow, TimeMark, isAgent, standsAlone, type ThreadSummary } from "./message"
import { NeedsYou, type JoinedVia } from "./needs-you"
import { FocusButton, loadMainView, saveMainView, type MainView, type TeamPart } from "./hero"
import { AgentDrawer, faceOf, Room } from "./room"
import { TaskPage } from "./task-page"
import { Notes, StateMark, TaskCard, Tasks } from "./tasks"
import { ThreadPanel } from "./thread"

/** A task's state in a word, beside its row in the list. */
/** Where a task stands, in words: the sidebar's dot says it at a glance; these say it on hover and to screen readers. */
const STATE_WORD = { todo: "Open", doing: "In progress", review: "In review", done: "Done" } as const

/** Messages this close together from one sender read as one run. */
const RUN_GAP = 5 * 60_000

function useNow(intervalMs = 30_000): number {
  return useClock(intervalMs)
}

/**
 * What's new in the open channel, for the channel list and the tab: what arrived while the tab was
 * in the background, or in a room not in view. While it's in view the channel is read up to `top`.
 */
function useChannelNews(room: string, top: number, arrivals: number, inOtherRooms: number, needs: number) {
  const [mark, setMark] = useState(arrivals)
  const [hidden, setHidden] = useState(() => document.hidden)
  useEffect(() => {
    const onChange = () => {
      if (document.hidden) setMark(arrivals)
      setHidden(document.hidden)
    }
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [arrivals])
  const unread = hidden ? arrivals - mark : inOtherRooms
  useEffect(() => {
    if (!hidden && top > 0) markSeen(room, top, needs)
  }, [room, top, needs, hidden])
  useEffect(() => setOpenNews({ room, unread, needs }), [room, unread, needs])
  // Leaving: the list takes over (and may refresh what it knows of the others).
  useEffect(
    () => () => {
      setOpenNews(null)
      window.dispatchEvent(new Event(LEFT_CHANNEL))
    },
    [room]
  )
}

/**
 * Owner: keep this channel's computer seats in order whenever it opens. Seats with under 60 days left
 * are renewed; agents a computer let in get the owner's own signature on their record (keeping which
 * computer it was), so every client, older ones too, reads them as the owner's; and computers already
 * seated in this person's other channels get a seat here too (a new channel included).
 */
function useTendSeats({ ch, isOwner, roster, human, refreshRoster, onJoined }: {
  ch: ReturnType<typeof useChannel>["ch"]
  isOwner: boolean
  roster: RosterMember[]
  human: HumanSession | null
  refreshRoster: () => Promise<void>
  /** "2 agents joined via mac-mini": one line per computer, for Needs you. */
  onJoined: (via: JoinedVia) => void
}) {
  const seated = useRef(false)
  const busy = useRef(false)
  // Agents a computer let in, not yet re-signed: whenever one shows up, tend again.
  const fresh = roster.filter((m) => m.active && m.signedBy).map((m) => m.pk).join(",")
  useEffect(() => {
    if (!isOwner || !human || busy.current) return
    const first = !seated.current
    if (!first && !fresh) return
    busy.current = true
    void (async () => {
      try {
        const others = first ? await seatedComputers(human) : []
        const done = await ch.tendSeats(others)
        seated.current = true
        // "2 agents joined via mac-mini", once per computer, rather than a line per agent.
        const via = new Map<string, number>()
        for (const m of roster) if (m.signedBy && done.resigned.includes(m.name)) via.set(m.viaName ?? "your computer", (via.get(m.viaName ?? "your computer") ?? 0) + 1)
        if (via.size) onJoined(via)
        if (done.seated.length || done.resigned.length) await refreshRoster()
      } catch {
        // Tried again the next time the channel opens; nothing here is urgent.
      } finally {
        busy.current = false
      }
    })()
  }, [ch, isOwner, human, fresh, roster, refreshRoster, onJoined])
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
/** A stamp goes between messages this far apart, as Messages does. */
const STAMP_GAP = 15 * 60_000

/** The places a task's own events go, summed up in main as one line each: made, and a change of state. */
/** Up close with a coordinator nobody has spoken to yet: a few ways to begin, a tap from the field. */
const STARTERS = ["What's everyone working on?", "Plan the next release with the team", "Review the open pull requests"]

/** The Room's drawer: one place's conversation, plain (a task's card, then what was said; no threads, no stamps). */
function DrawerRows({
  messages,
  placeOf,
  at,
  state,
  task,
  now,
  bubble,
  empty,
  onOpenTask,
}: {
  messages: Message[]
  placeOf: Map<number, Place>
  at: string
  state: ChannelState
  task: Task | undefined
  now: number
  bubble: (m: Message, first: boolean, last: boolean, prev: Message | undefined, anchor?: string) => ReactNode
  empty: string
  onOpenTask: (id: number) => void
}) {
  const list = messages.filter((m) => placeKey(placeOf.get(m.seq) ?? MAIN) === at && m.ev?.op !== "hello" && m.ev?.op !== "card" && !ignored(state.trust.get(m.seq)))
  if (!list.length && !task) return <p className="px-4 py-10 text-center text-ui text-ink-3">{empty}</p>
  return (
    <>
      {task && <TaskCard task={task} state={state} now={now} onOpen={() => onOpenTask(task.id)} highlighted={false} />}
      {list.map((m, i) => {
        if (m.kind === "event") return task && m.seq === task.id ? null : <EventRow key={m.seq} m={m} state={state} now={now} onOpenTask={onOpenTask} openLabel="Details" />
        const prev = list[i - 1]
        const next = list[i + 1]
        const first = !prev || prev.kind === "event" || prev.from !== m.from || m.ts - prev.ts > RUN_GAP
        const last = !next || next.kind === "event" || next.from !== m.from || next.ts - m.ts > RUN_GAP
        return bubble(m, first, last, prev, "d")
      })}
    </>
  )
}

const summarised = (m: Message) => m.ev?.op === "task.add" || (m.ev?.op === "task.update" && !!m.ev.state)

export function Conversation({ member, onBack, onGone }: { member: StoredMember; onBack: () => void; onGone: () => void }) {
  const me = member.identity.name
  const auth = useAuth()
  const { ch, connection, gone, messages, roster, state, online, isOwner, requests, send, refreshRequests, refreshRoster, head, foldAt } = useChannel(
    member,
    auth.status === "loading" ? null : auth.token,
  )
  const [joinedVia, setJoinedVia] = useState<JoinedVia>(() => new Map())
  const onJoined = useCallback(
    (via: JoinedVia) =>
      setJoinedVia((was) => {
        const next = new Map(was)
        for (const [name, n] of via) next.set(name, (next.get(name) ?? 0) + n)
        return next
      }),
    []
  )
  useTendSeats({ ch, isOwner, roster, human: auth.status === "loading" ? null : auth.token, refreshRoster, onJoined })
  useLiveIcon(member)
  const roomId = member.access.roomId
  const icon = useIcons().get(roomId) ?? null
  const now = useNow()
  // Where you are in the channel: its main conversation, a task's, or a direct one. Or the task list.
  const [here, setHere] = useState<string>("main")
  const [board, setBoard] = useState(false)
  const [info, setInfo] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [search, setSearch] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  /** The thread open on the right, by its first message. */
  const [threadRoot, setThreadRoot] = useState<number | null>(null)
  const [openTask, setOpenTask] = useState<number | null>(null)
  /**
   * The Room: the agent whose conversation is open in the drawer (and the place it opened on, kept so
   * the drawer doesn't follow the agent to its next task mid-sentence), the point the timeline replays
   * (null: live), and the face whose flag popover is open.
   */
  const [drawerAt, setDrawerAt] = useState<{ agent: string; place: Place } | null>(null)
  const [replay, setReplay] = useState<number | null>(null)
  const [flagOpen, setFlagOpen] = useState<string | null>(null)
  const [wasFocus, setWasFocus] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)
  /** New messages below while scrolled up. */
  const [behind, setBehind] = useState(0)

  const nameOf = useCallback((name: string) => memberName(state.members.get(name), name), [state.members])
  // Members by key: names are what people type, keys are who they are.
  const byKey = useMemo(() => new Map(roster.map((r) => [r.pk, r])), [roster])
  const memberCount = roster.filter((r) => r.active).length || state.members.size
  const active = useMemo(() => [...state.members.values()].filter((m) => m.active), [state.members])
  const others = useMemo(() => active.filter((m) => m.name !== me), [active, me])
  const people = useMemo(() => active.map((m) => ({ name: m.name, label: memberName(m), agent: isAgent(m), color: colorOf(state, m.name) })), [active, state])
  // The channel's name can arrive after this view opens (members decrypt it), so follow the list.
  const known = useKnownChannels()
  const title = channelTitle(
    // The list has the latest name (a rename lands there); the member record this view opened with may be older.
    { name: known.find((c) => c.code === member.code)?.name ?? member.name },
    others.length ? { from: "", text: "", ts: 0, people: others.map((m) => memberName(m)) } : loadRecent(member.code)
  )
  // Strict coordinator-only: nothing another agent sends counts as reaching a person.
  const iAmPerson = !isAgent(state.members.get(me))
  const reaches = useCallback((m: Message) => !(iAmPerson && keptFromPeople(state, m)), [iAmPerson, state])
  const openAsks = useMemo(() => state.openAsks.filter(reaches), [state.openAsks, reaches])

  // Coordinator-only: a person's main conversation is with the coordinator.
  const meM = state.members.get(me)
  const coordinator = state.mode.coordinatorOnly && meM && !isAgent(meM) && state.coordinator !== me ? state.coordinator : null
  const arrivals = useMemo(() => messages.filter((m) => m.from !== me && reaches(m)).length, [messages, me, reaches])
  // Needs you: a question to you (or to everyone) that nobody else has answered yet.
  const needs = useMemo(() => openAsks.filter((m) => m.from !== me && (m.to?.includes(me) || m.to?.includes("*"))).length, [openAsks, me])
  useChannelNews(roomId, Math.max(head, messages.at(-1)?.seq ?? 0), arrivals, 0, needs)

  // Needs you: escalations to this person nobody answered, and work waiting on their review.
  const escalations = useMemo(() => openAsks.filter((m) => m.esc && m.from !== me && m.to?.includes(me)), [openAsks, me])
  const reviews = useMemo(
    () =>
      iAmPerson
        ? [...state.tasks.values()].filter((t) => t.state === "review" && !!t.review && (t.review === me || (t.review === "*" && t.owner !== me && !t.workedBy.includes(me))))
        : [],
    [state.tasks, me, iAmPerson]
  )
  // Nobody to talk to yet: the conversation opens on how to add an agent.
  const noAgents = !active.some((m) => isAgent(m))
  // A brand-new channel: nothing said and nobody to say it. The stop button waits for agents.
  const quiet = noAgents && !messages.some((m) => m.kind !== "event")

  // Remember the latest message and who's here, for the channel list.
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.kind !== "event" && !ignored(state.trust.get(m.seq)))
    const prior = loadRecent(member.code)
    if (!last && !others.length) return
    saveRecent(member.code, {
      from: last ? (last.from === me ? "You" : nameOf(last.from)) : (prior?.from ?? ""),
      text: last ? (last.imgs?.length && last.body === last.imgs.map((i) => i.name).join(", ") ? "Image" : excerpt(last.body, 120)) : (prior?.text ?? ""),
      ts: last?.ts ?? prior?.ts ?? member.at,
      people: others.length ? others.map((m) => memberName(m)) : (prior?.people ?? []),
      ...(last && state.coordinator && last.from === state.coordinator ? { byCoordinator: true } : {}),
    })
  }, [messages, others, state.trust, state.coordinator, member.code, member.at, nameOf, me])

  // ---------- the coordinator's face: what it's doing right now ----------
  const coord = state.coordinator
  const said = useMemo(() => (coord ? moodInputs(state, messages, online, coord) : null), [coord, state, messages, online])
  // A fresh message or refusal shows for a few seconds: wake the clock when that window closes.
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    // Read the clock as soon as something new is said, and again when its moment is over.
    const now = Date.now()
    const ends = [said?.saidAt != null ? said.saidAt + SPEAKING_MS : 0, said?.failedAt != null ? said.failedAt + ERROR_MS : 0].filter((t) => t > now)
    const timers = [setTimeout(() => setClock(Date.now()), 0), ...(ends.length ? [setTimeout(() => setClock(Date.now()), Math.min(...ends) - now + 50)] : [])]
    return () => timers.forEach(clearTimeout)
  }, [said])
  const mood: Mood | undefined = coord && said ? coordinatorMood({ ...said, online: online.has(coord), hold: !!state.hold, now: clock }) : undefined

  // ---------- places: main, each task's conversation, direct ones ----------
  const { placeOf, places } = state
  const place: Place = useMemo(() => {
    const p = placeFromKey(here)
    // A direct conversation can be opened before anything's been said in it.
    return p && (places.has(placeKey(p)) || p.kind === "dm") ? p : MAIN
  }, [here, places])
  const hereKey = placeKey(place)
  const go = useCallback((p: Place) => {
    setHere(placeKey(p))
    setBehind(0)
    setBoard(false)
    setOpenTask(null)
    setThreadRoot(null)
    setReplyTo(null)
    setSearch(null)
  }, [])

  // ---------- coordinator mode, up close: Main opens on the coordinator's face and its last words ----------
  const [mainView, setMainViewState] = useState<MainView>(() => loadMainView(roomId))
  const setMainView = useCallback(
    (v: MainView) => {
      setMainViewState(v)
      saveMainView(roomId, v)
      // The control that switched is gone with the view it was in: the field is where you go on from.
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']")?.focus())
    },
    [roomId]
  )
  // Up close: Main in coordinator mode opens on the coordinator's face and its last words (hero.tsx).
  const focus = !!coordinator && hereKey === "main" && mainView === "focus" && search === null && !board && openTask === null
  const isMain = useCallback((m: Message) => placeKey(placeOf.get(m.seq) ?? MAIN) === "main", [placeOf])
  // The agent whose conversation the drawer shows: its task's, or else its direct one with the coordinator (drawerPlaceFor).
  const drawer = drawerAt?.agent ?? null
  const drawerPlace: Place | null = drawerAt?.place ?? null
  const drawerTask = drawerPlace?.kind === "task" ? state.tasks.get(drawerPlace.task) : undefined
  const drawerKey = drawerPlace ? placeKey(drawerPlace) : null
  const setDrawer = useCallback((agent: string | null) => setDrawerAt(agent ? { agent, place: drawerPlaceFor(state, agent, coordinator, me) } : null), [state, coordinator, me])

  // Its last words to you, and yours to it, in Main (replies included: up close there are no threads).
  // Yours only when they reach it: a reply to another agent's escalation or an @dev message isn't to it.
  const dialogue = useMemo(() => {
    if (!coordinator) return { theirs: undefined, mine: undefined, answered: false }
    let theirs: Message | undefined
    let mine: Message | undefined
    for (const m of messages) {
      if (m.kind === "event" || ignored(state.trust.get(m.seq)) || placeKey(placeOf.get(m.seq) ?? MAIN) !== "main") continue
      if (m.from === coordinator && (!m.to?.length || m.to.includes(me) || m.to.includes("*"))) theirs = m
      else if (m.from === me && (!m.to?.length || m.to.includes(coordinator))) mine = m
    }
    // It answered once it says anything anywhere after yours (Main, a direct thread, a task's), or answers yours.
    const answered = !!mine && messages.some((m) => m.from === coordinator && m.kind !== "event" && (m.seq > mine.seq || !!m.re?.includes(mine.seq)) && !ignored(state.trust.get(m.seq)))
    return { theirs, mine, answered }
  }, [coordinator, messages, state.trust, placeOf, me])
  // Thinking about your words, for at most two minutes: then its face goes back to what it's really doing.
  const waiting = !!dialogue.mine && !dialogue.answered && now - (dialogue.mine.rts ?? dialogue.mine.ts) < 120_000
  const [needsSignal, setNeedsSignal] = useState(0)
  const [starter, setStarter] = useState<{ text: string; n: number } | undefined>(undefined)

  // What's new where: the newest message seen in each place, kept by this browser.
  const seen = useSeen(roomId)
  const firstVisit = useRef(Object.keys(seenIn(roomId)).length === 0)
  useEffect(() => {
    // The first time this browser opens the channel, everything already said counts as read.
    if (!firstVisit.current || !messages.length) return
    firstVisit.current = false
    markSeenIn(roomId, Object.fromEntries([...places].map(([k, v]) => [k, v.last])))
  }, [messages.length, places, roomId])
  /**
   * What's new in a place since this browser looked: a count when it's for me (main, a direct
   * conversation I'm in, a task I belong to, or a message that names me), else just that there's news.
   */
  const unreadIn = useCallback(
    (key: string): { n: number; forMe: boolean } => {
      const since = seen[key] ?? 0
      const p = placeFromKey(key) ?? MAIN
      const mine = p.kind === "main" || (p.kind === "dm" ? p.with.includes(me) : threadMembers(state, p).includes(me))
      let n = 0
      let named = 0
      for (const m of messages) {
        if (m.seq <= since || m.kind === "event" || m.from === me || placeKey(placeOf.get(m.seq) ?? MAIN) !== key || ignored(state.trust.get(m.seq))) continue
        if (key === "main" && !reaches(m)) continue
        n++
        if (m.to?.includes(me)) named++
      }
      return mine ? { n, forMe: n > 0 } : { n: named || n, forMe: named > 0 }
    },
    [seen, messages, me, placeOf, reaches, state]
  )
  // Up close, Main is seen only as far as what it shows: its last words and yours, not what else was said there.
  const shownUpClose = Math.max(dialogue.theirs?.seq ?? 0, dialogue.mine?.seq ?? 0)
  const lastHere = focus ? shownUpClose : (places.get(hereKey)?.last ?? 0)
  useEffect(() => {
    if (!document.hidden && !board && lastHere) markSeenIn(roomId, { [hereKey]: lastHere })
  }, [hereKey, lastHere, roomId, board])

  // Replies to a message live in its thread on the right. A message answering a task's own event is just in that task's conversation.
  const bySeqAll = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const rootOf = useCallback(
    (seq: number) => {
      const root = state.threadOf.get(seq)
      if (root === undefined || root === seq) return null
      const r = bySeqAll.get(root)
      return r && r.kind !== "event" ? root : null
    },
    [state.threadOf, bySeqAll]
  )
  // The owner can look at what every view leaves out (forged, or not allowed), tagged; nobody else can.
  const [showDropped, setShowDropped] = useState(false)
  const revealed = isOwner && showDropped
  const threads = useMemo(() => {
    const out = new Map<number, Message[]>()
    for (const m of messages) {
      if (m.kind === "event" || (!revealed && ignored(state.trust.get(m.seq)))) continue
      const root = rootOf(m.seq)
      if (root === null) continue
      const list = out.get(root)
      if (list) list.push(m)
      else out.set(root, [m])
    }
    return out
  }, [messages, rootOf, state.trust, revealed])

  // What this place shows. The React compiler memoizes it (a hand-written useMemo here made it skip the whole component).
  const visible = (() => {
    const q = search?.trim().toLowerCase()
    let list = messages.filter((m) => {
      const at = placeKey(placeOf.get(m.seq) ?? MAIN)
      // Main also tells, in one line each, that a task was made or changed state.
      const inHere = at === hereKey || (hereKey === "main" && at.startsWith("task:") && summarised(m))
      if (!inHere) return false
      // Joins and what an agent says it runs on are in the details; the conversation doesn't repeat them.
      if (m.ev?.op === "hello" || m.ev?.op === "card") return false
      if (!revealed && ignored(state.trust.get(m.seq))) return false
      // Strict coordinator mode keeps other agents out of the people's main conversation; their own
      // conversations (a task's, a direct one) show everything said there.
      if (hereKey === "main" && !reaches(m)) return false
      return true
    })
    // Search shows every match flat, replies included; otherwise replies live in their thread.
    if (q) list = list.filter((m) => m.body.toLowerCase().includes(q) || nameOf(m.from).toLowerCase().includes(q))
    else list = list.filter((m) => m.kind === "event" || rootOf(m.seq) === null)
    return list
  })()

  const bySeq = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const quoted = useCallback((seq: number) => bySeq.get(seq), [bySeq])

  // ---------- motion: what arrives while you look lands with a little life; history doesn't ----------
  const newest = messages.at(-1)?.seq ?? 0
  // Where this conversation stood when it opened: only what comes after counts as arriving.
  const [baseline, setBaseline] = useState<{ key: string; seq: number } | null>(null)
  // Set while rendering (React's way to keep state in step with a prop), not in an effect.
  if (newest && baseline?.key !== hereKey) setBaseline({ key: hereKey, seq: newest })
  const isFresh = (seq: number) => baseline !== null && baseline.key === hereKey && seq > baseline.seq

  // ---------- scrolling: stick to the bottom unless the reader scrolled up ----------
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastCount = useRef(0)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const added = visible.length - lastCount.current
    lastCount.current = visible.length
    // A new message glides into view; the first paint just starts at the bottom.
    if (atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: added > 0 && added < 4 ? "smooth" : "instant" })
    else if (added > 0) setBehind((b) => b + added)
  }, [visible, board])
  // A new place opens at its latest message.
  useLayoutEffect(() => {
    atBottom.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [hereKey])

  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setBehind(0)
  }

  const jump = useCallback(
    (seq: number) => {
      setHighlight(seq)
      setTimeout(() => setHighlight((h) => (h === seq ? null : h)), 1600)
      const inThread = rootOf(seq)
      if (inThread !== null) setThreadRoot(inThread)
      // Somewhere else in the channel: go there first.
      const at = placeOf.get(inThread ?? seq)
      if (at && placeKey(at) !== hereKey) {
        setHere(placeKey(at))
        setBoard(false)
      }
      setSearch(null)
      const find = (left: number) => {
        const el = document.getElementById(`${inThread !== null ? "t" : "m"}${seq}`)
        if (!el) {
          if (left > 0) requestAnimationFrame(() => find(left - 1))
          return
        }
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      // A few frames so a new place, or a collapsed run, can render before we look for the row.
      requestAnimationFrame(() => requestAnimationFrame(() => find(3)))
    },
    [rootOf, placeOf, hereKey]
  )

  // Replying opens the message's thread, so the answer doesn't land in the conversation.
  const onReply = useCallback((m: Message) => setThreadRoot(rootOf(m.seq) ?? m.seq), [rootOf])
  const peopleOf = useCallback(
    (list: Message[]) => {
      const seenNames = new Map<string, { name: string; label: string; agent: boolean; color: Color | null }>()
      for (const r of list) if (!seenNames.has(r.from)) seenNames.set(r.from, { name: r.from, label: nameOf(r.from), agent: isAgent(state.members.get(r.from)), color: colorOf(state, r.from) })
      return [...seenNames.values()]
    },
    [nameOf, state]
  )
  const summaryOf = (seq: number): ThreadSummary | undefined => {
    const list = threads.get(seq)
    if (!list?.length) return undefined
    return { count: list.length, last: list[list.length - 1]!.ts, people: peopleOf(list), forYou: list.some((r) => r.from !== me && r.to?.includes(me)) }
  }

  // Leaving the Room ends a replay and closes an agent's drawer (set while rendering, React's way to follow a value).
  if (wasFocus !== focus) {
    setWasFocus(focus)
    if (!focus) {
      setReplay(null)
      setDrawerAt(null)
      setFlagOpen(null)
    }
  }
  if (gone) {
    return (
      <Centered>
        <p className="text-title font-semibold">{gone === "closed" ? "This channel was closed" : "You’re no longer in this channel"}</p>
        <p className="mt-1 max-w-sm text-ui leading-normal text-ink-2">
          {gone === "closed" ? "Its owner deleted it, and nothing is left on the relay." : "The owner removed this browser, or it left."} This browser has forgotten it too.
        </p>
        <Button className="mt-4" onClick={onGone}>
          Back to channels
        </Button>
      </Centered>
    )
  }

  // ---------- the conversation: stamps, bubbles in runs, events as centred lines ----------
  const group = memberCount > 2
  const bubble = (m: Message, first: boolean, last: boolean, prev: Message | undefined, anchor?: string) => (
    <Bubble
      key={m.seq}
      anchor={anchor}
      m={m}
      me={me}
      author={(m.pk && byKey.get(m.pk)) || state.members.get(m.from)}
      trust={state.trust.get(m.seq)}
      online={online.has(m.from)}
      color={colorOf(state, m.from)}
      direct={state.direct.has(m.seq) ? (state.coordinator ?? undefined) : undefined}
      first={first}
      last={last}
      fresh={!anchor && isFresh(m.seq)}
      group={group}
      adjacentReply={(m.re?.length ?? 0) === 1 && (prev?.seq === m.re![0] || bySeq.get(m.re![0]!)?.kind === "event")}
      highlighted={highlight === m.seq}
      quoted={quoted}
      nameOf={nameOf}
      onReply={anchor ? undefined : onReply}
      onJump={jump}
      thread={search || anchor ? undefined : summaryOf(m.seq)}
      onOpenThread={setThreadRoot}
      // The coordinator's runs end on its face; only the latest one moves.
      face={coord && m.from === coord ? <CoordinatorAvatar size={28} mood={mood} live={m.seq >= (said?.last ?? 0) && !anchor} seed={0.3} /> : undefined}
    />
  )
  const dropped = isOwner ? droppedCount(state) : 0
  /** A place's conversation as rows: its card (a task's), stamps, bubbles in runs, events as quiet lines. `anchor` marks a copy (the Room's drawer). */
  const buildRows = (list: Message[], inMain: boolean, t: Task | undefined, anchor?: string): ReactNode[] => {
    const out: ReactNode[] = []
    if (dropped && inMain && !anchor)
      out.push(
        <p key="dropped" className="mt-3 pl-12 text-stamp text-ink-3">
          {dropped === 1 ? "1 message" : `${dropped} messages`} left out: forged, or not allowed by your settings.{" "}
          <button type="button" onClick={() => setShowDropped((v) => !v)} className="font-medium text-accent-text hover:underline">
            {showDropped ? "Hide them" : "Show them"}
          </button>
        </p>
      )
    // A task's own conversation opens on its card: what it is, where it stands, who has it.
    if (t) out.push(<TaskCard key="card" task={t} state={state} now={now} onOpen={() => (setDrawerAt(null), setOpenTask(t.id))} highlighted={!anchor && highlight === t.id} />)
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!
      const prev = list[i - 1]
      if (!prev || !sameDay(prev.ts, m.ts) || m.ts - prev.ts > STAMP_GAP) out.push(<TimeMark key={`s${m.seq}`} ts={m.ts} />)
      if (m.kind === "event") {
        const batch: Message[] = [m]
        let j = i + 1
        while (j < list.length && list[j]!.kind === "event" && sameDay(m.ts, list[j]!.ts) && list[j]!.ts - list[j - 1]!.ts <= STAMP_GAP) batch.push(list[j++]!)
        i = j - 1
        // In a task's conversation its card says where it stands; there, its events are the history under it.
        const lines = batch.filter((ev) => !(t && ev.seq === t.id))
        if (!lines.length) continue
        const alone = lines.filter((ev) => standsAlone(ev, state, me))
        const rest = lines.filter((ev) => !standsAlone(ev, state, me))
        const open = inMain ? (id: number) => go({ kind: "task", task: id }) : (id: number) => (setDrawerAt(null), setOpenTask(id))
        for (const ev of alone) out.push(<EventRow key={ev.seq} m={ev} state={state} now={now} onOpenTask={open} openLabel={inMain ? "Open" : "Details"} />)
        if (rest.length) out.push(<EventGroup key={`e${rest[0]!.seq}`} messages={rest} state={state} now={now} onOpenTask={open} highlight={highlight} openLabel={inMain ? "Open" : "Details"} />)
        continue
      }
      const next = list[i + 1]
      const runs = (a: Message | undefined, b: Message) => !!a && a.kind !== "event" && b.kind !== "event" && a.from === b.from && sameDay(a.ts, b.ts) && b.ts - a.ts <= RUN_GAP
      const first = !runs(prev, m) || m.ts - (prev?.ts ?? 0) > STAMP_GAP
      const last = !next || !runs(m, next) || next.ts - m.ts > STAMP_GAP
      out.push(bubble(m, first, last, prev, anchor))
    }
    return out
  }
  // A task's own conversation opens on its card: what it is, where it stands, who has it.
  const task = place.kind === "task" ? state.tasks.get(place.task) : undefined
  const rows = buildRows(visible, place.kind === "main", task)

  // The open thread: its first message, then every reply, in runs the same way.
  const root = threadRoot === null ? undefined : bySeqAll.get(threadRoot)
  const replies = threadRoot === null ? [] : (threads.get(threadRoot) ?? [])
  const threadRows: ReactNode[] = []
  if (root) {
    const list = [root, ...replies]
    list.forEach((m, i) => {
      const prev = list[i - 1]
      const next = list[i + 1]
      const first = !prev || prev.from !== m.from || m.ts - prev.ts > RUN_GAP
      const last = !next || next.from !== m.from || next.ts - m.ts > RUN_GAP
      threadRows.push(bubble(m, first, last, prev, "t"))
      if (i === 0 && replies.length) threadRows.push(<div key="split" className="my-3 pl-12 text-stamp text-ink-3">{replies.length === 1 ? "1 reply" : `${replies.length} replies`}</div>)
    })
  }

  const subtitle =
    connection === "connecting"
      ? "Connecting…"
      : connection === "reconnecting"
        ? "Reconnecting…"
        : (online.size ? `${memberCount} members, ${online.size} online` : `${memberCount} ${memberCount === 1 ? "member" : "members"}`) +
          (state.mode.coordinatorOnly ? (state.coordinator ? " · coordinator mode" : " · coordinator mode, no coordinator yet") : "")
  // What's going on, in one live line under the name: who coordinates, who's working, what needs you.
  const working = active.filter((m) => isAgent(m) && memberLoad(state, m.name, now).current.length > 0).length
  const needsMe = escalations.length + reviews.length + (isOwner ? requests.length : 0)
  const headline =
    connection === "connecting" || connection === "reconnecting" || focus
      ? subtitle
      : place.kind === "task"
        ? task
          ? // Where it stands is in the strip under this; here, who's in it.
            [taskId(task.id), threadMembers(state, place).filter((n) => n !== me).map(nameOf).join(", ") || "nobody on it yet"].join(" · ")
          : "Task"
        : place.kind === "dm"
          ? place.with.includes(me)
            ? "Just the two of you; anyone in the channel can read along"
            : `Between ${place.with.map(nameOf).join(" and ")}`
          : [
          state.coordinator && state.coordinator !== me ? `${nameOf(state.coordinator)} coordinating` : null,
          working ? `${working} working` : null,
          needsMe ? `${needsMe} ${needsMe === 1 ? "needs" : "need"} you` : null,
        ]
          .filter(Boolean)
          .join(" · ") || subtitle
  const hold = isOwner
    ? async (on: boolean, note?: string) => {
        const ev = { op: "hold.set" as const, on, ...(note ? { note } : {}) }
        const since = await send(on ? `on hold${note ? `: ${note}` : ""}` : "hold lifted", { kind: "event", ev })
        // Then the channel's settings say it too, for clients holding only the log's tail.
        await ch.setHold({ on, ...(note ? { note } : {}), since })
      }
    : undefined

  // Up close, in one quiet line: who it coordinates, what's in progress, what needs you. Each part opens it.
  const doing = [...state.tasks.values()].filter((t) => t.state === "doing")
  const agentsHere = active.filter((m) => isAgent(m) && m.name !== coordinator).length
  const team: TeamPart[] = [
    {
      key: "agents",
      label: agentsHere ? `Coordinating ${agentsHere === 1 ? "1 agent" : `${agentsHere} agents`}` : "No agents yet",
      onClick: () => (setInfo(true), setThreadRoot(null)),
    },
    ...(doing.length === 1
      ? [{ key: "doing", label: `${taskId(doing[0]!.id)} in progress`, onClick: () => go({ kind: "task", task: doing[0]!.id }) }]
      : doing.length > 1
        ? [{ key: "doing", label: `${doing.length} tasks in progress`, onClick: () => setBoard(true) }]
        : []),
    ...(needsMe ? [{ key: "needs", label: `${needsMe} ${needsMe === 1 ? "needs" : "need"} you`, tone: "decide" as const, onClick: () => setNeedsSignal((n) => n + 1) }] : []),
  ]
  /**
   * What needs you: as the slim banner (the conversation, and the Room's), or as rows for a face's
   * popover in the Room (`only`: one agent's escalations and reviews, or one join request).
   */
  const needsYou = (variant: "banner" | "list", only?: { agent?: string; request?: string }) => (
    <NeedsYou
      variant={variant}
      openSignal={variant === "banner" && focus ? needsSignal : 0}
      now={now}
      roomId={roomId}
      escalations={only ? escalations.filter((m) => !!only.agent && m.from === only.agent) : escalations}
      reviews={only ? reviews.filter((t) => !!only.agent && t.owner === only.agent) : reviews}
      joinedVia={only ? new Map() : joinedVia}
      requestFilter={only ? (r) => r.id === only.request : undefined}
      onDismissJoined={() => setJoinedVia(new Map())}
      nameOf={nameOf}
      onReply={async (m, text) => void (await send(text, { to: [m.from], re: [m.seq], kind: "msg" }))}
      onApproveTask={async (t: Task) => void (await send(`${taskId(t.id)} done`, { kind: "event", ev: { op: "task.update", task: t.id, state: "done", note: "approved" }, ...(t.owner ? { to: [t.owner] } : {}) }))}
      onSendBack={async (t: Task, why: string) => void (await send(`${taskId(t.id)} doing`, { kind: "event", ev: { op: "task.update", task: t.id, state: "doing", note: why }, ...(t.owner ? { to: [t.owner] } : {}) }))}
      onOpenTask={(id) => go({ kind: "task", task: id })}
      onJump={(seq) => (setMainView("conversation"), jump(seq))}
    />
  )

  // The face beside the name: the coordinator for Main, the task's state for a task, the other one for a direct conversation.
  const placeFace =
    place.kind === "main" ? (
      coord && !focus ? (
        <CoordinatorAvatar size={32} mood={mood} live seed={0.7} />
      ) : (
        <ChannelIconTile icon={icon} title={title} size={32} />
      )
    ) : place.kind === "task" ? (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-field">{task ? <StateMark state={task.state} /> : null}</span>
    ) : (
      (() => {
        const other = place.with.find((n) => n !== me) ?? place.with[0]!
        return other === coord ? <CoordinatorAvatar size={32} mood={mood} live seed={0.7} /> : <Monogram name={nameOf(other)} agent={isAgent(state.members.get(other))} color={colorOf(state, other)} size={32} />
      })()
    )
  // A direct conversation you're in is named for the other one, as Messages names a chat.
  const placeTitle = place.kind === "main" ? title : place.kind === "task" ? (task ? task.title : "Task") : place.with.includes(me) ? nameOf(place.with.find((n) => n !== me) ?? me) : place.with.map(nameOf).join(" & ")
  // A direct conversation is between its two; anyone else reads it.
  const mayWrite = place.kind !== "dm" || place.with.includes(me)
  // A task's thread reaches whoever works it on its own (state.ts threadMembers); only an @ names anyone. A direct one goes to the other one.
  const extra = place.kind === "main" ? undefined : sendFrom(state, place, me)

  // Just the main conversation (a new channel): nothing to choose between yet.
  const several = places.size > 1 || place.kind !== "main" || state.tasks.size > 0
  const placeList = (className?: string) =>
    !several ? null : (
    <PlaceList
      className={className}
      me={me}
      places={places}
      current={board ? "board" : hereKey}
      state={state}
      nameOf={nameOf}
      unreadIn={unreadIn}
      onPick={(p) => (go(p), setInfo(false))}
      onBoard={() => (setBoard(true), setOpenTask(null), setThreadRoot(null), setInfo(false))}
    />
  )

  // The field under the conversation; in the Room it sits under the dialogue, wherever the Room puts that.
  const composerHere = mayWrite ? (
    <Composer
      key={hereKey}
      me={me}
      people={people}
      replyTo={replyTo}
      nameOf={nameOf}
      onClearReply={() => setReplyTo(null)}
      disabled={connection === "connecting"}
      route={coordinator && place.kind === "main" ? { coordinator, label: nameOf(coordinator), view: "coordinator" } : undefined}
      extra={extra}
      seed={focus ? starter : undefined}
      onEscape={
        coordinator && hereKey === "main" && !board && openTask === null
          ? // One stack, top first: a flag's popover, then an agent's drawer, then a replay, then the view.
            () => (flagOpen !== null ? setFlagOpen(null) : drawerAt ? setDrawerAt(null) : replay !== null ? setReplay(null) : setMainView(focus ? "conversation" : "focus"))
          : undefined
      }
      placeholder={
        place.kind === "main"
          ? state.coordinator && state.coordinator !== me
            ? `Message ${nameOf(state.coordinator)}`
            : "Message everyone"
          : place.kind === "task"
            ? task
              ? `Message in ${taskId(task.id)} · ${task.title}`
              : "Message in this task"
            : `Message ${nameOf(place.with.find((n) => n !== me) ?? "")} privately`
      }
      send={async (body, opts) => {
        atBottom.current = true
        return send(body, opts)
      }}
    />
  ) : (
    <p className="shrink-0 px-6 pt-2 pb-4 text-center text-meta text-ink-3">
      Between {place.kind === "dm" ? place.with.map(nameOf).join(" and ") : ""}. You can read along; talk with them in the main conversation.
    </p>
  )
  // An agent's conversation, opened from its face: in the Room's dialogue column when wide, over the Room when not.
  const drawerView =
    drawer && drawerPlace
      ? (mode: "column" | "overlay") => (
        <AgentDrawer
          mode={mode}
          back={nameOf(coordinator ?? me)}
          title={drawerTask ? drawerTask.title : `${nameOf(drawer)} and ${nameOf(drawerPlace.kind === "dm" ? (drawerPlace.with.find((n) => n !== drawer) ?? me) : me)}`}
          subtitle={[nameOf(drawer), drawerTask ? `${taskId(drawerTask.id)} · ${STATE_WORD[drawerTask.state]}` : "Direct conversation", online.has(drawer) ? "online" : "away"].join(" · ")}
          face={<CoordinatorAvatar size={32} {...faceOf(drawer, colorOf(state, drawer))} label={nameOf(drawer)} />}
          onClose={() => setDrawerAt(null)}
          composer={
            drawerPlace.kind !== "dm" || drawerPlace.with.includes(me) ? (
              <Composer
                key={`d${drawerKey}`}
                me={me}
                people={people}
                replyTo={null}
                nameOf={nameOf}
                onClearReply={() => undefined}
                disabled={connection === "connecting"}
                extra={sendFrom(state, drawerPlace, me)}
                placeholder={drawerTask ? `Message in ${taskId(drawerTask.id)} · ${drawerTask.title}` : `Message ${nameOf(drawer)} privately`}
                send={send}
              />
            ) : (
              <div className="shrink-0 px-5 pt-2 pb-4 text-center text-meta text-ink-3">
                Between {drawerPlace.with.map(nameOf).join(" and ")}: you read along.{" "}
                {/* In strict coordinator mode an agent can't answer a person, so a direct line to it would go one way. */}
                {state.mode.coordinatorOnly && state.mode.strict && coordinator && drawer !== coordinator ? (
                  <>
                    {nameOf(drawer)} talks with people through {nameOf(coordinator)}: ask {nameOf(coordinator)} instead.
                  </>
                ) : (
                  <button type="button" className="font-medium text-ink-2 hover:text-ink" onClick={() => (setDrawerAt(null), setMainView("conversation"), go(dmPlace(me, drawer)))}>
                    Message {nameOf(drawer)} yourself
                  </button>
                )}
              </div>
            )
          }
        >
          <DrawerRows
            messages={messages}
            placeOf={placeOf}
            at={drawerKey ?? ""}
            state={state}
            task={drawerTask}
            now={now}
            bubble={bubble}
            empty={`Nothing said here yet. What ${nameOf(drawer)} says about its work shows up here.`}
            onOpenTask={(id) => (setDrawerAt(null), setOpenTask(id))}
          />
        </AgentDrawer>
        )
      : null

  return (
    <ChannelControls
      code={member.code}
      myKey={member.identity.pk}
      isOwner={isOwner}
      roster={roster}
      requests={requests}
      online={online}
      state={state}
      now={now}
      onApprove={async (r, scopes) => {
        await ch.approve(r, wireScopes(scopes) ? { scopes } : undefined)
        await Promise.all([refreshRequests(), refreshRoster()])
      }}
      onScopes={async (m, scopes) => {
        const wire = wireScopes(scopes)
        const seq = await send(`set what ${m.name} may do: ${wire ? describeScopes(wire) : "full"}`, { kind: "event", ev: { op: "scope.set", member: m.name, pk: m.pk, scopes: wire } })
        // Then their record says it too, with the relay's bit (the reconcile puts both right if this fails).
        await ch.updateScopes(m, scopes, seq)
        await refreshRoster()
      }}
      onRole={async (ev) => {
        // Addressed to the member, so their own client tells them at once.
        const seq = await send(ev.op === "role.set" ? `made ${ev.member} ${ev.role ?? "unassigned"}` : `kept ${ev.member}'s role`, { kind: "event", ev, to: [ev.member] })
        // Then the member's record says it too, for views holding only the log's tail (T885).
        const target = ev.op === "role.set" ? roster.find((m) => m.active && m.name === ev.member && !m.owner) : undefined
        if (ev.op === "role.set" && target) await ch.updateRole(target, ev.role, ev.about, seq).catch(() => {})
      }}
      onDeny={async (r) => {
        await ch.deny(r.id)
        await refreshRequests()
      }}
      onCheck={async (r) => {
        await ch.checkRequest(r)
        await refreshRequests()
      }}
      onRemove={async (m) => {
        await ch.remove(m.pk)
        await refreshRoster()
      }}
      roomId={member.access.roomId}
      title={title}
      onMode={
        isOwner
          ? async (coordinatorOnly, strict) => {
              const ev = { op: "mode.set" as const, coordinatorOnly, strict: coordinatorOnly && strict }
              const since = await send(coordinatorOnly ? `coordinator-only on${ev.strict ? " (strict)" : ""}` : "coordinator-only off", { kind: "event", ev })
              // Then the channel's settings say it too, for clients holding only the log's tail.
              await ch.setMode({ coordinatorOnly, strict: ev.strict, since })
            }
          : undefined
      }
      onHold={hold}
      onCharter={
        isOwner
          ? async (text) => {
              const since = await send(text ? `charter: ${text}` : "cleared the charter", { kind: "event", ev: { op: "charter.set", text } })
              await ch.setCharter({ text, since })
            }
          : undefined
      }
      onRename={
        isOwner
          ? async (name) => {
              await ch.setTitle(name)
              // Show it here at once; other members pick it up from the relay's info frame.
              const stored = loadMember(member.code)
              if (stored) saveMember({ ...stored, name: name.trim().slice(0, 80) })
            }
          : undefined
      }
      onCloseChannel={async () => {
        await ch.close()
        forgetChannel(member.code)
        onGone()
      }}
      onLeaveChannel={async () => {
        await ch.leave()
        forgetChannel(member.code)
        onGone()
      }}
      pairing={{ code: member.code, slot: () => ch.pairSlot(), list: (slot) => ch.pairs(slot), open: (id, nonce, slot) => ch.pairOpen(id, nonce, slot), answer: (p, slot) => ch.pairAnswer(p, member.identity, slot) }}
    >
      {/* The channel's conversations, under its row in the list (on a phone, in its details). */}
      <PlaceSlot>{placeList()}</PlaceSlot>
      <div className="flex h-full min-w-0 flex-1">
        <div className={cx("relative flex min-w-0 flex-1 flex-col bg-canvas", (root || info) && "hidden md:flex")}>
          {/* Who you're talking with, on the conversation's column: a face, the name, and what's going on. */}
          <header className="shrink-0 bg-canvas">
            <div className="mx-auto flex h-14 w-full max-w-[792px] items-center gap-1 px-2 md:px-4">
              <IconButton label="Channels" className="md:hidden" onClick={onBack}>
                <Icon icon={ArrowLeft01Icon} size={20} />
              </IconButton>
              <button
                type="button"
                onClick={() => (setInfo((v) => !v), setThreadRoot(null))}
                aria-expanded={info}
                aria-label={`Details: ${placeTitle}, ${subtitle}`}
                className="-ml-1.5 flex min-w-0 items-center gap-2.5 rounded-ctl py-1 pr-2 pl-1.5 text-left transition-colors hover:bg-wash"
              >
                {placeFace}
                <span className="min-w-0">
                  <span className="block truncate text-title font-semibold">{placeTitle}</span>
                  <span className="block truncate text-meta text-ink-3">{headline}</span>
                </span>
              </button>
              <span className="flex-1" />
              {/* The whole conversation, and back to the coordinator up close. */}
              {coordinator && hereKey === "main" && !focus && !board && openTask === null && <FocusButton name={nameOf(coordinator)} onClick={() => (setMainView("focus"), setSearch(null))} />}
              {/* The owner's stop button: every agent, at once. */}
              {hold &&
                (!quiet || state.hold) &&
                (state.hold ? (
                  // Paused: play, in amber, where the stop was.
                  <IconButton label="Resume agents" className="bg-decide-wash text-decide hover:bg-decide-wash hover:text-decide" onClick={() => void hold(false).then(() => toast("Agents may carry on"), (err) => toast(errorText(err), "error"))}>
                    <Icon icon={PlayCircleIcon} size={18} />
                  </IconButton>
                ) : (
                  // A circled pause reads as a media control; two bare bars read as "columns".
                  <IconButton label="Pause all agents" onClick={() => setPausing(true)}>
                    <Icon icon={PauseCircleIcon} size={18} />
                  </IconButton>
                ))}
              <IconButton label="Search" active={search !== null} onClick={() => setSearch((s) => (s === null ? "" : null))} disabled={board}>
                <Icon icon={Search01Icon} size={17} />
              </IconButton>
              <IconButton label={info ? "Hide details" : "Show details"} active={info} onClick={() => (setInfo((v) => !v), setThreadRoot(null))}>
                <Icon icon={SidebarRightIcon} size={17} />
              </IconButton>
            </div>
          </header>

          <HoldBanner />
          {pausing && hold && <HoldDialog onClose={() => setPausing(false)} onSave={(note) => hold(true, note)} />}

          {openTask !== null ? (
            <TaskPage
              id={openTask}
              state={state}
              messages={messages}
              me={me}
              now={now}
              onOpen={setOpenTask}
              onClose={() => setOpenTask(null)}
              noteBlocked={state.members.get(me)?.scopes.includes("tasks") === false ? "The owner hasn’t let you change tasks here, so you can’t comment on one." : null}
              onNote={async (note) => void (await send(`noted on ${taskId(openTask)}`, { kind: "event", ev: { op: "task.update", task: openTask, note } }))}
            />
          ) : board ? (
            <Tasks state={state} now={now} onOpen={(id) => go({ kind: "task", task: id })} />
          ) : (
            <>
              {focus && coordinator ? (
                <Room
                  roomId={roomId}
                  me={me}
                  coordinator={coordinator}
                  nameOf={nameOf}
                  state={state}
                  messages={messages}
                  online={online}
                  now={now}
                  mood={mood}
                  waiting={waiting}
                  team={team}
                  needsFor={(agent) => needsYou("list", { agent })}
                  requestFor={(r) => needsYou("list", { request: r.id })}
                  requests={isOwner ? requests : []}
                  escalations={escalations}
                  reviews={reviews}
                  foldAt={foldAt}
                  isMain={isMain}
                  onOpenAgent={setDrawer}
                  onOpenTask={(id) => go({ kind: "task", task: id })}
                  onShowConversation={() => setMainView("conversation")}
                  newCount={unreadIn("main").n}
                  starters={STARTERS}
                  onStarter={(text) => setStarter((was) => ({ text, n: (was?.n ?? 0) + 1 }))}
                  code={member.code}
                  isOwner={isOwner}
                  banner={needsMe || joinedVia.size ? needsYou("banner") : null}
                  replay={replay}
                  onReplay={setReplay}
                  flagOpen={flagOpen}
                  onFlagOpen={setFlagOpen}
                  composer={composerHere}
                  drawer={drawerView}
                />
              ) : (
                <>
                {search !== null && (
                  <div className="mx-auto w-full max-w-[792px] shrink-0 px-4 pt-1">
                    <TextField
                      autoFocus
                      value={search}
                      placeholder={place.kind === "main" ? "Search this channel" : `Search ${placeTitle}`}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setSearch(null)}
                      className="rounded-full"
                    />
                  </div>
                )}

                <div
                  ref={scroller}
                  className="flex-1 overflow-y-auto"
                  onScroll={(e) => {
                    const el = e.currentTarget
                    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
                    if (atBottom.current && behind) setBehind(0)
                  }}
                >
                  <div className="relative mx-auto w-full max-w-[792px] px-4 pb-6">
                    {/* What needs a person: at the top of the main conversation, as system cards. */}
                    {hereKey === "main" && needsYou("banner")}
                    {connection === "connecting" && messages.length === 0 ? (
                      <Centered>
                        <Spinner />
                      </Centered>
                    ) : hereKey === "main" && noAgents && !search ? (
                      <>
                        <AddAgent code={member.code} isOwner={isOwner} />
                        {/* A brand-new channel's own setup lines (coordinator mode on) aren't worth reading yet. */}
                        {!quiet && rows}
                      </>
                    ) : visible.length === 0 && !task ? (
                      <Centered>
                        <p className="text-body font-semibold">{search ? "No results" : "No messages yet"}</p>
                        <p className="mt-1 max-w-xs text-ui leading-normal text-ink-2">
                          {search ? `No message here mentions “${search}”.` : place.kind === "dm" ? "What these two say to each other shows up here." : "What’s said here shows up the moment it’s sent."}
                        </p>
                      </Centered>
                    ) : (
                      rows
                    )}
                  </div>
                </div>

                {behind > 0 && (
                  <button
                    type="button"
                    onClick={toBottom}
                    className="animate-rise absolute bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-raised py-1.5 pr-3.5 pl-2.5 text-ui font-medium text-accent-text shadow-pop"
                  >
                    <Icon icon={ArrowDown01Icon} size={15} />
                    {behind === 1 ? "1 new message" : `${behind} new messages`}
                  </button>
                )}
                </>
              )}

              {!focus && composerHere}
            </>
          )}

        </div>

        {root && !info && (
          <ThreadPanel
            count={replies.length}
            onClose={() => setThreadRoot(null)}
            composer={
              <Composer
                key={root.seq}
                thread
                me={me}
                people={people}
                replyTo={root}
                nameOf={nameOf}
                onClearReply={() => undefined}
                disabled={connection === "connecting"}
                send={send}
                route={coordinator && place.kind === "main" ? { coordinator, label: nameOf(coordinator), view: "everything" } : undefined}
              />
            }
          >
            {threadRows}
          </ThreadPanel>
        )}

        {info && (
          <InfoPanel
            title={title}
            icon={icon}
            subtitle={subtitle}
            onClose={() => setInfo(false)}
            onPause={hold && !state.hold ? () => setPausing(true) : undefined}
            conversations={several ? placeList("p-1.5") : undefined}
            onMessage={(name) => (go(dmPlace(me, name)), setInfo(false))}
            mood={mood}
            notes={<Notes state={state} now={now} onClear={async (key) => void (await send(`cleared ${key}`, { kind: "event", ev: { op: "fact.del", key } }))} />}
          />
        )}
      </div>
    </ChannelControls>
  )
}

/** Renders its children under the open channel's row in the list, when the list is there. */
function PlaceSlot({ children }: { children: ReactNode }) {
  const slot = usePlaceSlot()
  return slot ? createPortal(children, slot) : null
}

/**
 * The channel's conversations: main (people and the coordinator), one per open task (the agents
 * working it), then direct ones; finished tasks fold under Earlier. One row each, a status dot for a
 * task, a small face for a direct one.
 */
function PlaceList({
  places,
  current,
  state,
  nameOf,
  unreadIn,
  onPick,
  onBoard,
  // Rows' text sits on the channel name's edge; the dot or face hangs in the gutter to its left.
  className = "mt-0.5 mb-2 ml-[38px] mr-1",
  me,
}: {
  className?: string
  me: string
  places: Map<string, PlaceSummary>
  current: string
  state: ChannelState
  nameOf: (n: string) => string
  unreadIn: (key: string) => { n: number; forMe: boolean }
  onPick: (p: Place) => void
  onBoard: () => void
}) {
  const [earlier, setEarlier] = useState(false)
  const all = [...places.entries()]
  const tasks = all.filter(([, i]) => i.place.kind === "task" && !i.done).sort((a, b) => b[1].last - a[1].last)
  const done = all.filter(([, i]) => i.place.kind === "task" && i.done).sort((a, b) => b[1].last - a[1].last)
  const dms = all.filter(([, i]) => i.place.kind === "dm").sort((a, b) => b[1].last - a[1].last)
  const rowClass = (on: boolean, strong: boolean) =>
    cx("flex h-7 w-full items-center gap-2 rounded-ctl pr-2 pl-0 text-left text-ui transition-colors", on ? "bg-pick font-semibold text-ink" : strong ? "font-semibold text-ink hover:bg-wash" : "text-ink-2 hover:bg-wash hover:text-ink")
  const row = (key: string, info: PlaceSummary) => {
    const p = info.place
    const t = p.kind === "task" ? state.tasks.get(p.task) : undefined
    const { n: unread, forMe } = key === current ? { n: 0, forMe: false } : unreadIn(key)
    const other = p.kind === "dm" ? (p.with.includes(me) ? (p.with.find((n) => n !== me) ?? me) : null) : null
    return (
      <button
        key={key}
        type="button"
        aria-current={key === current ? "page" : undefined}
        // The dot says where a task stands; the word is here, so the title gets the room.
        title={t ? `${taskId(t.id)} ${t.title} · ${STATE_WORD[t.state]}` : undefined}
        onClick={() => onPick(p)}
        className={rowClass(key === current, unread > 0 && forMe)}
      >
        {/* The row is named by its words; the dot or face beside them is decoration. */}
        <span aria-hidden className="flex w-4 shrink-0 justify-center">
          {t ? (
            <StateMark state={t.state} />
          ) : p.kind === "dm" ? (
            (other ?? p.with[0]!) === state.coordinator ? (
              <CoordinatorAvatar size={16} />
            ) : (
              <Monogram name={nameOf(other ?? p.with[0]!)} agent={isAgent(state.members.get(other ?? p.with[0]!))} color={colorOf(state, other ?? p.with[0]!)} size={16} />
            )
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {p.kind === "main" ? (
            "Main"
          ) : t ? (
            <>
              <span className="text-ink-3 tabular-nums">{taskId(t.id)}</span> {t.title}
              <span className="sr-only">, {STATE_WORD[t.state]}</span>
            </>
          ) : p.kind === "dm" ? (
            other ? nameOf(other) : p.with.map(nameOf).join(" ↔ ")
          ) : (
            "Task"
          )}
        </span>
        {unread > 0 ? (
          forMe ? (
            <span className="shrink-0 rounded-full bg-accent px-1.5 text-stamp font-semibold text-accent-ink tabular-nums">{unread}</span>
          ) : (
            // News that isn't for you: a quiet dot, not a count that reads like mail.
            <span aria-label="New messages" className="size-1.5 shrink-0 rounded-full bg-ink-3" />
          )
        ) : null}
      </button>
    )
  }
  const head = (text: string) => <p className="pt-2.5 pr-2 pb-1 pl-6 text-stamp font-semibold tracking-[0.04em] text-ink-3 uppercase">{text}</p>
  return (
    <nav aria-label="Conversations" className={cx("space-y-px", className)}>
      {row("main", places.get("main") ?? { place: MAIN, last: 0, count: 0 })}
      {(tasks.length > 0 || state.tasks.size > 0) && head("Tasks")}
      {tasks.map(([k, i]) => row(k, i))}
      {done.length > 0 && (
        <>
          <button type="button" aria-expanded={earlier} onClick={() => setEarlier(!earlier)} className="flex h-7 w-full items-center gap-2 rounded-ctl pr-2 pl-0 text-left text-ui text-ink-3 hover:bg-wash hover:text-ink-2">
            <span className="flex w-4 shrink-0 justify-center">
              <Icon icon={ArrowDown01Icon} size={12} className={cx("transition-transform", !earlier && "-rotate-90")} />
            </span>
            Earlier <span className="tabular-nums">{done.length}</span>
          </button>
          {earlier && done.map(([k, i]) => row(k, i))}
        </>
      )}
      {state.tasks.size > 0 && (
        <button type="button" aria-current={current === "board" ? "page" : undefined} onClick={onBoard} className={cx(rowClass(current === "board", false), current !== "board" && "text-ink-3")}>
          <span className="w-4 shrink-0" />
          All tasks
        </button>
      )}
      {dms.length > 0 && head("Direct")}
      {dms.map(([k, i]) => row(k, i))}
    </nav>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-60 flex-1 flex-col items-center justify-center p-8 text-center">{children}</div>
}
