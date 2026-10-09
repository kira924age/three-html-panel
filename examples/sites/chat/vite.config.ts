import react from "@vitejs/plugin-react";
import { siteConfig } from "../vite.site.ts";

export default siteConfig({ name: "chat", dir: import.meta.dirname, plugins: [react()] });
