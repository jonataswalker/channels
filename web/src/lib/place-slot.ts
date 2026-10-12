// The open channel's places (Main, its tasks, its direct threads) sit under its row in the channel
// list, as a channel's conversations do. The list renders an empty slot there; the open conversation,
// which knows the places, renders into it through a portal.

import { useSyncExternalStore } from "react"

let slot: HTMLElement | null = null
const listeners = new Set<() => void>()

export function setPlaceSlot(el: HTMLElement | null): void {
  if (el === slot) return
  slot = el
  for (const l of listeners) l()
}

export function usePlaceSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => slot
  )
}
