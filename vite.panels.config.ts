// The development server for the panel pages, on another origin than the
// scene (vite.config.ts starts it). It adds the panel agent to every page
// under panels/, the way a server or proxy in front of an existing site could.

import { posix } from "node:path"
import { defineConfig, loadEnv, type Plugin } from "vite"

export const AGENT_SOURCE = "/src/agent/entry.ts"
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_")
  const hostOrigin = env.VITE_HOST_ORIGIN!
  const panelPort = Number(new URL(env.VITE_PANEL_ORIGIN!).port)
  return {
    root: import.meta.dirname,
    clearScreen: false,
    server: {
      port: panelPort,
      strictPort: true,
      // Only the scene's origin may read from this server with CORS.
      cors: { origin: hostOrigin }
    },
    plugins: [injectPanelAgent(hostOrigin)]
  }
})
