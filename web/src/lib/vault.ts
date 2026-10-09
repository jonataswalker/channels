import { decodeJoinCode } from "@mc/crypto.ts"
import {
  PRF_SALT,
  VaultError,
  addWrap,
  fetchVault,
  forgetSeat,
  newRecoveryCode,
  newVault,
  openVault,
  putVault,
  recoverySecret,
  rotateVault,
  seat,
  syncVault,
  unlock,
  vaultKey,
  wrapsOf,
  type VaultContents,
  type VaultKey,
  type WrapInput,
} from "@mc/vault.ts"
import { useSyncExternalStore } from "react"

import { CHANGED, allMembers, loadMember, saveMember, type StoredMember } from "./channel"
import { createPasskey, usePasskey } from "./passkey"
import { forgetVaultKey, keepVaultKey, loadVaultKey } from "./vault-store"

// Your channels, kept for you at the relay where only your passkeys can open
// them. This browser pulls in every seat it doesn't have when the vault opens,
// and saves every seat it gains or leaves as it happens. The relay only ever
// holds ciphertext; the vault key stays in this browser (non-extractable) and
// in memory right after a touch, for adding or removing passkeys.

export type Wrap = ReturnType<typeof wrapsOf>[number]

export type VaultState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "locked"; wraps: Wrap[] }
  | { kind: "open"; wraps: Wrap[] }
  | { kind: "error"; message: string }

interface Session {
  user: string
  email: string
  name: string
  token: () => Promise<string | null>
}

let state: VaultState = { kind: "off" }
let session: Session | null = null
let key: VaultKey | null = null
/** The raw key, only between a touch and the page closing: adding a passkey needs it. */
let rawKey: string | null = null
/** The seats this browser last agreed with the vault on, to tell what changed since. */
let synced = new Set<string>()
const listeners = new Set<() => void>()

function set(next: VaultState) {
  state = next
  for (const l of listeners) l()
}

export function useVault(): VaultState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

// The highest version this browser has opened, so a relay can't quietly hand back an older vault.
const SEEN = (user: string) => `mc.vault.seen.${user}`
const seen = (user: string) => Number(localStorage.getItem(SEEN(user)) ?? 0)
const saw = (user: string, v: number) => v > seen(user) && localStorage.setItem(SEEN(user), String(v))

async function token(): Promise<string> {
  const t = await session?.token()
  if (!t) throw new VaultError("sign in again to reach your vault")
  return t
}

function wellFormed(m: StoredMember): boolean {
  try {
    return typeof m.identity?.pk === "string" && typeof m.identity.sk === "string" && typeof m.access?.ownerPk === "string" && decodeJoinCode(m.code).roomId === m.access.roomId
  } catch {
    return false
  }
}

/** A name for this browser's passkey, so the list says which one is which. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "this device"
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser"
  return `${browser} on ${os}`
}

/** Bring in every seat the vault has and this browser doesn't. A seat held here under another key stays as it is. */
function take(c: VaultContents<StoredMember>): number {
  let added = 0
  for (const m of c.channels) {
    if (!wellFormed(m) || loadMember(m.code)) continue
    try {
      saveMember({ ...m, at: m.at || Date.now() })
      added++
    } catch {}
  }
  synced = new Set(c.channels.map(seat))
  return added
}

/** Open the vault with a key: pull, then push whatever this browser had that the vault didn't. */
async function opened(blob: string, version: number, k: VaultKey): Promise<number> {
  const s = session!
  const c = await openVault<StoredMember>(blob, s.user, k, version, seen(s.user))
  saw(s.user, version)
  key = k
  const added = take(c)
  set({ kind: "open", wraps: wrapsOf(blob) })
  await push()
  return added
}

/** Start (or stop) the vault for whoever is signed in. */
export async function startVault(next: Session | null): Promise<void> {
  if (next?.user === session?.user) return
  session = next
  key = rawKey = null
  synced = new Set()
  if (!next) return set({ kind: "off" })
  set({ kind: "loading" })
  try {
    const got = await fetchVault(location.origin, await token())
    if (!got) return set({ kind: "none" })
    const stored = await loadVaultKey(next.user)
    if (stored) {
      try {
        await opened(got.blob, got.version, stored)
        return
      } catch {
        // The vault was rotated elsewhere (a passkey removed): this browser's key no longer opens it.
        await forgetVaultKey(next.user)
      }
    }
    set({ kind: "locked", wraps: wrapsOf(got.blob) })
  } catch (err) {
    set({ kind: "error", message: err instanceof Error ? err.message : String(err) })
  }
}

/** First time: make a passkey, put every channel this browser has in a new vault. Returns the recovery code to show once. */
export async function setUpVault(): Promise<string> {
  const s = session!
  const pk = await createPasskey({ id: s.user, name: s.email || s.name, displayName: s.name }, PRF_SALT)
  const contents: VaultContents<StoredMember> = { channels: allMembers(), gone: {} }
  const made = await newVault(s.user, contents, { kind: "passkey", label: deviceLabel(), secret: pk.secret, credentialId: pk.credentialId })
  const code = newRecoveryCode()
  const blob = await addWrap(made.blob, s.user, made.key, 1, contents, { kind: "recovery", label: "Recovery code", secret: recoverySecret(code)! })
  const r = await putVault(location.origin, await token(), 0, blob)
  if ("conflict" in r) throw new VaultError("another device just set up your vault. Reload to unlock it.")
  saw(s.user, r.version)
  await settle(made.key, blob)
  synced = new Set(contents.channels.map(seat))
  return code
}

