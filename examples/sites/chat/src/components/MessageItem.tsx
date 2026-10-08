import {
  ActionIcon,
  Group,
  Menu,
  Paper,
  Text,
  Tooltip,
  Typography,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconDots,
  IconLink,
  IconMoodPlus,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { memo, useState } from "react";
import { QUICK_REACTIONS } from "../data/emoji";
import type { Message } from "../data/types";
import { ME } from "../data/users";
import { useChat } from "../hooks/chat";
import { useUsers } from "../hooks/users";
import { htmlToText } from "../lib/html";
import { fullTime, shortTime } from "../lib/time";
import { EmojiPicker } from "./EmojiPicker";
import { MessageEditor } from "./MessageEditor";
import { UserAvatar } from "./UserAvatar";
import classes from "./MessageItem.module.css";

interface Props {
  message: Message;
  /** Follows a message by the same author shortly before: no avatar and name. */
  continued: boolean;
  editing: boolean;
  highlighted: boolean;
  onDelete: (message: Message) => void;
}

/** Copies text, or shows it when the Clipboard API is unavailable (as in a sandboxed panel). */
async function copyLink(link: string) {
  try {
    if (!navigator.clipboard) throw new Error("no clipboard");
    await navigator.clipboard.writeText(link);
    notifications.show({ title: "Link copied", message: link, color: "green", autoClose: 3000 });
  } catch {
    notifications.show({
      title: "Couldn't access the clipboard",
      message: `Here's the link to copy: ${link}`,
      color: "yellow",
      autoClose: 6000,
    });
  }
}

/** Adds "(edited)" after the message's last paragraph (or after its last block). */
function withEditedMark(html: string, when: string): string {
  const mark = ` <span class="edited-mark" title="Edited ${when}">(edited)</span>`;
  return html.endsWith("</p>") ? `${html.slice(0, -4)}${mark}</p>` : `${html}<p>${mark}</p>`;
}

export const MessageItem = memo(function MessageItem({
  message,
  continued,
  editing,
  highlighted,
  onDelete,
}: Props) {
  const chat = useChat();
  const user = useUsers();
  const author = user(message.userId);
  const mine = message.userId === ME;
  // While a menu or picker is open, the hover toolbar stays.
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Hover from events rather than CSS :hover alone, so that the toolbar is laid out (and
  // can be clicked) whenever it is drawn: a panel draws :hover but hit-tests the live layout.
  const [hovered, setHovered] = useState(false);
  const replyTo = message.replyTo ? chat.messages.find((m) => m.id === message.replyTo) : undefined;
  const link = `${location.origin === "null" ? "https://chat.example.com" : location.origin}/archives/${message.channelId}/${message.id}`;

  const time = (
    <Tooltip label={fullTime(message.createdAt)} withArrow openDelay={300}>
      <Text
        component="time"
        size="xs"
        c="dimmed"
        className={classes.time}
        dateTime={new Date(message.createdAt).toISOString()}
      >
        {shortTime(message.createdAt)}
      </Text>
    </Tooltip>
  );

  return (
    <div
      className={classes.root}
      data-continued={continued || undefined}
      data-active={menuOpen || pickerOpen || editing || undefined}
      data-highlighted={highlighted || undefined}
      data-message-id={message.id}
      data-hovered={hovered || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={classes.gutter}>
        {continued ? (
          <span className={classes.hoverTime}>{time}</span>
        ) : (
          <UserAvatar user={author} />
        )}
      </div>
      <div className={classes.body}>
        {!continued && (
          <Group gap={8} align="baseline" wrap="nowrap">
            <Text fw={700} size="sm" truncate>
              {author.name}
            </Text>
            {author.bot && (
              <Text span size="10px" fw={700} className={classes.botTag}>
                APP
              </Text>
            )}
            {time}
          </Group>
        )}
        {replyTo && (
          <UnstyledButton
            className={classes.quote}
            onClick={() => chat.open(replyTo.channelId, replyTo.id)}
          >
            <Text size="xs" c="dimmed" truncate>
              <IconArrowBackUp size={12} style={{ verticalAlign: "-2px" }} />{" "}
              <b>{user(replyTo.userId).name}</b> {htmlToText(replyTo.html)}
            </Text>
          </UnstyledButton>
        )}
        {editing ? (
          <MessageEditor
            html={message.html}
            onSave={(html) => chat.edit(message.id, html)}
            onCancel={() => chat.setEditing(null)}
          />
        ) : (
          <Typography className={classes.content}>
            <div
              dangerouslySetInnerHTML={{
                __html: message.editedAt
                  ? withEditedMark(message.html, fullTime(message.editedAt))
                  : message.html,
              }}
            />
          </Typography>
        )}
        {message.reactions.length > 0 && (
          <Group gap={4} mt={4}>
            {message.reactions.map((r) => {
              const reacted = r.users.includes(ME);
              const who = r.users.map((id) => (id === ME ? "You" : user(id).name)).join(", ");
              return (
                <Tooltip
                  key={r.emoji}
                  label={`${who} reacted with ${r.emoji}`}
                  withArrow
                  openDelay={200}
                >
                  <UnstyledButton
                    className={classes.reaction}
                    data-reacted={reacted || undefined}
                    aria-pressed={reacted}
                    onClick={() => chat.react(message.id, r.emoji)}
                  >
                    <span>{r.emoji}</span>
                    <span className={classes.reactionCount}>{r.users.length}</span>
                  </UnstyledButton>
                </Tooltip>
              );
            })}
            <EmojiPicker
              label="Add reaction"
              position="top-start"
              onPick={(emoji) => chat.react(message.id, emoji)}
              target={
                <UnstyledButton className={classes.reaction} aria-label="Add reaction">
                  <IconMoodPlus size={14} />
                </UnstyledButton>
              }
            />
          </Group>
        )}
      </div>

      {!editing && (
        <Paper className={classes.toolbar} shadow="xs" withBorder radius="md" p={2}>
          <Group gap={0} wrap="nowrap">
            {QUICK_REACTIONS.slice(0, 3).map((emoji) => (
              <Tooltip key={emoji} label={`React with ${emoji}`} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={`React with ${emoji}`}
                  onClick={() => chat.react(message.id, emoji)}
                >
                  <span className={classes.toolbarEmoji}>{emoji}</span>
                </ActionIcon>
              </Tooltip>
            ))}
            <EmojiPicker
              position="bottom-end"
              onOpenChange={setPickerOpen}
              onPick={(emoji) => chat.react(message.id, emoji)}
              target={
                <Tooltip label="Add reaction" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Add reaction"
                    className={classes.addReaction}
                  >
                    <IconMoodPlus size={18} />
                  </ActionIcon>
                </Tooltip>
              }
            />
            <Tooltip label="Reply" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Reply"
                onClick={() => chat.setReplyTo(message.id)}
              >
                <IconArrowBackUp size={18} />
              </ActionIcon>
            </Tooltip>
            <Menu
              position="bottom-end"
              shadow="md"
              width={200}
              opened={menuOpen}
              onChange={setMenuOpen}
              withinPortal
            >
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="More actions"
                  className={classes.more}
                >
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconArrowBackUp size={16} />}
                  onClick={() => chat.setReplyTo(message.id)}
                >
                  Reply
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconMoodPlus size={16} />}
                  onClick={() => chat.react(message.id, "👍")}
                >
                  React with 👍
                </Menu.Item>
                <Menu.Item leftSection={<IconLink size={16} />} onClick={() => copyLink(link)}>
                  Copy link
                </Menu.Item>
                {mine && (
                  <>
                    <Menu.Divider />
                    <Menu.Item
                      leftSection={<IconPencil size={16} />}
                      onClick={() => chat.setEditing(message.id)}
                    >
                      Edit message
                    </Menu.Item>
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => onDelete(message)}
                    >
                      Delete message…
                    </Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Paper>
      )}
    </div>
  );
});
