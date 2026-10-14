// Opens every menu, popover and dialog of the dashboard once, on the production
// build, and fails on any page error. Base UI throws on a misplaced part (a group
// label outside its group, say) only when that part renders, so typecheck can't
// see it: b085ae8 was one, and it blanked the page in prod.
//
// Beyond menus, it walks the flows only real state reaches: a passkey set up and
// unlocked on Chromium's virtual authenticator, the invite preview a join link
// shows someone who isn't in yet, a reload that paints the sent message from
// the sealed cache and asks the relay only for newer ones, a computer linked
// through its #link page by `kiwi setup`, that computer's agent asking to join
// and approved, and the task it adds opened from the board.
//
//   bun run web:build && bun scripts/smoke-ui.ts
//
// Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium
// (or set SMOKE_CHROMIUM to a Chrome binary).

import { spawn } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium, type Locator, type Page } from "playwright-core"

const ROOT = resolve(import.meta.dir, "..")
const PORT = 20000 + Math.floor(Math.random() * 20000)
// localhost, not 127.0.0.1: WebAuthn refuses an IP address as the passkey's site.
const BASE = `http://localhost:${PORT}/`
const data = mkdtempSync(join(tmpdir(), "kiwi-smoke-"))

// A computer of the smoke person's, for an agent to join from: its own kiwi home, no Claude Code
// settings to touch, and no browser to open (kiwi setup opens the link page; the test visits it).
const cli = join(data, "cli")
mkdirSync(join(cli, "bin"), { recursive: true })
mkdirSync(join(data, "relay"))
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n")
  chmodSync(join(cli, "bin", opener), 0o755)
}
/** A person's own terminal: none of the variables an agent's harness sets (the smoke may itself run inside one). */
const PERSON = { CLAUDECODE: "", CODEX_THREAD_ID: "", GEMINI_CLI: "", CURSOR_AGENT: "", GROK_SESSION_ID: "" }
const cliEnv = { ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` }
/** Run kiwi as that computer; resolves with its output once it exits, and lets you watch it meanwhile. */
function kiwi(args: string[], watch?: (out: string) => void): Promise<string> {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv })
  let out = ""
  const on = (d: Buffer) => ((out += d), watch?.(out))
  p.stdout.on("data", on)
  p.stderr.on("data", on)
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args[0]} exited ${code}: ${out.trim().split("\n").pop()}`)))))
}

const relay = spawn("bun", ["src/relay/bun.ts", "--hostname", "127.0.0.1", "--port", String(PORT), "--data", join(data, "relay"), "--dev-sign-in"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] })
await new Promise<void>((ok, fail) => {
  let out = ""
  relay.stdout!.on("data", (d) => {
    out += d
    if (out.includes("dashboard: not served")) fail(new Error("web/dist is missing: run bun run web:build first"))
    else if (out.includes("dashboard:")) ok()
  })
  relay.on("exit", (code) => fail(new Error(`relay exited (${code})`)))
})