async function settle(raw: string, blob: string) {
  rawKey = raw
  key = await vaultKey(raw)
  await keepVaultKey(session!.user, key)
  set({ kind: "open", wraps: wrapsOf(blob) })
}

async function unlockWith(secret: Uint8Array, credentialId?: string): Promise<number> {
  const s = session!
  const got = await fetchVault(location.origin, await token())
  if (!got) throw new VaultError("there’s no vault yet")
  const raw = await unlock(got.blob, s.user, secret, credentialId)
  if (!raw) throw new VaultError(credentialId ? "that passkey doesn’t open this vault" : "that recovery code doesn’t open this vault")
  rawKey = raw
  const k = await vaultKey(raw)
  await keepVaultKey(s.user, k)
  return opened(got.blob, got.version, k)
}

/** Touch any of the vault's passkeys. Returns how many channels came in. */
export async function unlockWithPasskey(): Promise<number> {
  const ids = state.kind === "locked" || state.kind === "open" ? state.wraps.flatMap((w) => (w.credentialId ? [w.credentialId] : [])) : []
  const pk = await usePasskey(PRF_SALT, ids)
  return unlockWith(pk.secret, pk.credentialId)
}

export async function unlockWithCode(code: string): Promise<number> {
  const secret = recoverySecret(code)
  if (!secret) throw new VaultError("that isn’t a recovery code: it’s 32 letters and digits")
  return unlockWith(secret)
}

/** Save what changed in this browser since the vault last saw it: seats gained, seats left. */
async function push(): Promise<void> {
  if (!key || !session) return
  const mine = new Map(allMembers().map((m) => [seat(m), m]))
  const added = [...mine.keys()].filter((s) => !synced.has(s))
  const left = [...synced].filter((s) => !mine.has(s))
  if (!added.length && !left.length) return
  const s = session
  const r = await syncVault<StoredMember>(
    location.origin,
    await token(),
    s.user,
    key,
    (c) => {
      let next = c
      for (const k of left) {
        const [code, pk] = k.split(" ")
        next = forgetSeat(next, { code: code!, identity: { pk: pk! } })
      }
      const have = new Set(next.channels.map(seat))
      return { ...next, channels: [...next.channels, ...added.filter((k) => !have.has(k)).map((k) => mine.get(k)!)] }
    },
    seen(s.user)
  )
  saw(s.user, r.version)
  synced = new Set(r.contents.channels.map(seat))
}

let timer: ReturnType<typeof setTimeout> | undefined
window.addEventListener(CHANGED, () => {
  if (state.kind !== "open") return
  clearTimeout(timer)
  timer = setTimeout(() => void push().catch((err) => console.warn("vault: not saved", err)), 400)
})

/** Adding or removing a passkey needs the raw key, which only a fresh touch gives. */
async function freshKey(): Promise<{ raw: string; keep: WrapInput }> {
  const ids = state.kind === "open" ? state.wraps.flatMap((w) => (w.credentialId ? [w.credentialId] : [])) : []
  const pk = await usePasskey(PRF_SALT, ids)
  const got = await fetchVault(location.origin, await token())
  const raw = got && (await unlock(got.blob, session!.user, pk.secret, pk.credentialId))
  if (!raw) throw new VaultError("that passkey doesn’t open this vault")
  const label = (state.kind === "open" && state.wraps.find((w) => w.credentialId === pk.credentialId)?.label) || deviceLabel()
  return { raw, keep: { kind: "passkey", label, secret: pk.secret, credentialId: pk.credentialId } }
}

/** Another passkey that opens the same vault: a phone, a security key. */
export async function addPasskey(): Promise<void> {
  const s = session!
  const raw = rawKey ?? (await freshKey()).raw
  const exclude = state.kind === "open" ? state.wraps.flatMap((w) => (w.credentialId ? [w.credentialId] : [])) : []
  const pk = await createPasskey({ id: s.user, name: s.email || s.name, displayName: s.name }, PRF_SALT, exclude)
  const got = await fetchVault(location.origin, await token())
  if (!got) throw new VaultError("there’s no vault yet")
  const c = await openVault<StoredMember>(got.blob, s.user, raw, got.version, seen(s.user))
  const blob = await addWrap(got.blob, s.user, raw, got.version + 1, c, { kind: "passkey", label: deviceLabel(), secret: pk.secret, credentialId: pk.credentialId })
  const r = await putVault(location.origin, await token(), got.version, blob)
  if ("conflict" in r) throw new VaultError("your vault changed on another device; try again")
  saw(s.user, r.version)
  rawKey = raw
  set({ kind: "open", wraps: wrapsOf(blob) })
}

/**
 * Remove a passkey for real: a new vault key, opened by the passkey touched
 * here and a new recovery code. Other passkeys stop working until they're
 * added again. Returns the new recovery code.
 */
export async function removePasskey(w: Wrap): Promise<string> {
  const s = session!
  const { keep } = await freshKey()
  if (keep.credentialId === w.credentialId) throw new VaultError("use a different passkey than the one you’re removing")
  const got = await fetchVault(location.origin, await token())
  if (!got) throw new VaultError("there’s no vault yet")
  const c = await openVault<StoredMember>(got.blob, s.user, key!, got.version, seen(s.user))
  const next = await rotateVault(s.user, got.version + 1, c, keep)
  const r = await putVault(location.origin, await token(), got.version, next.blob)
  if ("conflict" in r) throw new VaultError("your vault changed on another device; try again")
  saw(s.user, r.version)
  await settle(next.key, next.blob)
  return next.recoveryCode
}
