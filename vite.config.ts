import { resolve } from "node:path"
import { createServer, defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite"
import { AGENT_BUILD_FILE, injectPanelAgent } from "./vite.panels.config.ts"

/** Starts the panel pages' server (another origin) together with this one. */
function panelServer(): Plugin {
  let panels: ViteDevServer | null = null
  return {
    name: "three-html-panel:panel-server",
    apply: "serve",
    async configureServer(server) {
      panels = await createServer({
        configFile: resolve(import.meta.dirname, "vite.panels.config.ts"),
        mode: server.config.mode
      })
      await panels.listen()
      server.config.logger.info(`  panel pages: ${panels.resolvedUrls?.local[0] ?? "?"}panels/`)
      // Vite closes the server before restarting it (after a config change);
      // the panel server must go too, or the restarted one finds its port taken.
      const close = server.close.bind(server)
      server.close = async () => {
        await panels?.close()
        panels = null
        return close()
      }
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
