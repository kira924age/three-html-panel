import { Badge, Group, Kbd, NavLink, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import { spotlight } from "@mantine/spotlight";
import { IconHash, IconLock, IconSearch, IconSettings } from "@tabler/icons-react";
import type { Channel } from "../data/types";
import { ME, PRESENCE_LABEL } from "../data/users";
import { useChat } from "../hooks/chat";
import { useSettings } from "../hooks/settings";
import { useUsers } from "../hooks/users";
import { UserAvatar } from "./UserAvatar";
import classes from "./Sidebar.module.css";

interface Props {
  onOpenSettings: () => void;
  /** Called after picking a channel (to close the sidebar on small screens). */
  onNavigate: () => void;
}

export function Sidebar({ onOpenSettings, onNavigate }: Props) {
  const chat = useChat();
  const user = useUsers();
  const { settings } = useSettings();
  const me = user(ME);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  const item = (channel: Channel) => {
    const unread = chat.unread[channel.id] ?? 0;
    const active = channel.id === chat.activeId;
    const dm = channel.kind === "dm" ? user(channel.name) : null;
    return (
      <NavLink
        key={channel.id}
        component="button"
        className={classes.link}
        active={active}
        data-unread={unread > 0 || undefined}
        label={dm ? dm.name : channel.name}
        leftSection={
          dm ? (
            <UserAvatar user={dm} size={20} radius="sm" withStatus />
          ) : channel.private ? (
            <IconLock size={16} stroke={1.8} />
          ) : (
            <IconHash size={16} stroke={1.8} />
          )
        }
        rightSection={
          unread > 0 ? (
            <Badge size="sm" circle={unread < 10} color="red" variant="filled">
              {unread}
            </Badge>
          ) : null
        }
        onClick={() => {
          chat.open(channel.id);
          onNavigate();
        }}
      />
    );
  };

  return (
    <Stack gap={0} h="100%">
      <UnstyledButton className={classes.search} onClick={() => spotlight.open()}>
        <Group gap={8} wrap="nowrap">
          <IconSearch size={15} />
          <Text size="sm" style={{ flex: 1 }}>
            Search
          </Text>
          <Kbd size="xs">{isMac ? "⌘" : "Ctrl"} K</Kbd>
        </Group>
      </UnstyledButton>

      <ScrollArea style={{ flex: 1 }} type="hover" scrollbarSize={6}>
        <Text className={classes.section}>Channels</Text>
        {chat.channels.filter((c) => c.kind === "channel").map(item)}
        <Text className={classes.section}>Direct messages</Text>
        {chat.channels.filter((c) => c.kind === "dm").map(item)}
      </ScrollArea>

      <UnstyledButton className={classes.me} onClick={onOpenSettings} aria-label="Open settings">
        <Group gap="sm" wrap="nowrap">
          <UserAvatar user={me} size={34} withStatus />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>
              {me.name}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {settings.statusText || PRESENCE_LABEL[me.presence]}
            </Text>
          </div>
          <IconSettings size={18} className={classes.meIcon} />
        </Group>
      </UnstyledButton>
    </Stack>
  );
}
