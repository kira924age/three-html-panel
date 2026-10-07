import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  build: {
    // three.js alone is about 500 kB.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        notes: resolve(import.meta.dirname, "panels/notes/index.html"),
        controls: resolve(import.meta.dirname, "panels/controls/index.html")
      }
    }
  }
})
