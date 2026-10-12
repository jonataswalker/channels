import { Add01Icon, ArrowDown01Icon, ChartColumnIcon, ComputerIcon, Key01Icon, LockIcon, Login01Icon, Logout01Icon, Search01Icon, Settings01Icon, SmartPhone01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import { displayName, useAuth } from "@/lib/auth"
import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"
import { useIcons, useMemberIcons } from "@/lib/icons"
import { atChannelLimit, type MyUsage } from "@/lib/usage"
import { formatShort } from "@/lib/format"
import { lockVault, useVault } from "@/lib/vault"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { Icon } from "./icon"
import { Button, IconButton, Monogram, Wordmark } from "./kit"
import { Menu, MenuItem, MenuNote, MenuSeparator } from "./ui/menu"
import { usageLine } from "./usage"
import { setRoomsSlot } from "./rooms"
import { offerVault, VaultCard } from "./vault"

/** What a row says on hover: what was said last, or why this browser can't open it yet. */
function rowNote(c: ChannelRow): string {
  if (c.state === "pending") return "Waiting for the owner to let you in"
  if (c.state === "elsewhere") return "On another device of yours"
  if (c.state === "agents") return c.agents === 1 ? "One of your agents is here" : `${c.agents} of your agents are here`
  if (c.recent?.text) return c.recent.from ? `${c.recent.from}: ${c.recent.text}` : c.recent.text
  return "No messages yet"
}

/** Your channels: the ones this browser is in, plus (signed in) every one you own, joined, or have agents in. */
export function Sidebar({
  rows,
  news,
  active,
  onSelect,
  onNew,
  onJoin,
  onComputers,
  onAddDevice,
  onPasskeys,
  onSettings,
  usage,
  onUsage,
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
  onAddDevice: () => void
  onPasskeys: () => void
  onSettings: () => void
  usage: MyUsage | null
  onUsage: () => void
  onPalette: () => void
  className?: string
}) {
  const auth = useAuth()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(true)
  const vault = useVault()
  const q = query.trim().toLowerCase()
  const newsOf = new Map(rows.map((c, i) => [c.room, news[i]]))
  const shown = q ? rows.filter((c) => c.title.toLowerCase().includes(q) || c.recent?.text.toLowerCase().includes(q)) : rows
  const icons = useIcons()
  useMemberIcons(rows.filter((c) => c.state === "member").map((c) => c.code))

  return (
    <aside className={cx("h-full w-full shrink-0 flex-col bg-rail md:w-[260px]", className)}>
      {/* Who you are, then search and new: the rail's one row of chrome. */}
      <header className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-3">
        {auth.status === "signed-in" ? (
          <Menu
            className="w-60"
            trigger={
              <button type="button" className="flex min-w-0 items-center gap-2 rounded-row py-1 pr-1.5 pl-1 transition-colors hover:bg-wash data-popup-open:bg-wash">
                <Monogram name={displayName(auth.user)} size={20} />
                <span className="truncate text-ui font-semibold">{displayName(auth.user)}</span>
                <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-3" />
              </button>
            }
          >
            <MenuNote>{auth.user?.email}</MenuNote>
            <MenuItem icon={ComputerIcon} onClick={onComputers}>Your computers</MenuItem>
            {vault.kind === "open" && <MenuItem icon={Key01Icon} onClick={onPasskeys}>Passkeys</MenuItem>}
            {vault.kind === "none" && <MenuItem icon={Key01Icon} onClick={offerVault}>Save channels to a passkey…</MenuItem>}
            <MenuItem icon={SmartPhone01Icon} onClick={onAddDevice}>Add a device</MenuItem>
            {usage && <MenuItem icon={ChartColumnIcon} onClick={onUsage}>Usage</MenuItem>}
            <MenuItem icon={Settings01Icon} onClick={onSettings}>Settings…</MenuItem>
            <MenuSeparator />
            <MenuItem icon={Logout01Icon} onClick={() => void lockVault().finally(auth.signOut)}>Sign out</MenuItem>
          </Menu>
        ) : (
          <Wordmark className="pl-1 text-title" />
        )}
        <span className="flex-1" />
        {(auth.status !== "signed-out" || rows.length > 0) && (
          <>
        <IconButton label={`Go to… (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"}K)`} className="size-7" onClick={onPalette}>
          <Icon icon={Search01Icon} size={15} />
        </IconButton>
        <Menu
          align="end"
          className="w-52"
          trigger={
            <IconButton label="New channel or join" className="size-7">
              <Icon icon={Add01Icon} size={16} />
            </IconButton>
          }
        >
          <MenuItem icon={Add01Icon} onClick={onNew}>New channel</MenuItem>
          <MenuItem icon={Login01Icon} onClick={onJoin}>Join with a code</MenuItem>
        </Menu>
          </>
        )}
      </header>

      {rows.length > 6 && (
        <label className="mx-3 mt-1 mb-1 flex h-8 items-center gap-2 rounded-ctl bg-wash px-2.5 text-ink-3">
          <Icon icon={Search01Icon} size={14} className="shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a channel"
            className="min-w-0 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
        </label>
      )}

      <nav aria-label="Channels" className="flex-1 overflow-y-auto px-2 pt-2 pb-3">
        {rows.length > 0 && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mb-0.5 flex h-7 w-full items-center gap-1 rounded-row px-2 text-left text-meta font-medium text-ink-3 transition-colors hover:text-ink-2">
          Channels
          <Icon icon={ArrowDown01Icon} size={12} className={cx("transition-transform", !open && "-rotate-90")} />
        </button>
        )}
        {open &&
          shown.map((c) => {
            const selected = c.code === active
            const reachable = c.state === "member"
            const n = newsOf.get(c.room)
            // The open channel's own rooms say where its news is; its row says only what needs you.
            const fresh = !selected && !!n?.fresh
            return (
              <div key={c.room} className="[&:has(li[data-room])>button]:bg-transparent">
                <button
                  type="button"
                  onClick={() => onSelect(c.code)}
                  aria-current={selected ? "page" : undefined}
                  title={rowNote(c)}
                  className={cx(
                    "flex h-8 w-full items-center gap-2 rounded-row px-2 text-left text-ui transition-colors",
                    selected ? "bg-pick font-medium text-ink" : fresh || n?.needs ? "font-medium text-ink hover:bg-wash" : "text-ink-2 hover:bg-wash hover:text-ink"
                  )}
                >
                  <ChannelIconTile icon={icons.get(c.room) ?? null} title={c.title} size={20} />
                  <span className={cx("min-w-0 flex-1 truncate", !reachable && !fresh && "text-ink-3")}>{c.title}</span>
                  {n?.needs ? (
                    <span aria-label={n.needs === 1 ? "A question for you" : `${n.needs} questions for you`} className="shrink-0 rounded-full bg-ink px-1.5 text-meta font-semibold text-canvas tabular-nums">
                      {n.needs}
                    </span>
                  ) : fresh ? (
                    <span aria-label="New messages" className="size-1.5 shrink-0 rounded-full bg-ink" />
                  ) : reachable ? (
                    <span className="shrink-0 text-meta text-ink-3 tabular-nums">{formatShort(c.ts)}</span>
                  ) : c.state !== "pending" ? (
                    <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />
                  ) : null}
                </button>
                {/* The open channel's rooms nest here (rendered by the conversation). */}
                {selected && <div ref={setRoomsSlot} />}
              </div>
            )
          })}
        {rows.length > 0 && shown.length === 0 && <p className="px-3 py-6 text-ui text-ink-3">No channel matches “{query}”.</p>}
        {rows.length === 0 && (
          <p className="px-3 py-4 text-ui leading-normal text-ink-3">
            {auth.status === "signed-out" ? "Sign in to see your channels from any device." : "Channels you create or join show up here."}
          </p>
        )}
      </nav>

      {auth.status === "signed-in" && <VaultCard />}
      {usage && usageLine(usage) && (
        <button type="button" onClick={onUsage} className="mx-2 mb-2 shrink-0 rounded-ctl px-2.5 py-2 text-left text-meta text-ink-3 transition-colors hover:bg-wash">
          <span className={cx("tabular-nums", atChannelLimit(usage) && "font-medium text-ink-2")}>{usageLine(usage)}</span>
          {atChannelLimit(usage) && <span> · close one to create another</span>}
        </button>
      )}
      {/* On a wide screen the welcome page carries Sign in; on a phone the rail is the whole screen, so it's here too. */}
      {auth.status === "signed-out" && (
        <div className={cx("shrink-0 p-3", !active && !auth.expired && "md:hidden")}>
          {auth.expired && <p className="mb-2 px-1 text-ui leading-normal text-ink-2">Your sign-in expired. Sign in again to sync your channels and approve requests.</p>}
          <Button className="w-full" onClick={auth.signIn}>
            Sign in
          </Button>
        </div>
      )}
    </aside>
  )
}
