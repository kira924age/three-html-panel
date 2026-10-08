import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { CHANNELS, SEED_MESSAGES, SEED_UNREAD, mentionHtml } from "../data/seed";
import type { Channel, Message } from "../data/types";
import { BOT, ME, userById } from "../data/users";
import { botReply } from "../lib/bot";
import { htmlToText, mentions } from "../lib/html";
import { useSettings } from "./settings";

interface ChatState {
  messages: Message[];
  activeId: string;
  unread: Record<string, number>;
  /** Who is typing, per channel. */
  typing: Record<string, string[]>;
  replyToId: string | null;
  editingId: string | null;
  /** A message to scroll to and flash (after a search). */
  highlightId: string | null;
}

type Action =
  | { type: "add"; message: Message }
  | { type: "edit"; id: string; html: string }
  | { type: "remove"; id: string }
  | { type: "react"; id: string; emoji: string; userId: string }
  | { type: "open"; channelId: string; highlightId?: string }
  | { type: "typing"; channelId: string; userId: string; on: boolean }
  | { type: "replyTo"; id: string | null }
  | { type: "editing"; id: string | null }
  | { type: "highlighted" };

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "add": {
      const { message } = action;
      const unread =
        message.channelId === state.activeId || message.userId === ME
          ? state.unread
          : { ...state.unread, [message.channelId]: (state.unread[message.channelId] ?? 0) + 1 };
      return { ...state, messages: [...state.messages, message], unread };
    }
    case "edit":
      return {
        ...state,
        editingId: null,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, html: action.html, editedAt: Date.now() } : m,
        ),
      };
    case "remove":
      return {
        ...state,
        replyToId: state.replyToId === action.id ? null : state.replyToId,
        messages: state.messages.filter((m) => m.id !== action.id),
      };
    case "react":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== action.id) return m;
          const existing = m.reactions.find((r) => r.emoji === action.emoji);
          let reactions;
          if (!existing)
            reactions = [...m.reactions, { emoji: action.emoji, users: [action.userId] }];
          else {
            const users = existing.users.includes(action.userId)
              ? existing.users.filter((u) => u !== action.userId)
              : [...existing.users, action.userId];
            reactions = m.reactions
              .map((r) => (r === existing ? { ...r, users } : r))
              .filter((r) => r.users.length > 0);
          }
          return { ...m, reactions };
        }),
      };
    case "open":
      return {
        ...state,
        activeId: action.channelId,
        unread: { ...state.unread, [action.channelId]: 0 },
        replyToId: action.channelId === state.activeId ? state.replyToId : null,
        editingId: null,
        highlightId: action.highlightId ?? null,
      };
    case "typing": {
      const current = state.typing[action.channelId] ?? [];
      const next = action.on
        ? [...new Set([...current, action.userId])]
        : current.filter((u) => u !== action.userId);
      return { ...state, typing: { ...state.typing, [action.channelId]: next } };
    }
    case "replyTo":
      return { ...state, replyToId: action.id, editingId: null };
    case "editing":
      return { ...state, editingId: action.id };
    case "highlighted":
      return { ...state, highlightId: null };
  }
}

export interface ChatApi extends ChatState {
  channels: Channel[];
  active: Channel;
  open: (channelId: string, highlightId?: string) => void;
  send: (html: string) => void;
  edit: (id: string, html: string) => void;
  remove: (id: string) => void;
  react: (id: string, emoji: string) => void;
  setReplyTo: (id: string | null) => void;
  setEditing: (id: string | null) => void;
  clearHighlight: () => void;
}

const ChatContext = createContext<ChatApi | null>(null);

let nextId = 1;
const newId = () => `m-new-${nextId++}`;

