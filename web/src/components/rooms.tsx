import { Dialog } from "@base-ui/react/dialog"
import { Add01Icon, ArrowDown01Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { GENERAL_ROOM, MAX_ROOM_NAME, MAX_ROOMS, ignored, type Message } from "@mc/protocol.ts"
import { roomName, type ChannelState, type Room } from "@mc/state.ts"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Button, IconButton, Modal, TextField, errorText } from "./kit"
import { Menu, MenuItem } from "./ui/menu"

// Rooms: a channel is the server, and its rooms are where conversations happen.
// Everyone in the channel reads every room; the owner makes and names them.

/** The room a chat message is in (events belong to the whole channel, shown in general). */
export const roomOfMessage = (state: ChannelState, m: Message) => (m.kind === "event" ? GENERAL_ROOM : (state.roomOf.get(m.seq) ?? GENERAL_ROOM))

// The last message this browser saw in each room, per channel, kept in localStorage. A small store
// (not React state) so marking a room read from an effect doesn't cascade renders.
const seenListeners = new Set<() => void>()
const seenCache = new Map<string, Record<string, number>>()
function readSeen(key: string): Record<string, number> {
  let v = seenCache.get(key)
  if (!v) {
    try {
      v = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, number>
    } catch {
      v = {}
    }
    seenCache.set(key, v)
  }
  return v
}
function writeSeen(key: string, v: Record<string, number>) {
  seenCache.set(key, v)
  localStorage.setItem(key, JSON.stringify(v))
  for (const l of seenListeners) l()
}
const subscribeSeen = (l: () => void) => (seenListeners.add(l), () => void seenListeners.delete(l))

/**
 * Which room this browser has open in a channel, and the last message it saw in each, so a room
 * can say what's new there. Both stay in this browser.
 */
export function useRooms(roomId: string, state: ChannelState, messages: Message[], me: string) {
  const openKey = `mc.room.${roomId}`
  const seenKey = `mc.room-seen.${roomId}`
  const [active, setActive] = useState<string>(() => localStorage.getItem(openKey) ?? GENERAL_ROOM)
  const seen = useSyncExternalStore(subscribeSeen, () => readSeen(seenKey))
  // A room that's gone (or never was here) falls back to general.
  const current = state.rooms.has(active) ? active : GENERAL_ROOM
  const open = useCallback(
    (id: string) => {
      setActive(id)
      if (id === GENERAL_ROOM) localStorage.removeItem(openKey)
      else localStorage.setItem(openKey, id)
    },
    [openKey]
  )

  // Newest message per room, and what's arrived since this browser last looked.
  const { newest, unread } = useMemo(() => {
    const newest = new Map<string, number>()
    const unread = new Map<string, number>()
    for (const m of messages) {
      if (m.kind === "event" || ignored(state.trust.get(m.seq))) continue
      const r = roomOfMessage(state, m)
      newest.set(r, Math.max(newest.get(r) ?? 0, m.seq))
      // A room this browser has never opened starts with nothing new (first visit isn't a backlog).
      if (m.from !== me && seen[r] !== undefined && m.seq > seen[r]) unread.set(r, (unread.get(r) ?? 0) + 1)
    }
    return { newest, unread }
  }, [messages, state, me, seen])

  // Looking at a room marks it read, and the first sight of any room sets where "new" starts.
  useEffect(() => {
    const next = { ...seen }
    let changed = false
    for (const id of state.rooms.keys()) {
      const head = newest.get(id) ?? 0
      if (next[id] === undefined || (id === current && next[id] < head)) {
        next[id] = head
        changed = true
      }
    }
    if (changed) writeSeen(seenKey, next)
  }, [current, newest, state.rooms, seen, seenKey])

  return { active: current, open, unread }
}

// Where the rail is drawn: a slot under the open channel's row in the sidebar. The sidebar hands
// the element over here, and the conversation (which knows the rooms) draws into it.
let slot: HTMLElement | null = null
const slotListeners = new Set<() => void>()
export function setRoomsSlot(el: HTMLElement | null) {
  if (slot === el) return
  slot = el
  for (const l of slotListeners) l()
}
export function useRoomsSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (l) => (slotListeners.add(l), () => void slotListeners.delete(l)),
    () => slot
  )
}

