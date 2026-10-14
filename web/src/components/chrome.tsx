// The controls on the window's one header row that belong to the list rather than to a
// conversation, as Grok places them: show or hide the list, search (the ⌘K palette: channels and
// commands), and new. On the list's header while it's open; floating over the conversation's top-left
// corner (past a Mac's traffic lights) while it's not.

import { Add01Icon, Login01Icon, Search01Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons"

import { toggleSidebar, useSidebarOpen } from "@/lib/sidebar"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { IconButton } from "./kit"
import { Menu, MenuItem } from "./ui/menu"

const mac = /Mac/.test(navigator.platform)

/** One round glass control on the header row, Grok's size. */
export const ROUND = "glass size-10 text-ink"

export function SidebarToggle({ className }: { className?: string }) {
  const open = useSidebarOpen()
  return (
    <IconButton label={`${open ? "Hide" : "Show"} the list (${mac ? "⌘B" : "Ctrl+B"})`} round className={cx(ROUND, "hidden md:inline-flex", className)} onClick={toggleSidebar}>
      <Icon icon={SidebarLeftIcon} size={19} />
    </IconButton>
  )
}

export function SearchButton({ onPalette }: { onPalette: () => void }) {
  return (
    <IconButton label={`Search (${mac ? "⌘" : "Ctrl+"}K)`} round className={ROUND} onClick={onPalette}>
      <Icon icon={Search01Icon} size={19} />
    </IconButton>
  )
}

export function NewMenu({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  return (
    <Menu
      align="end"
      className="w-52"
      trigger={
        <IconButton label="New channel or join" round className={ROUND}>
          <Icon icon={Add01Icon} size={20} />
        </IconButton>
      }
    >
      <MenuItem icon={Add01Icon} onClick={onNew}>New channel</MenuItem>
      <MenuItem icon={Login01Icon} onClick={onJoin}>Join with a code</MenuItem>
    </Menu>
  )
}

/** While the list is hidden: its controls float at the top-left of the window, past a Mac's traffic lights. */
export function ListControls({ onNew, onJoin, onPalette }: { onNew: () => void; onJoin: () => void; onPalette: () => void }) {
  const open = useSidebarOpen()
  if (open) return null
  return (
    <div className="no-drag pointer-events-none absolute top-0 left-0 z-30 hidden h-(--chrome-h) items-center gap-1.5 pl-3 md:flex shell-mac:pl-(--lights-w) [&>*]:pointer-events-auto">
      <SidebarToggle />
      <SearchButton onPalette={onPalette} />
      <NewMenu onNew={onNew} onJoin={onJoin} />
    </div>
  )
}

/** How much of the header row's left the floating list controls take while the list is hidden. */
export const LEAD_WHEN_HIDDEN = "md:pl-[150px] shell-mac:md:pl-[222px]"
