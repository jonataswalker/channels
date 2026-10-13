import { ArrowDown01Icon, ComputerIcon, LockIcon, Login01Icon, PencilEdit02Icon, Search01Icon, Settings01Icon, Add01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"
import { useIcons, useMemberIcons } from "@/lib/icons"
import { formatShort } from "@/lib/format"
import { useSecrets } from "@/lib/secrets"
import { setPlaceSlot } from "@/lib/place-slot"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { CoordinatorAvatar } from "./coordinator-head"
import { Icon } from "./icon"
import { IconButton, Wordmark } from "./kit"
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
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const newsOf = new Map(rows.map((c, i) => [c.room, news[i]]))
  const shown = q ? rows.filter((c) => c.title.toLowerCase().includes(q) || c.recent?.text.toLowerCase().includes(q)) : rows
  const icons = useIcons()
  useMemberIcons(rows.filter((c) => c.state === "member").map((c) => c.code))

  return (
    <aside className={cx("h-full w-full shrink-0 flex-col bg-rail md:w-[300px]", className)}>
      {/* Kiwi's mark, who you are, then new: the list's one row of chrome. */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 pr-2.5 pl-3.5">
        <CoordinatorAvatar size={26} label="Kiwi" />
        {person ? (
          <Menu
            className="w-60"
            trigger={
              <button type="button" className="flex min-w-0 items-center gap-1 rounded-ctl py-1 pr-1.5 pl-1.5 transition-colors hover:bg-wash data-popup-open:bg-wash">
                <span className="truncate text-ui font-semibold">{person.name}</span>
                <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-3" />
              </button>
            }
          >
            <MenuNote>Key {person.pk.slice(0, 12)}</MenuNote>
            <MenuItem icon={ComputerIcon} onClick={onComputers}>Your computers</MenuItem>
            <MenuSeparator />
            <MenuItem icon={Settings01Icon} onClick={onSettings}>Settings…</MenuItem>
          </Menu>
        ) : (
          <Wordmark className="pl-1 text-title" />
        )}
        <span className="flex-1" />
        <Menu
          align="end"
          className="w-52"
          trigger={
            <IconButton label="New channel or join" round className="size-8">
              <Icon icon={PencilEdit02Icon} size={17} />
            </IconButton>
          }
        >
          <MenuItem icon={Add01Icon} onClick={onNew}>New channel</MenuItem>
          <MenuItem icon={Login01Icon} onClick={onJoin}>Join with a code</MenuItem>
        </Menu>
      </header>

      {/* Search, as in Messages: a pill at the top of the list. ⌘K goes anywhere. */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-1 pb-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-ctl bg-wash-2 px-2.5 text-ink-3 focus-within:shadow-[0_0_0_3px_var(--accent-wash)]">
          <Icon icon={Search01Icon} size={14} className="shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Search"
            aria-label="Search channels"
            className="min-w-0 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
        </label>
        <IconButton label={`Go to… (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"}K)`} className="size-8" onClick={onPalette}>
          <span className="text-meta font-medium text-ink-3">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "^K"}</span>
        </IconButton>
      </div>

      <nav aria-label="Channels" className="flex-1 overflow-y-auto px-2 pt-1 pb-3">
        {shown.map((c) => {
          const selected = c.code === active
          const reachable = c.state === "member"
          const n = newsOf.get(c.room)
          // The open channel shows its own news; its row says only what needs you.
          const fresh = !selected && !!n?.fresh
          return (
            <div key={c.room}>
              <button
                type="button"
                onClick={() => onSelect(c.code)}
                aria-current={selected ? "page" : undefined}
                title={rowNote(c)}
                className={cx(
                  "group relative flex w-full items-center gap-3 rounded-card px-2.5 py-2 text-left transition-colors",
                  // The open channel is a step of tone; once its conversations show under it, the open one of those is.
                  selected ? "bg-pick [&:has(+div>nav)]:bg-transparent" : "hover:bg-wash"
                )}
              >
                {c.recent?.byCoordinator && reachable ? <CoordinatorAvatar size={40} label="The coordinator spoke last" /> : <ChannelIconTile icon={icons.get(c.room) ?? null} title={c.title} size={40} />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cx("min-w-0 flex-1 truncate text-ui", selected || fresh || n?.needs ? "font-semibold text-ink" : "font-medium", !selected && !reachable && "text-ink-2")}>{c.title}</span>
                    {n?.needs ? (
                      <span aria-label={n.needs === 1 ? "A question for you" : `${n.needs} questions for you`} className="shrink-0 rounded-full bg-accent px-1.5 text-stamp font-semibold text-accent-ink tabular-nums">
                        {n.needs}
                      </span>
                    ) : reachable ? (
                      <span className="shrink-0 text-stamp text-ink-3 tabular-nums">{formatShort(c.ts)}</span>
                    ) : c.state !== "pending" ? (
                      <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />
                    ) : null}
                  </span>
                  <span className={cx("mt-px block truncate text-meta", fresh ? "text-ink-2" : "text-ink-3")}>{rowNote(c)}</span>
                </span>
                {/* Unread: a dot at the row's edge (last in the row, so the row is still named for its channel). */}
                {fresh && !n?.needs && !selected && <span aria-label="New messages" className="absolute top-1/2 left-0.5 size-1.5 -translate-y-1/2 rounded-full bg-accent" />}
              </button>
              {/* The open channel's conversations nest here (rendered by the conversation). */}
              {selected && <div ref={setPlaceSlot} />}

            </div>
          )
        })}
        {rows.length > 0 && shown.length === 0 && <p className="px-3 py-6 text-ui text-ink-3">No channel matches “{query}”.</p>}
        {rows.length === 0 && (
          <p className="px-3 py-4 text-ui leading-normal text-ink-3">
            Channels you create or join show up here.
          </p>
        )}
      </nav>

    </aside>
  )
}