const errors: string[] = []
let at = "start"
// The relay is a child process: if the browser can't start, stop it too, or this never exits.
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }).catch((e) => {
  relay.kill()
  rmSync(data, { recursive: true, force: true })
  throw e
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on("pageerror", (e) => errors.push(`${at}: ${e.message}`))
page.on("console", (m) => {
  // A refused request is the app's business (and logged by the browser); a thrown render is not.
  if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${at}: console: ${m.text()}`)
})

const popup = (p: Page) => p.locator("[role=menu], [role=dialog], [role=alertdialog]").last()

/** Open something, check its popup rendered, close it with Escape. */
async function opens(name: string, open: () => Promise<void>) {
  at = name
  await open()
  await popup(page).waitFor({ state: "visible", timeout: 5000 })
  // Escape until nothing's open: a dialog opened from a menu item can still be mounting when the first one lands.
  const open_ = page.locator("[role=menu], [role=dialog], [role=alertdialog]")
  for (let i = 0; i < 3 && (await open_.count()) > 0; i++) {
    await page.keyboard.press("Escape")
    await open_.first().waitFor({ state: "hidden", timeout: 2000 }).catch(() => {})
  }
  if ((await open_.count()) > 0) throw new Error(`${name} didn't close with Escape`)
  await page.waitForTimeout(150)
  console.log(`ok  ${name}`)
}

/** Every item in a menu that opens something else ("Rename…", "Your computers"), each once. */
async function eachItem(name: string, trigger: Locator, only: (label: string) => boolean) {
  await trigger.click()
  await page.getByRole("menu").waitFor()
  const labels = (await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((s) => s.trim()).filter(only)
  await page.keyboard.press("Escape")
  for (const label of labels)
    await opens(`${name} → ${label}`, async () => {
      await trigger.click()
      await page.getByRole("menu").waitFor()
      await page.getByRole("menu").getByRole("menuitem", { name: label, exact: true }).click()
    })
}

try {
  await page.goto(BASE)
  await opens("Join with a code (signed out)", () => page.getByRole("main").getByRole("button", { name: "Join with a code" }).click())

  at = "dev sign-in"
  await page.getByRole("button", { name: "Sign in" }).first().click()
  await page.getByRole("textbox", { name: "Name" }).fill("smoke")
  await page.getByRole("dialog").getByRole("button", { name: "Sign in" }).click()
  const account = page.getByRole("complementary").getByRole("button", { name: /smoke/ })
  await account.waitFor()

  // Passkeys on Chromium's virtual authenticator, PRF on: set one up and save the recovery code.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  } as never)
  // The vault waits until an agent has worked here (T1389): not offered on a fresh sign-in.
  at = "no passkey offer before an agent works"
  if (await page.getByRole("button", { name: "Save channels to a passkey" }).isVisible()) throw new Error("the passkey offer showed before any agent worked")
  await page.evaluate(() => {
    localStorage.setItem("mc.agent-worked", "1")
    window.dispatchEvent(new Event("mc:agent-worked"))
  })
  console.log(`ok  ${at}`)
  at = "Set up passkey"
  await page.getByRole("button", { name: "Save channels to a passkey" }).click()
  const saving = page.getByRole("dialog").filter({ hasText: "Save your recovery code" })
  await saving.waitFor()
  await saving.getByRole("checkbox").check()
  await saving.getByRole("button", { name: "Done" }).click()
  await saving.waitFor({ state: "hidden" })
  console.log(`ok  ${at}`)

  await opens("Account menu", () => account.click())
  await eachItem("Account menu", account, (l) => l !== "Sign out")

  // Sign out and back in: the vault is locked, and opens with the passkey.
  at = "sign out and back in"
  await account.click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await page.getByRole("button", { name: "Sign in" }).first().click()
  await page.getByRole("textbox", { name: "Name" }).fill("smoke")
  await page.getByRole("dialog").getByRole("button", { name: "Sign in" }).click()
  await opens("Use recovery code", () => page.getByRole("button", { name: "Use recovery code" }).click())
  at = "Use passkey"
  await page.getByRole("button", { name: "Use passkey" }).click()
  await page.getByRole("button", { name: "Use passkey" }).waitFor({ state: "hidden" })
  console.log(`ok  ${at}`)
  // Settings: dark, and the largest text, so every menu and dialog below opens zoomed in too.
  at = "Settings → Dark, Larger"
  await account.click()
  await page.getByRole("menuitem", { name: "Settings…" }).click()
  const settings = page.getByRole("dialog").filter({ hasText: "Text size" })
  await settings.getByRole("radio", { name: "Dark" }).click()
  await settings.getByRole("radio", { name: "Larger" }).click()
  await settings.getByRole("button", { name: "Done" }).click()
  await settings.waitFor({ state: "hidden" })
  if ((await page.evaluate(() => document.documentElement.style.zoom)) !== "1.22") throw new Error("the text size didn't apply")
  console.log(`ok  ${at}`)
  await opens("Go to… palette", () => page.getByRole("button", { name: /^Go to…/ }).click())
  const plus = page.getByRole("button", { name: "New channel or join" })
  await eachItem("New channel or join", plus, () => true)

  at = "create a channel"
  await plus.click()
  await page.getByRole("menu").waitFor()
  await page.getByRole("menuitem", { name: "New channel" }).click()
  await page.getByRole("dialog").getByRole("textbox").fill("smoke")
  await page.getByRole("button", { name: "Create channel" }).click()
  await page.waitForURL(/#mc2-/)
  await page.getByRole("textbox", { name: "Message" }).waitFor()
  // An empty channel opens on how to add an agent: one command, with its join code.
  at = "Add an agent card"
  const addAgent = page.getByRole("region", { name: "Add an agent" })
  await addAgent.waitFor()
  const card = await addAgent.innerText()
  if (!/sh -s -- join mc2-/.test(card)) throw new Error("the Add an agent card has no join command")
  // Not the public relay: the line names this one, or kiwi would ask the public relay about this channel.
  if (!card.includes(`--relay ${new URL(BASE).origin}`)) throw new Error("the Add an agent command doesn't name this relay")
  console.log(`ok  ${at}`)

  // Someone who isn't in yet, opening the join link: the preview names the owner.
  // That fetch has to send the code's fingerprint, or /info answers 426 and the name never arrives.
  at = "invite preview"
  const inviteCode = decodeURIComponent(new URL(page.url()).hash.slice(1))
  const guest = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  guest.on("pageerror", (e) => errors.push(`${at}: ${e.message}`))
  try {
    await guest.goto(`${BASE}#${encodeURIComponent(inviteCode)}`)
    await guest.getByRole("heading", { name: "Smoke (dev) invited you to a channel" }).waitFor({ timeout: 10000 })
    console.log(`ok  ${at}`)
  } finally {
    await guest.close()
  }

  // The channel's details, as Messages shows a chat's Info: the faces and name in the header open them.
  const details = page.getByRole("button", { name: /^Details:/ })
  const panel = page.getByRole("complementary", { name: "Details" })
  /** Open the details (if they aren't), then do something in them. */
  const inDetails = async (fn: () => Promise<void>) => {
    if (!(await panel.isVisible())) await details.click()
    await panel.waitFor()
    await fn()
  }
  at = "Details"
  await inDetails(async () => {})
  console.log(`ok  ${at}`)
  await opens("Invite", () => inDetails(() => panel.getByRole("button", { name: "Invite", exact: true }).click()))
  await opens("Invite → A person", () =>
    inDetails(async () => {
      await panel.getByRole("button", { name: "Invite", exact: true }).click()
      await page.getByRole("dialog").getByRole("tab", { name: "A person" }).or(page.getByRole("dialog").getByRole("button", { name: "A person" })).first().click()
    })
  )
  for (const item of ["Charter", "Rename channel", "Use in a terminal…"]) await opens(`Details → ${item}`, () => inDetails(() => panel.getByRole("button", { name: new RegExp(`^${item}`) }).click()))
  // Escape (which closes each dialog above) may have closed the details too.
  if (await panel.isVisible()) await panel.getByRole("button", { name: "Close details" }).click()
  at = "send and reply"
  await page.getByRole("textbox", { name: "Message" }).fill("smoke test")
  await page.keyboard.press("Enter")
  const row = page.getByText("smoke test", { exact: true }).first()
  await row.waitFor()
  // The row's actions only show on hover, which headless pointers lose easily: click it directly.
  await page.locator("button[aria-label='Reply']").first().dispatchEvent("click")
  await page.getByRole("button", { name: "Close thread" }).waitFor()
  await page.getByRole("button", { name: "Close thread" }).click()
  console.log("ok  Thread panel")
  // Once there's something going on, the owner's stop button is in the header.
  await opens("Pause agents", () => page.getByRole("button", { name: /^Pause (all )?agents$/ }).first().click())

  // The sent message is sealed in this browser. A reload paints it and the
  // socket asks only for seqs after that row. "smoke test" contains a space,
  // which ciphertext (base64url) cannot, so a stored body fails this check.
  at = "history cache"
  await page.waitForFunction(async () => {
    const rows = await new Promise<unknown[]>((resolve) => {
      const req = indexedDB.open("mc.history")
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("rows")) {
          db.close()
          resolve([])
          return
        }
        const all = db.transaction("rows", "readonly").objectStore("rows").getAll()
        all.onsuccess = () => {
          db.close()
          resolve(all.result as unknown[])
        }
        all.onerror = () => {
          db.close()
          resolve([])
        }
      }
      req.onerror = () => resolve([])
    })
    return rows.length > 0 && !JSON.stringify(rows).includes("smoke test")
  }, undefined, { timeout: 5000 })
  console.log("ok  history cache sealed")

  at = "reload fetches only what is new"
  const sinceOnReload = new Promise<string>((resolve) => {
    const onWs = (ws: { url: () => string }) => {
      const since = new URL(ws.url()).searchParams.get("since")
      if (since == null) return
      page.off("websocket", onWs)
      resolve(since)
    }
    page.on("websocket", onWs)
  })
  await page.reload()
  await page.getByText("smoke test", { exact: true }).first().waitFor()
  const since = await sinceOnReload
  if (!(Number(since) > 0)) throw new Error(`reload streamed since ${since}; expected only newer seqs`)
  await page.getByRole("complementary").getByRole("button", { name: /smoke \(dev\)/ }).first().waitFor()
  console.log(`ok  reload fetches only what is new (since ${since})`)

  // An agent joins from a computer linked to this account: the link page, the request, approval.
  at = "link a computer"
  const channel = page.url()
  const code = new URL(channel).hash.slice(1)
  let opened = false
  const setup = kiwi(["setup", "--relay", BASE], (out) => {
    const link = /(http\S+#link=\S+)/.exec(out)?.[1]
    // Linking seats it nowhere: its first agent here asks.
    if (link && !opened) (opened = true), void page.goto(link)
  })
  await page.getByRole("button", { name: "Yes, link it" }).click({ timeout: 20000 })
  await setup
  console.log(`ok  ${at}`)
  await page.goto(channel)
  const joining = kiwi(["join", code, "smoke", "--relay", BASE, "--as", "bot", "--role", "tester"])
  // Needs you: the request, its code, and one click; what it can do is the default unless chosen.
  const needs = page.getByRole("region", { name: "Needs you" })
  // Needs you is a slim banner; what's in it opens under it.
  const needsOpen = async () => {
    const banner = needs.getByRole("button", { name: /needs? you/ }).first()
    await banner.waitFor({ timeout: 30000 })
    if ((await banner.getAttribute("aria-expanded")) !== "true") await banner.click()
  }
  const letIn = needs.getByRole("button", { name: "It matches: let in" })
  const showCode = needs.getByRole("button", { name: "Show code" })
  await needsOpen()
  await letIn.or(showCode).first().waitFor({ timeout: 30000 })
  if (await showCode.count()) await showCode.click()
  await letIn.waitFor({ timeout: 30000 })
  await opens("Needs you → Choose what it can do…", () => needs.getByRole("button", { name: "Choose what it can do…" }).click())
  at = "approve"
  await needsOpen()
  // Its computer's first agent here: "let agents from it in from now on" is on, so this seats the computer.
  await needs.getByRole("checkbox", { name: /Let agents from .* in from now on/ }).waitFor()
  await letIn.click()
  await joining
  await addAgent.waitFor({ state: "hidden", timeout: 15000 })
  console.log(`ok  ${at}`)

  // Seated on that approval: the computer's next agent lets itself in.
  at = "an agent from your own computer comes in on its own"
  await page.goto(channel)
  await page.getByText("smoke test", { exact: true }).first().waitFor()
  await kiwi(["join", code, "smoke", "--relay", BASE, "--as", "helper"])
  await page.getByText(/joined via/).first().waitFor({ timeout: 15000 })
  console.log(`ok  ${at}`)

  // Read receipts (T1554): once the agents it went to have read your newest message, it says so.
  at = "read receipt"
  await page.getByRole("textbox", { name: "Message" }).fill("smoke, read me")
  await page.keyboard.press("Enter")
  await page.getByText("smoke, read me", { exact: true }).first().waitFor()
  // Nothing yet: an agent counts only once it has ever said how far it read (an older kiwi never does).
  for (const as of ["bot", "helper"]) await kiwi(["-c", "smoke", "--as", as, "listen", "--now"])
  await page.getByText(/^Read( by|\s\d)/).waitFor({ timeout: 15000 })
  if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "read.png") })
  console.log(`ok  ${at}`)

  // Your seat in a terminal (T1389): kiwi tui <code> on another computer shows a code, the dialog shows
  // the same, and "It matches" hands the seat over sealed. Nothing with a key is copied.
  at = "pair a terminal"
  await inDetails(() => panel.getByRole("button", { name: /^Use in a terminal/ }).click())
  const pairDialog = page.getByRole("dialog").filter({ hasText: "Use in a terminal" })
  // The whole command: the box splits it into one span per flag.
  const pairCmd = (await pairDialog.locator("code").filter({ hasText: /^kiwi tui mc2-/ }).innerText({ timeout: 10000 })).replace(/\s+/g, " ").trim()
  const termHome = join(data, "terminal")
  let termOut = ""
  // KIWI_RELAY too: whatever the command says, this never reaches a relay but the local one.
  const term = spawn("bun", ["src/cli/main.ts", ...pairCmd.split(/\s+/).slice(1)], { cwd: ROOT, env: { ...cliEnv, KIWI_HOME: termHome, KIWI_RELAY: BASE.replace(/\/$/, ""), ...PERSON } })
  term.stdout.on("data", (d: Buffer) => (termOut += d))
  term.stderr.on("data", (d: Buffer) => (termOut += d))
  const termDone = new Promise<number | null>((ok) => term.on("exit", ok))
  // The person chooses the terminal (its label says which), then compares codes.
  await pairDialog.getByRole("button", { name: "That’s mine" }).click({ timeout: 20000 }).catch((e) => {
    throw new Error(`${e instanceof Error ? e.message.split("\n")[0] : e} (terminal: ${termOut.trim() || "nothing yet"})`)
  })
  const asked = pairDialog.getByText(/Does it show/)
  await asked.waitFor({ timeout: 20000 })
  const shownCode = /\d{3}-\d{3}/.exec(await asked.innerText())![0]
  for (let i = 0; i < 100 && !termOut.includes(`code ${shownCode}`); i++) await page.waitForTimeout(100)
  if (!termOut.includes(`code ${shownCode}`)) throw new Error(`the terminal didn't show ${shownCode}: ${termOut}`)
  await pairDialog.getByRole("button", { name: "It matches: let it in" }).click()
  if ((await termDone) !== 0 || !termOut.includes("Your seat is on this computer now")) throw new Error(`pairing failed: ${termOut}`)
  console.log(`ok  ${at}`)

  await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Smoke task", "--owner", "bot"])
  // A task has its own conversation, opened from the Tasks tab under the channel's header; it opens on the task's card, and the card on its page.
  at = "Task conversation and page"
  const conversations = page.getByRole("main").getByRole("navigation", { name: "Conversations" })
  await conversations.getByRole("button", { name: /^Tasks/ }).click({ timeout: 15000 })
  await page.getByRole("main").getByRole("button", { name: /Smoke task/ }).first().click({ timeout: 15000 })
  await page.getByRole("main").getByRole("button", { name: /^(?!Details).*Smoke task T\d+/ }).first().click()
  await page.getByRole("region", { name: /^Task T\d+/ }).getByRole("heading", { name: "Activity" }).waitFor()
  await page.getByRole("button", { name: "Close task" }).click()
  // In a task's conversation, a message goes to the task's thread.
  await page.getByRole("textbox", { name: "Message" }).fill("smoke in the task")
  await page.keyboard.press("Enter")
  await page.getByText("smoke in the task", { exact: true }).first().waitFor()
  await conversations.getByRole("button", { name: /^Main/ }).click()
  if (await page.getByText("smoke in the task", { exact: true }).count()) throw new Error("a message in a task's conversation showed in main")
  console.log(`ok  ${at}`)
  // What the owner can do to a member: each item behind their face in the details.
  for (const item of ["Set role…", "Remove from channel…"])
    await opens(`Details → bot → ${item}`, () =>
      inDetails(async () => {
        await panel.getByRole("button", { name: "More for bot" }).click()
        await page.getByRole("menuitem", { name: item }).click()
      })
    )

  // Coordinator mode lives in the details panel: Turn off takes the role away, Turn on picks who holds it.
  at = "Coordinator mode off and on"
  // An event line says it in a few words; its tooltip has the whole of it.
  await page.locator('[title*="turned on coordinator-only"]').first().waitFor({ state: "attached", timeout: 15000 })
  // Whoever relays now (bot or helper): turning off takes it from them (nothing, if nobody does yet).
  const relays = await panel.getByText(/relays/).innerText().catch(() => "")
  const relaying = /on \((.*) relays\)/.exec(relays)?.[1]
  await inDetails(async () => {
    await panel.getByRole("button", { name: "Turn off" }).click()
  })
  if (relaying) {
    // The mode goes off first (so nobody re-appoints in between), then the role: the role is the newest line.
    await page.getByText(`${relaying} has no role now`).first().waitFor({ timeout: 15000 })
  }
  await panel.getByText(/Coordinator mode: off/).waitFor({ timeout: 15000 })
  await inDetails(async () => {
    await panel.getByRole("button", { name: "Turn on" }).click()
    await page.getByRole("dialog").getByRole("button", { name: /bot/ }).click()
  })
  await panel.getByText(/Coordinator mode: on \(bot relays\)/).waitFor({ timeout: 15000 })
  // A direct conversation with a member, from their face.
  await panel.getByRole("button", { name: "More for bot" }).click()
  await page.getByRole("menuitem", { name: "Message privately" }).click()
  await page.getByRole("textbox", { name: "Message" }).fill("smoke, privately")
  await page.keyboard.press("Enter")
  await conversations.getByRole("button", { name: /^bot/ }).waitFor({ timeout: 15000 })
  await conversations.getByRole("button", { name: /^Main/ }).click()
  console.log(`ok  ${at} and a direct conversation`)

  at = "Tasks view"
  await conversations.getByRole("button", { name: /^Tasks/ }).click()
  await page.getByRole("main").getByRole("button", { name: /Smoke task/ }).first().waitFor()
  await conversations.getByRole("button", { name: /^Main/ }).click()
  await page.getByRole("textbox", { name: "Message" }).waitFor()
  console.log("ok  Tasks view")

  // What's new where (T1245): with another channel open, the agent writes in this one. The next
  // listing carries its head, the row gets a dot, the tab a total, and Alt+↓ goes there.
  at = "news in a closed channel"
  await plus.click()
  await page.getByRole("menuitem", { name: "New channel" }).click()
  await page.getByRole("dialog").getByRole("textbox").fill("smoke-2")
  await page.getByRole("button", { name: "Create channel" }).click()
  await page.waitForURL((u) => u.href !== channel && /#mc2-/.test(u.href))
  await page.getByRole("textbox", { name: "Message" }).waitFor()
  await kiwi(["-c", "smoke", "--as", "bot", "send", "news from the bot"])
  // The listing is asked for at most every 5 minutes: forget the last one, then refocus.
  await page.evaluate(() => {
    localStorage.removeItem("mc.listing")
    window.dispatchEvent(new Event("focus"))
  })
  const smokeRow = page.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: /^smoke\b(?!-)/ })
  await smokeRow.getByLabel("New messages").waitFor({ timeout: 10000 })
  if (!/^\(1\) /.test(await page.title())) throw new Error(`the tab says "${await page.title()}"`)
  if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "news.png") })
  await page.keyboard.press("Alt+ArrowDown")
  await page.waitForURL(channel)
  await page.getByText("news from the bot").first().waitFor()
  await page.waitForFunction(() => document.title === "Channels")
  console.log(`ok  ${at}`)

  // Anything that announces a popup and isn't covered above: new menus get opened too.
  const triggers = await page.locator("[aria-haspopup]:visible").all()
  for (const [i, t] of triggers.entries()) {
    const label = (await t.getAttribute("aria-label")) || (await t.innerText()).trim().split("\n").pop()!.slice(0, 30) || `#${i}`
    if (!(await t.isEnabled())) continue
    await opens(`sweep: ${label}`, () => t.click())
  }
} catch (e) {
  errors.push(`${at}: ${e instanceof Error ? e.message.split("\n").slice(0, 6).join(" | ") : String(e)}`)
  await page.screenshot({ path: join(tmpdir(), "kiwi-smoke-failure.png") }).catch(() => {})
} finally {
  await browser.close()
  relay.kill()
  rmSync(data, { recursive: true, force: true })
}

if (errors.length) {
  console.error(`\nUI smoke failed:\n${errors.map((e) => `  ${e}`).join("\n")}\n(screenshot, if any: ${join(tmpdir(), "kiwi-smoke-failure.png")})`)
  process.exit(1)
}
console.log("\nUI smoke passed")
