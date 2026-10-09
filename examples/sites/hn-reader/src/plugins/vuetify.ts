import "vuetify/styles";
import { createVuetify } from "vuetify";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";

const HN_ORANGE = "#ff6600";

// Nothing here persists anything: the theme lives in memory only (the page may
// run sandboxed, where storage throws).
export const vuetify = createVuetify({
  icons: { defaultSet: "mdi", aliases, sets: { mdi } },
  theme: {
    defaultTheme: "light",
    // No view transition when switching themes: switch at once.
    transition: false,
    themes: {
      light: {
        dark: false,
        colors: {
          primary: HN_ORANGE,
          secondary: "#5c6bc0",
          background: "#f6f6ef",
          surface: "#ffffff",
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: "#ff8a3d",
          secondary: "#9fa8da",
          background: "#121212",
          surface: "#1e1e1e",
        },
      },
    },
  },
  defaults: {
    VChip: { size: "small" },
  },
});
