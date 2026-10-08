// The server for the panel pages, on another origin than the scene
// (vite.config.ts starts it with `pnpm dev` and `pnpm preview`). In
// development it adds the panel agent to every page under panels/, the way a
// server or proxy in front of an existing site could; a build has the tag
// already (vite.config.ts uses the same plugin).

import { posix } from "node:path"
import { defineConfig, loadEnv, type InlineConfig, type Plugin } from "vite"

/** The same sandbox as the demo's iframes (PANEL_SANDBOX in src/html-panel.ts). */
const PANEL_SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-popups"

export const AGENT_SOURCE = "/src/agent/entry.ts"

/**
 * Where the scene and the panel pages are served: `pnpm dev` and `pnpm
 * preview` use two origins of their own. VITE_HOST_ORIGIN and VITE_PANEL_ORIGIN
 * override them, from the environment or an untracked .env file (see
 * .env.example).
 */
const DEFAULT_ORIGINS = {
  development: { host: "http://localhost:5173", panel: "http://localhost:5174" },
  production: { host: "http://localhost:4173", panel: "http://localhost:4174" }
}

export function originsFor(mode: string): { host: string; panel: string } {
  const env = loadEnv(mode, import.meta.dirname, "VITE_")
  const defaults = mode === "production" ? DEFAULT_ORIGINS.production : DEFAULT_ORIGINS.development
  return { host: env.VITE_HOST_ORIGIN || defaults.host, panel: env.VITE_PANEL_ORIGIN || defaults.panel }
}
/** Where a build puts the agent, so that pages can load it without bundling it. */
export const AGENT_BUILD_FILE = "agent.js"

/**
 * Puts `<script type="module" src=".../agent" data-host-origin="...">` first in
 * the <head> of the pages under panels/. Module scripts run in document order,
 * so the agent runs before the page's own scripts.
 */
export function injectPanelAgent(hostOrigin: string): Plugin {
  return {
    name: "three-html-panel:inject-agent",
    transformIndexHtml: {
      // After bundling, so that a build keeps the tag (and its attribute) as is.
      order: "post",
      handler(_html, context) {
        if (!context.path.startsWith("/panels/")) return
        const src = context.server
          ? AGENT_SOURCE
          : posix.relative(posix.dirname(context.path), `/${AGENT_BUILD_FILE}`)
        return [
          {
            tag: "script",
            attrs: { type: "module", src, "data-host-origin": hostOrigin },
            injectTo: "head-prepend"
          }
        ]
      }
    }
  }
}

/**
 * The panel server's whole configuration, for vite.config.ts to start it with.
 * It reads no config file and no .env of its own (envDir: false), so it never
 * restarts by itself: only the scene's server restarts it, one at a time (two
 * restarting on their own would race for the port).
 */
export function panelServerConfig(mode: string): InlineConfig {
  return { ...panelConfig(mode), configFile: false, envDir: false, mode }
}

export default defineConfig(({ mode }) => panelConfig(mode))

function panelConfig(mode: string) {
  const origins = originsFor(mode)
  const hostOrigin = origins.host
  const panelPort = Number(new URL(origins.panel).port)
  const server = {
    port: panelPort,
    strictPort: true,
    // The demo's panels are sandboxed: their pages are on the opaque origin
    // "null", and so is every request they make for their own scripts, CSS and
    // images. Any sandboxed page anywhere is "null" too, so while this server
    // runs, any site could read what it serves; fine for a local demo of public
    // files, not for a server with anything private on it.
    cors: { origin: [hostOrigin, "null"] },
    // The sandbox also comes with the response, so that it holds when a panel
    // page is opened directly or embedded anywhere else, not only in the demo.
    headers: { "Content-Security-Policy": PANEL_SANDBOX_CSP }
  }
  return {
    root: import.meta.dirname,
    clearScreen: false,
    server,
    preview: server,
    plugins: [injectPanelAgent(hostOrigin)]
  }
}
