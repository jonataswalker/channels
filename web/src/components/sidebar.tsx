import { ComputerIcon, LockIcon, Settings01Icon } from "@hugeicons/core-free-icons"

import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"
import { useIcons, useMemberIcons } from "@/lib/icons"
import { formatShort } from "@/lib/format"
import { useSecrets } from "@/lib/secrets"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { CoordinatorAvatar } from "./coordinator-head"
import { Icon } from "./icon"
import { NewMenu, SearchButton, SidebarToggle } from "./chrome"
import { Monogram, Wordmark } from "./kit"
import { Menu, MenuItem, MenuNote, MenuSeparator } from "./ui/menu"

/** What a row says on hover: what was said last, or why this browser can't open it yet. */
function rowNote(c: ChannelRow): string {
  if (c.state === "pending") return "Waiting for the owner to let you in"
  if (c.state === "agents") return c.agents === 1 ? "One of your agents is here" : `${c.agents} of your agents are here`
  if (c.recent?.text) return c.recent.from ? `${c.recent.from}: ${c.recent.text}` : c.recent.text
  return "No messages yet"
}

/** Your channels: the ones this app is in or waiting on. */
export function Sidebar({
  rows,
  news,
  active,
  onSelect,
  onNew,
  onJoin,
  onComputers,
  onSettings,
  onPalette,
  className,
}: {
  rows: ChannelRow[]
  /** What's new in each row, in the same order. */
  news: RowNews[]
  active: string
  onSelect: (code: string) => void
  onNew: () => void
  onJoin: () => void
  onComputers: () => void
  onSettings: () => void
  onPalette: () => void
  className?: string
}) {
  const person = useSecrets().person
  const newsOf = new Map(rows.map((c, i) => [c.room, news[i]]))
  const icons = useIcons()
  useMemberIcons(rows.filter((c) => c.state === "member").map((c) => c.code))

  return (
    <aside className={cx("relative h-full w-full shrink-0 flex-col bg-rail shell-mac:bg-(--list-glass) md:w-[300px]", className)}>
      {/* The list's part of the window's one header row, as Grok lays it out: past a Mac's traffic
          lights, hide the list; on the right, search (the ⌘K palette) and new. The row moves the
          window in the desktop app. */}
      <header className="drag flex h-(--chrome-h) shrink-0 items-center gap-2 pr-3 pl-3 shell-mac:pl-(--lights-w)">
        <SidebarToggle />
        {!person && !rows.length && <Wordmark className="pl-1 text-title" />}
        <span className="flex-1" />
        <SearchButton onPalette={onPalette} />
        <NewMenu onNew={onNew} onJoin={onJoin} />
      </header>

      {/* Channels only: a channel's tasks and direct conversations are tabs in the channel itself. */}
      <nav aria-label="Channels" className={cx("flex-1 space-y-0.5 overflow-y-auto px-2 pt-2", person ? "pb-20" : "pb-3")}>
        {rows.map((c) => {
          const selected = c.code === active
          const reachable = c.state === "member"
          const n = newsOf.get(c.room)
          // The open channel shows its own news; its row says only what needs you.
          const fresh = !selected && !!n?.fresh
          return (
            <button
              key={c.room}
              type="button"
              onClick={() => onSelect(c.code)}
              aria-current={selected ? "page" : undefined}
              title={rowNote(c)}
              className={cx("flex w-full items-center gap-3 rounded-card px-2.5 py-2.5 text-left transition-colors", selected ? "bg-pick" : "hover:bg-wash")}
            >
              {c.recent?.byCoordinator && reachable ? <CoordinatorAvatar size={48} label="The coordinator spoke last" /> : <ChannelIconTile icon={icons.get(c.room) ?? null} title={c.title} size={48} />}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cx("min-w-0 flex-1 truncate text-body font-semibold", !reachable && "text-ink-2")}>{c.title}</span>
                  {reachable ? (
                    <span className={cx("shrink-0 text-meta tabular-nums", fresh || n?.needs ? "font-medium text-accent-text" : "text-ink-3")}>{formatShort(c.ts)}</span>
                  ) : c.state !== "pending" ? (
                    <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />
                  ) : null}
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className={cx("min-w-0 flex-1 truncate text-ui", fresh ? "font-medium text-ink" : "text-ink-3")}>{rowNote(c)}</span>
                  {n?.needs ? (
                    <span aria-label={n.needs === 1 ? "A question for you" : `${n.needs} questions for you`} className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-stamp font-semibold text-accent-ink tabular-nums">
                      {n.needs}
                    </span>
                  ) : fresh ? (
                    // Unread: Messages' blue dot (last in the row, so the row is still named for its channel).
                    <span aria-label="New messages" className="size-2.5 shrink-0 rounded-full bg-accent" />
                  ) : null}
                </span>
              </span>
            </button>
          )
        })}
        {rows.length === 0 && (
          <p className="px-3 py-4 text-ui leading-normal text-ink-3">
            Channels you create or join show up here.
          </p>
        )}
      </nav>

      {/* Who you are, at the foot of the list as Grok keeps it: your face and name on a glass pill that
          floats over the list, the menu above it. */}
      {person && (
        <div className="scrim-bottom absolute inset-x-0 bottom-0 px-3 pt-6 pb-3 shell-mac:[background:none] shell-mac:[backdrop-filter:none] [&>*]:pointer-events-auto">
          <Menu
            side="top"
            className="w-60"
            trigger={
              <button type="button" className="glass flex h-11 max-w-full items-center gap-2.5 rounded-full pr-4 pl-1.5 transition-colors">
                <Monogram name={person.name} size={32} />
                <span className="truncate text-ui font-semibold">{person.name}</span>
              </button>
            }
          >
            <MenuNote>Key {person.pk.slice(0, 12)}</MenuNote>
            <MenuItem icon={ComputerIcon} onClick={onComputers}>Your computers</MenuItem>
            <MenuSeparator />
            <MenuItem icon={Settings01Icon} onClick={onSettings}>Settings…</MenuItem>
          </Menu>
        </div>
      )}
    </aside>
  )
}
