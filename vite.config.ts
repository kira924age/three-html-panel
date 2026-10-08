import { resolve } from "node:path";
import {
  createServer,
  defineConfig,
  preview,
  type Plugin,
  type PreviewServer,
  type ViteDevServer,
  lazyPlugins,
} from "vite-plus";
import {
  AGENT_BUILD_FILE,
  SITES_DIR,
  injectPanelAgent,
  originsFor,
  panelServerConfig,
} from "./vite.panels.config.ts";

type PanelServer = ViteDevServer | PreviewServer;

/**
 * The one panel server of this process. Vite reloads this file when it
 * restarts the scene's server (a config or .env change; a branch switch makes
 * several at once), so this lives on globalThis rather than in the module.
 * Every start and stop waits for the one before: a new panel server starts only
 * once the previous one has let go of the port.
 */
interface PanelSlot {
  server: PanelServer | null;
  queue: Promise<unknown>;
}
const slot: PanelSlot = ((globalThis as { [key: symbol]: PanelSlot })[
  Symbol.for("three-html-panel:panel-server")
] ??= {
  server: null,
  queue: Promise.resolve(),
});

function inTurn<T>(run: () => Promise<T>): Promise<T> {
  const turn = slot.queue.then(run);
  slot.queue = turn.catch(() => {});
  return turn;
}

/** Replaces the panel server with the one `start` creates. */
function replacePanelServer(start: () => Promise<PanelServer>): Promise<PanelServer> {
  return inTurn(async () => {
    await slot.server?.close();
    slot.server = null;
    slot.server = await start();
    return slot.server;
  });
}

/** Stops the panel server along with `server` (for good, or before Vite restarts it). */
function closePanelServerWith(server: { close(): Promise<void> }, panels: PanelServer): void {
  const close = server.close.bind(server);
  server.close = async () => {
    await inTurn(async () => {
      // A restart may have replaced it already; then that one stays.
      if (slot.server !== panels) return;
      await panels.close();
      slot.server = null;
    });
    return close();
  };
}

/** Starts the panel pages' server (another origin) together with this one, for `pnpm dev` and `pnpm preview`. */
function panelServer(): Plugin {
  return {
    name: "three-html-panel:panel-server",
    apply: "serve",
    async configureServer(server) {
      const panels = await replacePanelServer(async () => {
        const dev = await createServer(panelServerConfig(server.config.mode));
        await dev.listen();
        return dev;
      });
      server.config.logger.info(
        `  panel pages: ${panels.resolvedUrls?.local[0] ?? "?"}${SITES_DIR}/`,
      );
      closePanelServerWith(server, panels);
    },
    async configurePreviewServer(server) {
      // The build's panel pages, from the same dist/ but another origin.
      const panels = await replacePanelServer(() => preview(panelServerConfig(server.config.mode)));
      server.config.logger.info(
        `  panel pages: ${panels.resolvedUrls?.local[0] ?? "?"}${SITES_DIR}/`,
      );
      closePanelServerWith(server, panels);
    },
  };
}

export default defineConfig(({ mode }) => {
  const origins = originsFor(mode);
  const hostPort = Number(new URL(origins.host).port);
  return {
    fmt: {},
    // The npm package (`pnpm pack:lib`), into lib/: dist/ is the demo's build.
    pack: {
      entry: {
        index: "src/index.ts",
        agent: "src/agent/index.ts",
        page: "src/agent/page.ts",
        // The self-starting agent, for a <script> tag (data-host-origin on it).
        "agent-script": "src/agent/entry.ts",
      },
      outDir: "lib",
      format: "esm",
      platform: "browser",
      // For browsers, not the Node version package.json's engines asks for (that is for development).
      target: "es2022",
      dts: true,
      sourcemap: true,
      clean: true,
      publint: true,
    },
    lint: {
      jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
      rules: { "vite-plus/prefer-vite-plus-imports": "error" },
      options: { typeAware: true, typeCheck: true },
    },
    base: "./",
    server: { port: hostPort, strictPort: true },
    preview: { port: hostPort, strictPort: true },
    // The scene's pages load the panel pages from the panel server's origin.
    define: {
      "import.meta.env.VITE_HOST_ORIGIN": JSON.stringify(origins.host),
      "import.meta.env.VITE_PANEL_ORIGIN": JSON.stringify(origins.panel),
    },
    plugins: lazyPlugins(() => [panelServer(), injectPanelAgent(origins.host)]),
    build: {
      // three.js alone is about 500 kB.
      chunkSizeWarningLimit: 800,
      rolldownOptions: {
        input: {
          main: resolve(import.meta.dirname, "index.html"),
          notes: resolve(import.meta.dirname, SITES_DIR, "notes/index.html"),
          controls: resolve(import.meta.dirname, SITES_DIR, "controls/index.html"),
          reader: resolve(import.meta.dirname, SITES_DIR, "reader/index.html"),
          agent: resolve(import.meta.dirname, "src/agent/entry.ts"),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === "agent" ? AGENT_BUILD_FILE : "assets/[name]-[hash].js",
        },
      },
    },
  };
});
