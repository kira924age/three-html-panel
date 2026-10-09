import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";
import { siteConfig } from "../vite.site.ts";

export default siteConfig({
  name: "hn-reader",
  dir: import.meta.dirname,
  plugins: [vue(), vuetify({ autoImport: true })],
});
