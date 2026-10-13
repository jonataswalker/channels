// Pairing codes (pair.ts): no key is ever copied, and a code the relay could grind doesn't
// exist (both sides fix their nonce before seeing the other's). The room's pairing slots are
// gone in 0.11 (pairing moved to the mailbox); what remains here is the code math both sides use.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { generateIdentity } from "../src/identity.ts";
import { browserCode, codeFor, pairCode, pairCommit, pairNonce, sealedTo, type Chosen, type PairRow } from "../src/pair.ts";

setDefaultTimeout(60_000);

describe("pairing codes", () => {
  test("a reveal that doesn't match the commit gives no code", async () => {
    const room = "0123456789abcdef0123456789abcdef";
    const t = await generateIdentity("pair");
    const nt = pairNonce();
    const nb = pairNonce();
    const p: PairRow = { id: "x", pk: t.pk, xpk: t.xpk!, commit: await pairCommit(room, t.pk, t.xpk!, nt), wnonce: nb, tnonce: nt, ts: 0 };
    expect(await codeFor(room, p)).toBe(await pairCode(room, t.pk, t.xpk!, nt, nb));
    expect(await codeFor(room, { ...p, tnonce: pairNonce() })).toBeNull();
    // A relay that swaps in its own key after the browser's nonce is out can't keep the terminal's commit.
    const evil = await generateIdentity("evil");
    expect(await codeFor(room, { ...p, xpk: evil.xpk! })).toBeNull();
    expect(await codeFor(room, { ...p, tnonce: null })).toBeNull();
  });
});

describe("the browser trusts only what it fixed when the person chose the terminal", () => {
  test("a relay that swaps the key or commit, or keeps another nonce, gets no code", async () => {
    const room = "0123456789abcdef0123456789abcdef";
    const t = await generateIdentity("pair");
    const nt = pairNonce();
    const listed: PairRow = { id: "x", pk: t.pk, xpk: t.xpk!, commit: await pairCommit(room, t.pk, t.xpk!, nt), wnonce: null, tnonce: null, ts: 0 };
    const c: Chosen = { nonce: pairNonce(), pk: listed.pk, xpk: listed.xpk, commit: listed.commit, kept: null };
    c.kept = c.nonce;
    const revealed = { ...listed, wnonce: c.nonce, tnonce: nt };
    const good = await browserCode(room, c, revealed);
    expect(good).toBe(await pairCode(room, t.pk, t.xpk!, nt, c.nonce));
    // The relay lists a nonce it ground instead of the browser's: the browser still uses its own.
    expect(await browserCode(room, c, { ...revealed, wnonce: pairNonce() })).toBe(good);
    // It swaps in its own key and a commit for it after the person chose: nothing.
    const evil = await generateIdentity("evil");
    const ne = pairNonce();
    expect(await browserCode(room, c, { ...revealed, pk: evil.pk, xpk: evil.xpk!, commit: await pairCommit(room, evil.pk, evil.xpk!, ne), tnonce: ne })).toBeNull();
    // Another browser (or an agent) opened the row first: this one shows nothing.
    expect(await browserCode(room, { ...c, kept: pairNonce() }, revealed)).toBeNull();
    // And the seat goes to the key the browser fixed, whatever the row says now.
    expect(sealedTo(c, { ...revealed, xpk: evil.xpk! }).xpk).toBe(t.xpk!);
  });
});
