import {
  ActionIcon,
  Avatar,
  Burger,
  Group,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { spotlight } from "@mantine/spotlight";
import {
  IconHash,
  IconLock,
  IconMoon,
  IconSearch,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";
import { PRESENCE_LABEL } from "../data/users";
import { useChat } from "../hooks/chat";
import { useUsers } from "../hooks/users";
import { UserAvatar } from "./UserAvatar";
import classes from "./ChannelHeader.module.css";

interface Props {
  navOpened: boolean;
  onToggleNav: () => void;
  onOpenSettings: () => void;
}

export function ChannelHeader({ navOpened, onToggleNav, onOpenSettings }: Props) {
  const chat = useChat();
  const user = useUsers();
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  const channel = chat.active;
  const dm = channel.kind === "dm" ? user(channel.name) : null;
  const members = channel.members.map(user);

  return (
    <Group h="100%" px="md" gap="sm" wrap="nowrap">
      <Burger
        opened={navOpened}
        onClick={onToggleNav}
        hiddenFrom="sm"
        size="sm"
        aria-label="Toggle navigation"
      />
      <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        {dm ? (
          <UserAvatar user={dm} size={26} radius="sm" withStatus />
        ) : channel.private ? (
          <IconLock size={20} className={classes.icon} />
        ) : (
          <IconHash size={20} className={classes.icon} />
        )}
        <div style={{ minWidth: 0 }}>
          <Text fw={700} size="md" truncate lh={1.25}>
            {dm ? dm.name : channel.name}
          </Text>
          <Text size="xs" c="dimmed" truncate lh={1.3}>
            {dm ? `${PRESENCE_LABEL[dm.presence]} · ${dm.title}` : channel.topic}
          </Text>
        </div>
      </Group>

      {!dm && (
        <Tooltip label={`${members.length} members`} withArrow>
          <Avatar.Group spacing={8} className={classes.members} visibleFrom="xs">
            {members.slice(0, 3).map((m) => (
              <UserAvatar key={m.id} user={m} size={26} radius="xl" />
            ))}
            {members.length > 3 && (
              <Avatar size={26} radius="xl">
                +{members.length - 3}
              </Avatar>
            )}
          </Avatar.Group>
        </Tooltip>
      )}

      <Group gap={4} wrap="nowrap">
        <Tooltip label="Search (Ctrl/⌘ K)" withArrow>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Search"
            onClick={() => spotlight.open()}
          >
            <IconSearch size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={computed === "dark" ? "Light theme" : "Dark theme"} withArrow>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Toggle color scheme"
            onClick={() => setColorScheme(computed === "dark" ? "light" : "dark")}
          >
            {computed === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Settings" withArrow>
          <ActionIcon variant="default" size="lg" aria-label="Settings" onClick={onOpenSettings}>
            <IconSettings size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
