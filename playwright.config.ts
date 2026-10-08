// End-to-end tests: the demo's panel pages, in a host page with one flat panel
// (e2e/harness), driven in Chromium, Firefox and WebKit. `pnpm e2e` starts the
// dev servers (the scene's, which serves the harness, and the panel pages').

import { defineConfig } from "@playwright/test"

const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: CI,
  // A test that fails now and then is a bug to fix, not to retry.
  retries: 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 800, height: 800 },
    trace: "retain-on-failure"
  },
  // No device presets: they make the browser claim another platform (Windows),
  // and the agent's key bindings follow the platform (Cmd on macOS, Ctrl elsewhere).
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } }
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5174/panels/reader/",
    reuseExistingServer: !CI,
    timeout: 60_000
  }
})
