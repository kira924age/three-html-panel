export type Presence = "active" | "away" | "dnd" | "offline";

export interface User {
  id: string;
  name: string;
  /** The handle shown after "@". */
  handle: string;
  title: string;
  color: string;
  presence: Presence;
  bot?: boolean;
}

export interface Channel {
  id: string;
  kind: "channel" | "dm";
  /** For a channel, its name (without "#"); for a DM, the other user's id. */
  name: string;
  topic: string;
  private?: boolean;
  members: string[];
}

export interface Reaction {
  emoji: string;
  users: string[];
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  /** The message's body as HTML (what the rich text editor produces). */
  html: string;
  createdAt: number;
  editedAt?: number;
  reactions: Reaction[];
  /** The message this one replies to. */
  replyTo?: string;
}
