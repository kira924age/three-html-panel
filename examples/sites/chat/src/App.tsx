import { AppShell } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useState } from "react";
import { ChannelHeader } from "./components/ChannelHeader";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { useSettings } from "./hooks/settings";
import classes from "./App.module.css";

export function App() {
  const [navOpened, nav] = useDisclosure(false);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const { settings } = useSettings();

  const openSettings = useCallback((tab: SettingsTab = "profile") => {
    setSettingsTab(tab);
    setSettingsOpened(true);
  }, []);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 248, breakpoint: "sm", collapsed: { mobile: !navOpened } }}
      padding={0}
      className={classes.shell}
      style={{ "--density": settings.density } as React.CSSProperties}
    >
      <AppShell.Header>
        <ChannelHeader
          navOpened={navOpened}
          onToggleNav={nav.toggle}
          onOpenSettings={() => openSettings()}
        />
      </AppShell.Header>
      <AppShell.Navbar className={classes.navbar}>
        <Sidebar onOpenSettings={() => openSettings()} onNavigate={nav.close} />
      </AppShell.Navbar>
      <AppShell.Main className={classes.main}>
        <MessageList />
        <Composer />
      </AppShell.Main>

      <CommandPalette onOpenSettings={openSettings} />
      <SettingsModal
        opened={settingsOpened}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        onClose={() => setSettingsOpened(false)}
      />
    </AppShell>
  );
}
