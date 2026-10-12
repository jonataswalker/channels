// The installer behind the dashboard's "Add an agent" line: `curl …/install | sh -s -- join CODE --relay URL`
// installs kiwi, then runs `kiwi join CODE --relay URL` with every argument as given, and nothing else.
// Downloads are stubbed: a fake `curl` hands back a script standing in for kiwi, and its checksum.

import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { joinCommand, kiwiJoin } from "../web/src/lib/join-line.ts"

const SCRIPT = join(import.meta.dir, "..", "web", "public", "install.sh")

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-install-"))
  const fake = `#!/bin/sh\nif [ "$1" = --version ]; then echo 9.9.9; exit 0; fi\necho "ran: $*" > "${dir}/ran"\n`
  writeFileSync(join(dir, "fake-kiwi"), fake)
  const sum = createHash("sha256").update(fake).digest("hex")
  // curl -fsSL URL -o FILE: the binary for any asset, SHA256SUMS naming that asset.
  writeFileSync(
    join(dir, "curl"),
    `#!/bin/sh\nurl=""; out=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done\n` +
      `case "$url" in *SHA256SUMS) for a in kiwi-darwin-arm64 kiwi-darwin-x64 kiwi-linux-x64 kiwi-linux-arm64; do echo "${sum}  $a"; done > "$out";; *) cp "${dir}/fake-kiwi" "$out";; esac\n`,
  )
  chmodSync(join(dir, "curl"), 0o755)
  return dir
}

function install(dir: string, args: string[]) {
  return Bun.spawnSync(["sh", SCRIPT, ...args], {
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, KIWI_INSTALL: join(dir, "bin") },
    stdout: "pipe",
    stderr: "pipe",
  })
}

describe("the installer", () => {
  test("with `join CODE --relay URL`, installs and then runs exactly that join", () => {
    const dir = sandbox()
    try {
      const r = install(dir, ["join", "mc2-abc", "--relay", "http://localhost:8787"])
      expect(r.exitCode).toBe(0)
      expect(readFileSync(join(dir, "ran"), "utf8").trim()).toBe("ran: join mc2-abc --relay http://localhost:8787")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("with no arguments, installs and runs nothing", () => {
    const dir = sandbox()
    try {
      const r = install(dir, [])
      expect(r.exitCode).toBe(0)
      expect(() => readFileSync(join(dir, "ran"))).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("anything but join is refused before downloading", () => {
    const dir = sandbox()
    try {
      const r = install(dir, ["close", "--yes"])
      expect(r.exitCode).toBe(1)
      expect(r.stderr.toString()).toContain("only runs `kiwi join`")
      expect(() => readFileSync(join(dir, "bin", "kiwi"))).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the Add an agent line", () => {
  test("names the relay unless it's the public one", () => {
    expect(kiwiJoin("https://channels.kiwiinit.com", "mc2-x")).toBe("join mc2-x")
    expect(kiwiJoin("http://localhost:8787", "mc2-x")).toBe("join mc2-x --relay http://localhost:8787")
    expect(joinCommand("https://relay.example.org", "mc2-x")).toBe("curl -fsSL https://relay.example.org/install | sh -s -- join mc2-x --relay https://relay.example.org")
  })
})
