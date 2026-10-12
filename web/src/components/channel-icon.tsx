// A channel's avatar: emoji or a small image, or the title's first letter when there is none, on a
// round grey tile like a Messages contact. The tile is always the same size, so a row doesn't jump
// when an icon arrives.

import type { ChannelIcon } from "@mc/protocol.ts"
import { cx } from "@/lib/utils"

const SIZE: Record<number, string> = { 20: "size-5 text-meta", 28: "size-7 text-ui", 32: "size-8 text-ui", 40: "size-10 text-title", 64: "size-16 text-display" }

export function ChannelIconTile({ icon, title, size }: { icon: ChannelIcon | null; title: string; size: 20 | 28 | 32 | 40 | 64 }) {
  const box = cx("rounded-full", SIZE[size])
  if (icon?.kind === "image") {
    return (
      <span className={cx(box, "block shrink-0 overflow-hidden bg-wash-2")}>
        <img src={`data:${icon.mime};base64,${icon.data}`} alt="" className="size-full object-cover" />
      </span>
    )
  }
  const emoji = icon?.kind === "emoji"
  return (
    <span
      aria-hidden
      className={cx(
        box,
        "flex shrink-0 items-center justify-center font-semibold select-none",
        emoji ? "bg-wash-2" : "bg-[linear-gradient(180deg,var(--avatar-top),var(--avatar-bottom))] text-white"
      )}
    >
      {emoji ? icon.emoji : letterOf(title)}
    </span>
  )
}

function letterOf(title: string): string {
  const ch = [...title.trim()][0]
  return ch ? ch.toUpperCase() : "?"
}
