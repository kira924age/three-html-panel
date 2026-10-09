import { Group, Paper, Portal, Text, UnstyledButton } from "@mantine/core";
import { useSyncExternalStore } from "react";
import { UserAvatar } from "../UserAvatar";
import type { MentionPopupStore } from "./mention-suggestion";
import classes from "./MentionPopup.module.css";

const WIDTH = 260;

/** The list of people to mention, above the caret while typing "@…". */
export function MentionPopup({ store }: { store: MentionPopupStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!state?.rect) return null;
  const { rect, items, selected } = state;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
  const bottom = window.innerHeight - rect.top + 6;

  return (
    <Portal>
      <Paper
        className={classes.popup}
        shadow="md"
        withBorder
        radius="md"
        p={4}
        w={WIDTH}
        style={{ left, bottom }}
        role="listbox"
        aria-label="Mention someone"
      >
        <Text size="xs" c="dimmed" px={8} py={4} fw={600}>
          People
        </Text>
        {items.length === 0 && (
          <Text size="sm" c="dimmed" px={8} py={6}>
            No one matches
          </Text>
        )}
        {items.map((user, i) => (
          <UnstyledButton
            key={user.id}
            className={classes.item}
            data-selected={i === selected || undefined}
            role="option"
            aria-selected={i === selected}
            // Keep the editor focused.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => store.select(i)}
            onClick={() => state.command(user)}
          >
            <Group gap="xs" wrap="nowrap">
              <UserAvatar user={user} size={24} />
              <Text size="sm" fw={600} truncate>
                {user.name}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                @{user.handle}
              </Text>
            </Group>
          </UnstyledButton>
        ))}
      </Paper>
    </Portal>
  );
}
