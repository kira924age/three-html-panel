import { resolve } from "node:path"
import { createServer, defineConfig, loadEnv, preview, type Plugin, type PreviewServer, type ViteDevServer } from "vite"
import { AGENT_BUILD_FILE, injectPanelAgent } from "./vite.panels.config.ts"

/** Closes `other` before `server`, so that a restarted server does not find the other's port taken. */
function closeWith(server: { close(): Promise<void> }, other: () => { close(): Promise<void> } | null): void {
  const close = server.close.bind(server)
  server.close = async () => {
    await other()?.close()
    return close()
  }
}

/** Starts the panel pages' server (another origin) together with this one, for `pnpm dev` and `pnpm preview`. */
function panelServer(): Plugin {
  let panels: ViteDevServer | PreviewServer | null = null
  const configFile = resolve(import.meta.dirname, "vite.panels.config.ts")
  return {
    name: "three-html-panel:panel-server",
    apply: "serve",
    async configureServer(server) {
      const dev = await createServer({ configFile, mode: server.config.mode })
      panels = dev
      await dev.listen()
      server.config.logger.info(`  panel pages: ${dev.resolvedUrls?.local[0] ?? "?"}panels/`)
      // Vite closes the server before restarting it (after a config change).
      closeWith(server, () => panels)
    },
    async configurePreviewServer(server) {
      // The build's panel pages, from the same dist/ but another origin.
      panels = await preview({ configFile, mode: server.config.mode })
      server.config.logger.info(`  panel pages: ${panels.resolvedUrls?.local[0] ?? "?"}panels/`)
      closeWith(server, () => panels)
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_")
  const hostPort = Number(new URL(env.VITE_HOST_ORIGIN!).port)
  return {
    base: "./",
    server: { port: hostPort, strictPort: true },
    preview: { port: hostPort, strictPort: true },
    plugins: [panelServer(), injectPanelAgent(env.VITE_HOST_ORIGIN!)],
    build: {
      // three.js alone is about 500 kB.
      chunkSizeWarningLimit: 800,
      rolldownOptions: {
        input: {
          main: resolve(import.meta.dirname, "index.html"),
          notes: resolve(import.meta.dirname, "panels/notes/index.html"),
          controls: resolve(import.meta.dirname, "panels/controls/index.html"),
          agent: resolve(import.meta.dirname, "src/agent/entry.ts")
        },
        output: {
          entryFileNames: chunk => (chunk.name === "agent" ? AGENT_BUILD_FILE : "assets/[name]-[hash].js")
        }
      }
    }
  }
})