/** The channel's rooms, nested under its row in the sidebar (wide screens). */
export function RoomRail({
  state,
  active,
  unread,
  onOpen,
  isOwner,
  onCreate,
  onRename,
}: {
  state: ChannelState
  active: string
  unread: Map<string, number>
  onOpen: (id: string) => void
  isOwner: boolean
  onCreate: () => void
  onRename: (room: Room) => void
}) {
  return (
    <ul aria-label="Rooms" className="mt-0.5 mb-1 hidden gap-px md:grid">
      {/* A lone #general says nothing the channel row doesn't: list rooms once there are two. */}
      {state.rooms.size > 1 && [...state.rooms.values()].map((r) => {
        const on = r.id === active
        const n = unread.get(r.id) ?? 0
        return (
          <li key={r.id} data-room={r.id} className="group relative">
            <button
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => onOpen(r.id)}
              className={cx(
                "flex h-7 w-full items-center gap-1.5 rounded-row pr-2 pl-8 text-left text-ui transition-colors",
                on ? "bg-wash-2 font-medium text-ink" : n ? "font-medium text-ink hover:bg-wash" : "text-ink-2 hover:bg-wash hover:text-ink"
              )}
            >
              <span className="text-ink-3">#</span>
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {n > 0 && !on && <span className="text-meta font-medium text-ink-2 tabular-nums group-hover:opacity-0">{n}</span>}
            </button>
            {isOwner && (
              <span className="absolute top-1/2 right-1 hidden -translate-y-1/2 group-focus-within:block group-hover:block">
                <Menu
                  align="end"
                  trigger={
                    <IconButton label={`More for #${r.name}`} className="size-6">
                      <Icon icon={MoreHorizontalIcon} size={14} />
                    </IconButton>
                  }
                >
                  <MenuItem onClick={() => onRename(r)}>Rename room…</MenuItem>
                </Menu>
              </span>
            )}
          </li>
        )
      })}
      {isOwner && state.rooms.size < MAX_ROOMS && (
        <li>
          <button type="button" onClick={onCreate} className="flex h-7 w-full items-center gap-1.5 rounded-row pr-2 pl-8 text-left text-ui text-ink-3 transition-colors hover:bg-wash hover:text-ink-2">
            <Icon icon={Add01Icon} size={13} />
            New room
          </button>
        </li>
      )}
    </ul>
  )
}

/** The rooms as a menu, for narrow screens where there's no rail. */
export function RoomMenu({ state, active, unread, onOpen }: { state: ChannelState; active: string; unread: Map<string, number>; onOpen: (id: string) => void }) {
  const total = [...unread.entries()].filter(([id]) => id !== active).reduce((a, [, n]) => a + n, 0)
  return (
    <span className="shrink-0 md:hidden">
      <Menu
        trigger={
          <button type="button" className="flex h-7 shrink-0 items-center gap-1 rounded-ctl bg-wash-2 px-2.5 text-ui font-medium">
            <span className="text-ink-3">#</span>
            <span className="max-w-[9rem] truncate">{state.rooms.get(active)?.name}</span>
            {total > 0 && <span className="rounded-full bg-ink px-1.5 text-meta font-semibold text-canvas tabular-nums">{total}</span>}
            <Icon icon={ArrowDown01Icon} size={13} />
          </button>
        }
      >
        {[...state.rooms.values()].map((r) => (
          <MenuItem key={r.id} onClick={() => onOpen(r.id)}>
            <span className={cx("flex-1 truncate", r.id === active && "font-medium")}># {r.name}</span>
            {!!unread.get(r.id) && r.id !== active && <span className="text-meta text-ink-3 tabular-nums">{unread.get(r.id)}</span>}
          </MenuItem>
        ))}
      </Menu>
    </span>
  )
}

/** The owner names a new room, or renames one. Names are unique in the channel, case aside. */
export function RoomDialog({ state, room, onClose, onSave }: { state: ChannelState; room: Room | null; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(room?.name ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = roomName(name.replace(/^#/, ""))
  const taken = [...state.rooms.values()].some((r) => r.id !== room?.id && r.name.toLowerCase() === next.toLowerCase())
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(next)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose}>
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (next && !taken && next !== room?.name) void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">{room ? "Rename room" : "New room"}</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          {room ? "Everyone sees the new name; the room and what was said in it stay as they are." : "A room for one conversation. Everyone in the channel can read and write in it."}
        </Dialog.Description>
        <TextField className="mt-4" autoFocus value={name} maxLength={MAX_ROOM_NAME} onChange={(e) => setName(e.target.value)} placeholder="design-review" aria-label="Room name" aria-invalid={taken || !!error} />
        {(taken || error) && (
          <p role="alert" className="mt-2 text-ui text-alert">
            {taken ? `There's already a room called ${next}.` : error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !next || taken || next === room?.name}>
            {room ? "Rename" : "Create room"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
