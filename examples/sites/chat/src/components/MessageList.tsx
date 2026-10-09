import {
  Button,
  Divider,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Transition,
} from "@mantine/core";
import { IconArrowDown, IconHash, IconLock } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Message } from "../data/types";
import { ME } from "../data/users";
import { channelLabel, useChat } from "../hooks/chat";
import { useUsers } from "../hooks/users";
import { dayKey, dayLabel } from "../lib/time";
import { DeleteMessageModal } from "./DeleteMessageModal";
import { MessageItem } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { UserAvatar } from "./UserAvatar";
import classes from "./MessageList.module.css";

/** Messages by the same author within this long are grouped (no avatar and name). */
const GROUP_WINDOW = 5 * 60 * 1000;
/** How close to the bottom counts as "at the bottom" (px). */
const STICKY_THRESHOLD = 48;

export function MessageList() {
  const chat = useChat();
  const user = useUsers();
  const viewport = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [deleting, setDeleting] = useState<Message | null>(null);

  const messages = useMemo(
    () =>
      chat.messages
        .filter((m) => m.channelId === chat.activeId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [chat.messages, chat.activeId],
  );
  const days = useMemo(() => {
    const out: { key: string; messages: Message[] }[] = [];
    for (const message of messages) {
      const key = dayKey(message.createdAt);
      if (out.at(-1)?.key === key) out.at(-1)!.messages.push(message);
      else out.push({ key, messages: [message] });
    }
    return out;
  }, [messages]);
  const typing = chat.typing[chat.activeId] ?? [];
  const last = messages.at(-1);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = viewport.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    atBottom.current = true;
    setShowJump(false);
    setNewCount(0);
  };

  // A channel opens at its latest message (or at the message searched for).
  const shownChannel = useRef<string | null>(null);
  const shownLast = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const switched = shownChannel.current !== chat.activeId;
    const arrived = !switched && last && last.id !== shownLast.current;
    shownChannel.current = chat.activeId;
    shownLast.current = last?.id;
    if (switched) {
      if (!chat.highlightId) scrollToBottom();
      return;
    }
    if (arrived) {
      // Stick to the bottom if there already, or if it's the user's own message.
      if (atBottom.current || last.userId === ME) scrollToBottom("smooth");
      else setNewCount((n) => n + 1);
    }
  }, [chat.activeId, last?.id]);

  // Stay at the bottom while the content's height changes (fonts, edits, reactions), or
  // the list's own (the composer grows).
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
    });
    observer.observe(el);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);

  // Scroll to a message found by search, and flash it.
  useEffect(() => {
    if (!chat.highlightId) return;
    const el = viewport.current?.querySelector(`[data-message-id="${chat.highlightId}"]`);
    el?.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => chat.clearHighlight(), 2500);
    return () => clearTimeout(timer);
  }, [chat.highlightId]);

  const onScroll = () => {
    const el = viewport.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD;
    atBottom.current = bottom;
    setShowJump(!bottom);
    if (bottom) setNewCount(0);
  };

  const channel = chat.active;
  const dmUser = channel.kind === "dm" ? user(channel.name) : null;

  return (
    <div className={classes.root}>
      <ScrollArea
        className={classes.scroll}
        viewportRef={viewport}
        onScrollPositionChange={onScroll}
        type="hover"
        scrollbarSize={8}
      >
        <div className={classes.inner} ref={inner}>
          <Stack gap={6} className={classes.intro}>
            {dmUser ? (
              <>
                <UserAvatar user={dmUser} size={64} />
                <Title order={3}>{dmUser.name}</Title>
                <Text size="sm" c="dimmed">
                  This is the beginning of your direct message history with <b>{dmUser.name}</b>.{" "}
                  {dmUser.title}.
                </Text>
              </>
            ) : (
              <>
                <ThemeIcon size={48} radius="md" variant="light">
                  {channel.private ? <IconLock size={26} /> : <IconHash size={26} />}
                </ThemeIcon>
                <Title order={3}>{channelLabel(channel)}</Title>
                <Text size="sm" c="dimmed">
                  This is the very beginning of the <b>{channelLabel(channel)}</b> channel.{" "}
                  {channel.topic}
                </Text>
              </>
            )}
          </Stack>

          {days.map((day) => (
            // A section per day, so that each day's sticky divider stays within its day.
            <section key={day.key} aria-label={dayLabel(day.messages[0].createdAt)}>
              <Divider
                className={classes.day}
                labelPosition="center"
                label={
                  <span className={classes.dayLabel}>{dayLabel(day.messages[0].createdAt)}</span>
                }
              />
              {day.messages.map((message, i) => {
                const prev = day.messages[i - 1];
                const continued =
                  !!prev &&
                  !message.replyTo &&
                  prev.userId === message.userId &&
                  message.createdAt - prev.createdAt < GROUP_WINDOW;
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    continued={continued}
                    editing={chat.editingId === message.id}
                    highlighted={chat.highlightId === message.id}
                    onDelete={setDeleting}
                  />
                );
              })}
            </section>
          ))}
        </div>
      </ScrollArea>

      <TypingIndicator userIds={typing} />

      <Transition mounted={showJump} transition="slide-up" duration={150}>
        {(styles) => (
          <Button
            style={styles}
            className={classes.jump}
            size="compact-sm"
            radius="xl"
            leftSection={<IconArrowDown size={14} />}
            onClick={() => scrollToBottom("smooth")}
          >
            {newCount > 0 ? `${newCount} new message${newCount > 1 ? "s" : ""}` : "Jump to latest"}
          </Button>
        )}
      </Transition>

      <DeleteMessageModal
        message={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={(m) => {
          chat.remove(m.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
