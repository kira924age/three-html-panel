import {
  ActionIcon,
  Popover,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconMoodSmile } from "@tabler/icons-react";
import { useState, type ReactElement } from "react";
import { EMOJI_GROUPS } from "../data/emoji";
import classes from "./EmojiPicker.module.css";

interface Props {
  onPick: (emoji: string) => void;
  /** The button that opens the picker (a smiley ActionIcon by default). */
  target?: ReactElement;
  label?: string;
  position?: "top-start" | "top-end" | "bottom-end" | "left-start";
  /** Called when the picker opens or closes (to keep a hover toolbar visible). */
  onOpenChange?: (opened: boolean) => void;
}

/** A small, curated emoji grid in a Popover. */
export function EmojiPicker({
  onPick,
  target,
  label = "Add emoji",
  position = "top-start",
  onOpenChange,
}: Props) {
  const [opened, setOpened] = useState(false);
  const change = (next: boolean) => {
    setOpened(next);
    onOpenChange?.(next);
  };

  return (
    <Popover
      opened={opened}
      onChange={change}
      position={position}
      shadow="md"
      withinPortal
      trapFocus={false}
      radius="md"
    >
      <Popover.Target>
        {target ? (
          <span onClick={() => change(!opened)} className={classes.targetWrapper}>
            {target}
          </span>
        ) : (
          <Tooltip label={label} withArrow disabled={opened}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={label}
              onClick={() => change(!opened)}
            >
              <IconMoodSmile size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Popover.Target>
      <Popover.Dropdown p="xs" onMouseDown={(e) => e.preventDefault()}>
        <Stack gap={6} w={272}>
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label}>
              <Text size="xs" fw={600} c="dimmed" mb={2}>
                {group.label}
              </Text>
              <SimpleGrid cols={8} spacing={2} verticalSpacing={2}>
                {group.emoji.map((emoji) => (
                  <UnstyledButton
                    key={emoji}
                    className={classes.emoji}
                    aria-label={emoji}
                    onClick={() => {
                      onPick(emoji);
                      change(false);
                    }}
                  >
                    {emoji}
                  </UnstyledButton>
                ))}
              </SimpleGrid>
            </div>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
