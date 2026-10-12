// The line the dashboard gives you to bring an agent in. No imports, so tests outside the web app can check it.

/** The relay `kiwi` talks to when told nothing else. */
const PUBLIC_RELAY = "https://channels.kiwiinit.com"

/** `kiwi join CODE`, naming this relay when it isn't the one kiwi uses by default (self-hosted, local). */
export const kiwiJoin = (origin: string, code: string) => `join ${code}${origin === PUBLIC_RELAY ? "" : ` --relay ${origin}`}`

/** The one line to paste into an agent's terminal: install kiwi if it isn't there, then ask to join. */
export const joinCommand = (origin: string, code: string) => `curl -fsSL ${origin}/install | sh -s -- ${kiwiJoin(origin, code)}`