/** A channel's name to show: "#name" for a channel, the person's name for a DM. */
export const channelLabel = (channel: Channel): string =>
  channel.kind === "dm" ? userById(channel.name).name : `#${channel.name}`;

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    messages: SEED_MESSAGES,
    activeId: "c-general",
    unread: SEED_UNREAD,
    typing: {},
    replyToId: null,
    editingId: null,
    highlightId: null,
  }));
  const { settings } = useSettings();

  // What the timers' callbacks read when they fire.
  const latest = useRef({ state, settings });
  latest.current = { state, settings };
  const timers = useRef<number[]>([]);
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const scriptedMention = useRef(false);

  const open = useCallback((channelId: string, highlightId?: string) => {
    dispatch({ type: "open", channelId, highlightId });
  }, []);

  /** Adds someone else's message, and tells the user about it if it is elsewhere. */
  const receive = useCallback((message: Message) => {
    dispatch({ type: "add", message });
    const { state: s, settings: prefs } = latest.current;
    if (message.channelId === s.activeId || !prefs.toasts || prefs.notifyLevel === "nothing")
      return;
    const mentioned = mentions(message.html, ME);
    if (prefs.notifyLevel === "mentions" && !mentioned) return;
    if (message.userId === BOT && !mentioned && !prefs.botNotifications) return;
    const channel = CHANNELS.find((c) => c.id === message.channelId)!;
    const author = userById(message.userId);
    const id = `toast-${message.id}`;
    notifications.show({
      id,
      color: mentioned ? "red" : undefined,
      title: mentioned
        ? `${author.name} mentioned you in ${channelLabel(channel)}`
        : `${author.name} in ${channelLabel(channel)}`,
      message: (
        <>
          <Text size="sm" lineClamp={2}>
            {htmlToText(message.html)}
          </Text>
          <Group justify="flex-end" mt={6}>
            <Button
              size="compact-xs"
              variant="light"
              onClick={() => {
                notifications.hide(id);
                dispatch({ type: "open", channelId: message.channelId, highlightId: message.id });
              }}
            >
              Open
            </Button>
          </Group>
        </>
      ),
      autoClose: 7000,
    });
  }, []);

  const send = useCallback(
    (html: string) => {
      const { state: s } = latest.current;
      const channelId = s.activeId;
      const message: Message = {
        id: newId(),
        channelId,
        userId: ME,
        html,
        createdAt: Date.now(),
        reactions: [],
        replyTo: s.replyToId ?? undefined,
      };
      dispatch({ type: "add", message });
      dispatch({ type: "replyTo", id: null });

      // Kit answers, after "typing" for a moment.
      const text = htmlToText(html);
      later(500, () => dispatch({ type: "typing", channelId, userId: BOT, on: true }));
      later(1700 + Math.min(text.length * 15, 1200), () => {
        dispatch({ type: "typing", channelId, userId: BOT, on: false });
        receive({
          id: newId(),
          channelId,
          userId: BOT,
          html: botReply(text, ME),
          createdAt: Date.now(),
          reactions: [],
        });
      });

      // Once, someone mentions the user in another channel.
      if (!scriptedMention.current) {
        scriptedMention.current = true;
        const elsewhere = channelId === "c-design" ? "c-engineering" : "c-design";
        const author = elsewhere === "c-design" ? "u-mika" : "u-lena";
        later(4500, () =>
          dispatch({ type: "typing", channelId: elsewhere, userId: author, on: true }),
        );
        later(6500, () => {
          dispatch({ type: "typing", channelId: elsewhere, userId: author, on: false });
          receive({
            id: newId(),
            channelId: elsewhere,
            userId: author,
            html: `<p>${mentionHtml(ME)} could you take a quick look at this when you have a sec? 🙏</p>`,
            createdAt: Date.now(),
            reactions: [],
          });
        });
      }
    },
    [receive],
  );

  const api = useMemo<ChatApi>(
    () => ({
      ...state,
      channels: CHANNELS,
      active: CHANNELS.find((c) => c.id === state.activeId)!,
      open,
      send,
      edit: (id, html) => dispatch({ type: "edit", id, html }),
      remove: (id) => dispatch({ type: "remove", id }),
      react: (id, emoji) => dispatch({ type: "react", id, emoji, userId: ME }),
      setReplyTo: (id) => dispatch({ type: "replyTo", id }),
      setEditing: (id) => dispatch({ type: "editing", id }),
      clearHighlight: () => dispatch({ type: "highlighted" }),
    }),
    [state, open, send],
  );

  return <ChatContext.Provider value={api}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatApi {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat outside ChatProvider");
  return value;
}
