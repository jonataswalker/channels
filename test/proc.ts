// Bun 1.4.2 never ends a killed child's stdout/stderr streams (no EOF after SIGTERM), so a test
// that kills a CLI and then reads its output to the end waits forever. Read what's there, then let go.

/** Read `s` to its end, or until the process behind it is gone and nothing more comes. */
export function drain(s: ReadableStream<Uint8Array>) {
  const reader = s.getReader();
  let text = "";
  const dec = new TextDecoder();
  const done = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += dec.decode(value);
      }
    } catch {}
  })();
  return {
    get text() {
      return text;
    },
    /** Once the process has exited: what it wrote, without waiting on an EOF that never comes. */
    async close(): Promise<string> {
      await Promise.race([done, Bun.sleep(300)]);
      await reader.cancel().catch(() => {});
      await done;
      return text;
    },
  };
}

/** Kill `p`, wait for it to exit, and return what was left on its stderr. */
export async function killAndRead(p: { kill(): void; exited: Promise<number>; stderr: ReadableStream<Uint8Array> }): Promise<string> {
  p.kill();
  await p.exited;
  return drain(p.stderr).close();
}
