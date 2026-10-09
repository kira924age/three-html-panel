import { svelte } from "@sveltejs/vite-plugin-svelte";
import { siteConfig } from "../vite.site.ts";

export default siteConfig({ name: "gallery", dir: import.meta.dirname, plugins: [svelte()] });
