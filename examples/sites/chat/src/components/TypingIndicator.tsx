import { Group, Text } from "@mantine/core";
import { useUsers } from "../hooks/users";
import classes from "./TypingIndicator.module.css";

/** "Kit is typing…", with animated dots. */
export function TypingIndicator({ userIds }: { userIds: string[] }) {
  const user = useUsers();
  const names = userIds.map((id) => user(id).name);
  const label =
    names.length === 0
      ? ""
      : names.length === 1
        ? `${names[0]} is typing`
        : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are typing`;

  return (
    <div className={classes.root} aria-live="polite">
      {names.length > 0 && (
        <Group gap={6} wrap="nowrap">
          <span className={classes.dots} aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <Text size="xs" c="dimmed">
            <b>{label}</b>…
          </Text>
        </Group>
      )}
    </div>
  );
}
