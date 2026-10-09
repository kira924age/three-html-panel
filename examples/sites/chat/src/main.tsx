import "./agent";

import "@mantine/core/styles.css";
import "@mantine/tiptap/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/notifications/styles.css";
import "./global.css";

import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ChatProvider } from "./hooks/chat";
import { SettingsProvider, useSettings } from "./hooks/settings";
import { memoryColorSchemeManager } from "./lib/color-scheme-manager";

// Mantine's default manager uses localStorage, which throws in a sandboxed page.
const colorSchemeManager = memoryColorSchemeManager();

function Root() {
  const { settings } = useSettings();
  const theme = useMemo(
    () =>
      createTheme({
        primaryColor: settings.accent,
        defaultRadius: "md",
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif',
        cursorType: "pointer",
      }),
    [settings.accent],
  );
  return (
    <MantineProvider
      theme={theme}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="light"
    >
      <Notifications position="top-right" limit={3} zIndex={1000} />
      <ChatProvider>
        <App />
      </ChatProvider>
    </MantineProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <Root />
    </SettingsProvider>
  </StrictMode>,
);
