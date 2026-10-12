// A channel's icon: emoji or a small image, or the title's first letter when there is none.
// The tile is always the same size, so a row doesn't jump when an icon arrives.

import type { ChannelIcon } from "@mc/protocol.ts"
import { cx } from "@/lib/utils"

export function ChannelIconTile({ icon, title, size }: { icon: ChannelIcon | null; title: string; size: 20 | 28 }) {
  const box = size === 28 ? "size-7 rounded-ctl" : "size-5 rounded-row"
  if (icon?.kind === "image") {
    return (
      <span className={cx(box, "block shrink-0 overflow-hidden bg-wash-2")}>
        <img src={`data:${icon.mime};base64,${icon.data}`} alt="" className="size-full object-cover" />
      </span>
    )
  }
  const glyph = icon?.kind === "emoji" ? icon.emoji : letterOf(title)
  return (
    <span aria-hidden className={cx(box, "flex shrink-0 items-center justify-center bg-wash-2 font-medium text-ink-2", size === 28 ? "text-title" : "text-meta")}>
      {glyph}
    </span>
  )
}

function letterOf(title: string): string {
  const ch = [...title.trim()][0]
  return ch ? ch.toUpperCase() : "?"
}
