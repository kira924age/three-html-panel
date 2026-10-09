import { resolve } from "node:path";
import { siteConfig } from "../vite.site.ts";

/** The site's pages: each a document of its own. */
const PAGES = ["index", "media", "forms", "layout", "interactive"];

export default siteConfig({
  name: "web-standards",
  dir: import.meta.dirname,
  config: {
    build: {
      rolldownOptions: {
        input: Object.fromEntries(
          PAGES.map((page) => [page, resolve(import.meta.dirname, `${page}.html`)]),
        ),
      },
    },
  },
});
