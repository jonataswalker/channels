import type { Color } from "@mc/protocol.ts"

// The colours a member can wear on their avatar (a person's pick; their agents wear it too).

/**
 * Flat and a little muted, so a channel full of agents stays calm. `ink` is the initials on the avatar's
 * gradient (white, dark on yellow); `text` is dark on every fill, for anything set on the flat colour.
 */
export const PALETTE: Record<Color, { fill: string; ink: string; text: string }> = {
  red: { fill: "#d9696b", ink: "#ffffff", text: "#1a1a1a" },
  orange: { fill: "#e0905c", ink: "#ffffff", text: "#1a1a1a" },
  yellow: { fill: "#dcb455", ink: "#1a1a1a", text: "#1a1a1a" },
  green: { fill: "#5eaa7c", ink: "#ffffff", text: "#1a1a1a" },
  teal: { fill: "#4ea9a2", ink: "#ffffff", text: "#1a1a1a" },
  blue: { fill: "#5d8dd4", ink: "#ffffff", text: "#1a1a1a" },
  indigo: { fill: "#7a7fd6", ink: "#ffffff", text: "#1a1a1a" },
  violet: { fill: "#9677d0", ink: "#ffffff", text: "#1a1a1a" },
  pink: { fill: "#d27499", ink: "#ffffff", text: "#1a1a1a" },
  brown: { fill: "#a3826a", ink: "#ffffff", text: "#1a1a1a" },
}
