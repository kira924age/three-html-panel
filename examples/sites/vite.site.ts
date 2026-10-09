// The Vite configuration every example site that is a package of its own
// (examples/sites/<name>/package.json) builds on. Each site is a separate
// origin, as a page shown in a panel would be: `vp dev` serves it on its own
// port, and `vp build` makes a site to deploy on its own.
//
// A site starts the agent itself, first thing in its entry (see the sites'
// agent module), with the host's origin from VITE_HOST_ORIGIN, the same
// variable the scene uses (see originsFor and .env.example).

import { resolve } from "node:path";
import { defineConfig, loadEnv, type PluginOption, type UserConfig } from "vite";
import {
  PANEL_PAGE_HEADERS,
  PANEL_SANDBOX_CSP,
  originsFor,
  staticHeaders,
} from "../../vite.panels.config.ts";

/** The repository's root, where the library's source is. */
const ROOT = resolve(import.meta.dirname, "../..");

/** Each site's port in development; `vp preview` uses this minus 1000 (as the scene: 5173 and 4173). */
export const SITE_PORTS = {
  "web-standards": 5175,
  "hn-reader": 5176,
  chat: 5177,
  gallery: 5178,
} as const;

export type SiteName = keyof typeof SITE_PORTS;

export const SITE_NAMES = Object.keys(SITE_PORTS) as SiteName[];

/** The variable that sets where a site is deployed, e.g. VITE_SITE_HN_READER_ORIGIN. */
export const siteOriginVariable = (name: SiteName) =>
  `VITE_SITE_${name.toUpperCase().replace(/-/g, "_")}_ORIGIN`;

/**
 * Where each site is served, for the scene to show it: its variable (from the
 * environment or an untracked .env file, see .env.example), or its own port on
 * localhost (`vp dev`, or `vp preview` in production mode).
 */
export function siteOrigins(mode: string): Record<SiteName, string> {
  const env = loadEnv(mode, ROOT, "VITE_SITE_");
  const preview = mode === "production";
  return Object.fromEntries(
    SITE_NAMES.map((name) => [
      name,
      env[siteOriginVariable(name)] ||
        `http://localhost:${SITE_PORTS[name] - (preview ? 1000 : 0)}`,
    ]),
  ) as Record<SiteName, string>;
}

export interface SiteOptions {
  name: SiteName;
  /** The site's directory (its vite.config.ts's import.meta.dirname). */
  dir: string;
  plugins?: PluginOption[];
  /** More configuration, merged over the shared one (shallowly). */
  config?: UserConfig;
}

export function siteConfig({ name, dir, plugins = [], config = {} }: SiteOptions) {
  return defineConfig(({ mode }) => {
    const host = originsFor(mode).host;
    const port = SITE_PORTS[name];
    const server = {
      strictPort: true,
      // Shown sandboxed, the page is on the opaque origin "null", and so is
      // every request it makes for its own scripts and styles.
      cors: { origin: [host, "null"] },
      // The sandbox also comes with the page, so that it holds when the page is
      // opened directly or embedded elsewhere, not only in the scene.
      headers: { "Content-Security-Policy": PANEL_SANDBOX_CSP },
    };
    return {
      root: dir,
      base: "./",
      clearScreen: false,
      server: { ...server, port },
      preview: { ...server, port: port - 1000 },
      define: { "import.meta.env.VITE_HOST_ORIGIN": JSON.stringify(host) },
      resolve: {
        // What a site that installed the package would import, from the library's source here.
        alias: [
          { find: /^three-html-panel\/agent$/, replacement: resolve(ROOT, "src/agent/index.ts") },
          { find: /^three-html-panel\/page$/, replacement: resolve(ROOT, "src/agent/page.ts") },
        ],
      },
      // Deployed, the whole site is sandboxed and readable from "null", as in development.
      plugins: [...plugins, staticHeaders({ "/*": PANEL_PAGE_HEADERS })],
      ...config,
    };
  });
}
