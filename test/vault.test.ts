// The vault module on its own (relay/vault.ts), and what a device accepts when it
// opens one (vault.ts). The relay's /v1/me/vault routes are gone in 0.11.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { generateIdentity, sign } from "../src/identity.ts";
import { Human, type HumanAuth } from "../src/relay/human.ts";
import * as Layer from "effect/Layer";
import { buildContext, clockLayer } from "../src/relay/http.ts";
import { blobHash, onVaultHttp, Vaults, VAULT_RESET_MS, VAULT_WINDOW_MS, VAULT_WRITES, vaultSwap, type VaultRecord, type VaultStore } from "../src/relay/vault.ts";
import {
  addWrap,
  forgetSeat,
  mergeContents,
  newRecoveryCode,
  newVault,
  openVault,
  recoverySecret,
  replaceSeat,
  unlock,
  vaultKey,
  wrapsOf,
  type VaultBlob,
  type VaultContents,
  type VaultEntry,
  type VaultWriter,
  type WrapInput,
} from "../src/vault.ts";

setDefaultTimeout(30_000);

// Sign-in stand-in: the token "tok:<user>" is that user.
const human = { clientId: "test", verify: async (t: string) => (t.startsWith("tok:") ? t.slice(4) : null) } satisfies HumanAuth;
const tok = (user: string) => `tok:${user}`;
/** The vault routes on their own: this store, that sign-in, and a clock stopped at `now`. */
const vaultsAt = (store: VaultStore, now: number) => buildContext(Layer.mergeAll(Layer.succeed(Human, human), Layer.succeed(Vaults, store), clockLayer(() => now)));

const entry = (code: string, pk: string, at = 1000): VaultEntry & { sk: string } => ({ code, at, identity: { pk }, sk: `secret-of-${pk}` });
const empty: VaultContents = { channels: [], gone: {} };
const passkey = (id = "cred-1"): WrapInput => ({ kind: "passkey", label: "Touch ID", secret: crypto.getRandomValues(new Uint8Array(32)), credentialId: id });
const writerKey = async (): Promise<VaultWriter> => {
  const { pk, sk } = await generateIdentity("w");
  return { pk, sk };
};

describe("vault crypto", () => {
  test("a passkey or the recovery code opens it; nothing else does", async () => {
    const pk = passkey();
    const contents = { channels: [entry("mc2-a", "pkA")], gone: {} };
    const { key, blob } = await newVault("alice", contents, pk);
    expect(await unlock(blob, "alice", pk.secret, "cred-1")).toBe(key);
    expect(await unlock(blob, "alice", crypto.getRandomValues(new Uint8Array(32)), "cred-1")).toBeNull();
    expect(await unlock(blob, "alice", pk.secret, "cred-other")).toBeNull();

    const code = newRecoveryCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    const opened = await openVault(blob, "alice", key, 1);
    const two = await addWrap(blob, "alice", key, opened, 2, { kind: "recovery", label: "Recovery code", secret: recoverySecret(code)! });
    expect(await unlock(two, "alice", recoverySecret(code.toLowerCase().replace(/-/g, ""))!)).toBe(key);
    const reopened = await openVault(two, "alice", await vaultKey(key), 2);
    expect(reopened.channels).toEqual(contents.channels);
    expect(reopened.wraps.map((w) => [w.kind, w.label, w.credentialId])).toEqual([["passkey", "Touch ID", "cred-1"], ["recovery", "Recovery code", undefined]]);
    expect(reopened.writer).toEqual(opened.writer);
    expect(JSON.stringify(wrapsOf(two))).not.toContain("box");
    expect(recoverySecret("not a code")).toBeNull();
  });

  test("the relay sees no key material: only ciphertext and public wrap labels", async () => {
    const e = entry("mc2-a", "pkA");
    const { key, blob, writer } = await newVault("alice", { channels: [e], gone: {} }, passkey());
    for (const s of [key, writer.sk, e.sk, e.identity.pk, e.code]) expect(blob).not.toContain(s);
  });

  test("refuses another person's vault, another version, and moved, relabelled or stripped wraps", async () => {
    const pk = passkey();
    const { key, blob } = await newVault("alice", empty, pk);
    await expect(openVault(blob, "mallory", key, 1)).rejects.toThrow();
    await expect(openVault(blob, "alice", key, 2)).rejects.toThrow();
    expect(await unlock(blob, "mallory", pk.secret, "cred-1")).toBeNull();

    const b = JSON.parse(blob) as VaultBlob;
    const edit = (f: (w: VaultBlob["wraps"][number]) => object) => JSON.stringify({ ...b, wraps: b.wraps.map((w) => ({ ...w, ...f(w) })) });
    // A box under another id or kind no longer opens.
    expect(await unlock(edit(() => ({ kind: "recovery" })), "alice", pk.secret)).toBeNull();
    expect(await unlock(edit(() => ({ id: crypto.randomUUID() })), "alice", pk.secret, "cred-1")).toBeNull();
    // Relabelling a passkey, or moving it to another credential, shows as tampering once open.
    await expect(openVault(edit(() => ({ label: "Old phone (remove me)" })), "alice", key, 1)).rejects.toThrow(/passkeys were changed/);
    await expect(openVault(edit(() => ({ credentialId: "cred-relay" })), "alice", key, 1)).rejects.toThrow(/passkeys were changed/);
    // Adding a passkey of its own, or stripping one.
    await expect(openVault(JSON.stringify({ ...b, wraps: [...b.wraps, { ...b.wraps[0]!, id: crypto.randomUUID() }] }), "alice", key, 1)).rejects.toThrow(/passkeys were changed/);
    await expect(openVault(JSON.stringify({ ...b, wraps: [] }), "alice", key, 1)).rejects.toThrow(/passkeys were changed/);
  });

  test("a device refuses a vault older than one it already opened", async () => {
    const { key, blob } = await newVault("alice", empty, passkey());
    await expect(openVault(blob, "alice", key, 1, 3)).rejects.toThrow(/rolling your vault back/);
  });

  test("tombstones beat older entries; a later rejoin beats the tombstone", () => {
    const old = entry("mc2-a", "pkA", 1000);
    const left = forgetSeat({ channels: [old], gone: {} }, old, 2000);
    expect(mergeContents(left, { channels: [old], gone: {} }).contents.channels).toEqual([]);
    const back = entry("mc2-a", "pkA", 3000);
    expect(mergeContents(left, { channels: [back], gone: {} }).contents.channels).toEqual([back]);
  });

  test("one join code never keeps two live keys; replaceSeat moves it to the new one", () => {
    const a = entry("mc2-a", "pkA", 1000);
    const b = entry("mc2-a", "pkB", 2000);
    const both = mergeContents({ channels: [a], gone: {} }, { channels: [b], gone: {} });
    expect(both.contents.channels).toEqual([a]);
    expect(both.conflicts).toEqual(["mc2-a"]);
    const reclaimed = replaceSeat({ channels: [a], gone: {} }, b, "pkA", 2000);
    expect(reclaimed.channels).toEqual([b]);
    expect(mergeContents(reclaimed, { channels: [a], gone: {} })).toEqual({ contents: reclaimed, conflicts: [] });
  });
});
