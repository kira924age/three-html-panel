import { Text, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import {
  Spotlight,
  type SpotlightActionData,
  type SpotlightActionGroupData,
} from "@mantine/spotlight";
import {
  IconBell,
  IconHash,
  IconLock,
  IconMessage,
  IconPalette,
  IconSearch,
  IconSettings,
  IconSunMoon,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { channelLabel, useChat } from "../hooks/chat";
import { useUsers } from "../hooks/users";
import { htmlToText } from "../lib/html";
import { shortTime, dayLabel } from "../lib/time";
import type { SettingsTab } from "./SettingsModal";
import { UserAvatar } from "./UserAvatar";

interface Props {
  onOpenSettings: (tab?: SettingsTab) => void;
}

/** Ctrl/⌘ K: switch channels, search messages, and run commands. */
export function CommandPalette({ onOpenSettings }: Props) {
  const chat = useChat();
  const user = useUsers();
  const [query, setQuery] = useState("");
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");

  const texts = useMemo(
    () => new Map(chat.messages.map((m) => [m.id, htmlToText(m.html)])),
    [chat.messages],
  );

  const actions = useMemo(() => {
    const groups: SpotlightActionGroupData[] = [
      {
        group: "Channels",
        actions: chat.channels
          .filter((c) => c.kind === "channel")
          .map((c) => ({
            id: c.id,
            label: c.name,
            description: c.topic,
            leftSection: c.private ? <IconLock size={18} /> : <IconHash size={18} />,
            onClick: () => chat.open(c.id),
          })),
      },
      {
        group: "Direct messages",
        actions: chat.channels
          .filter((c) => c.kind === "dm")
          .map((c) => {
            const u = user(c.name);
            return {
              id: c.id,
              label: u.name,
              description: u.title,
              keywords: [u.handle],
              leftSection: <UserAvatar user={u} size={22} radius="sm" />,
              onClick: () => chat.open(c.id),
            };
          }),
      },
      {
        group: "Commands",
        actions: [
          {
            id: "theme",
            label: computed === "dark" ? "Switch to light theme" : "Switch to dark theme",
            description: "Toggle the color scheme",
            keywords: ["theme", "dark", "light", "color scheme", "mode"],
            leftSection: <IconSunMoon size={18} />,
            onClick: () => setColorScheme(computed === "dark" ? "light" : "dark"),
          },
          {
            id: "settings",
            label: "Open settings",
            description: "Profile, notifications and appearance",
            keywords: ["preferences", "profile", "status"],
            leftSection: <IconSettings size={18} />,
            onClick: () => onOpenSettings("profile"),
          },
          {
            id: "notifications",
            label: "Notification preferences",
            keywords: ["settings", "toast", "mentions"],
            leftSection: <IconBell size={18} />,
            onClick: () => onOpenSettings("notifications"),
          },
          {
            id: "appearance",
            label: "Change accent color",
            keywords: ["settings", "appearance", "density", "theme"],
            leftSection: <IconPalette size={18} />,
            onClick: () => onOpenSettings("appearance"),
          },
        ],
      },
    ];

    const q = query.trim().toLowerCase();
    if (q.length >= 2) {
      const found: SpotlightActionData[] = chat.messages
        .filter((m) => texts.get(m.id)!.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8)
        .map((m) => {
          const channel = chat.channels.find((c) => c.id === m.channelId)!;
          const text = texts.get(m.id)!;
          return {
            id: `msg-${m.id}`,
            label:
              channel.kind === "dm"
                ? `${user(m.userId).name} · direct message`
                : `${user(m.userId).name} in ${channelLabel(channel)}`,
            description: text.length > 90 ? `${text.slice(0, 88)}…` : text,
            // Matched on the text, already: keep it whatever the default filter thinks.
            keywords: [q],
            leftSection: <IconMessage size={18} />,
            rightSection: (
              <Text size="xs" c="dimmed">
                {dayLabel(m.createdAt)} {shortTime(m.createdAt)}
              </Text>
            ),
            onClick: () => chat.open(m.channelId, m.id),
          };
        });
      if (found.length > 0) groups.push({ group: "Messages", actions: found });
    }
    return groups;
  }, [chat, user, query, texts, computed, setColorScheme, onOpenSettings]);

  return (
    <Spotlight
      actions={actions}
      query={query}
      onQueryChange={setQuery}
      shortcut={["mod + K"]}
      // Also from the composer and other fields.
      tagsToIgnore={[]}
      triggerOnContentEditable
      nothingFound="Nothing found…"
      highlightQuery
      limit={20}
      scrollable
      maxHeight={400}
      radius="md"
      searchProps={{
        leftSection: <IconSearch size={18} stroke={1.6} />,
        placeholder: "Jump to a channel, search messages, or run a command…",
      }}
    />
  );
}
