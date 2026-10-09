import type { User } from "./types";

/** The person using the app. */
export const ME = "u-me";
/** The workspace's bot, which answers messages. */
export const BOT = "u-kit";

export const USERS: User[] = [
  {
    id: ME,
    name: "Alex Rivera",
    handle: "alex",
    title: "Frontend engineer",
    color: "blue",
    presence: "active",
  },
  {
    id: "u-mika",
    name: "Mika Tanaka",
    handle: "mika",
    title: "Product designer",
    color: "pink",
    presence: "active",
  },
  {
    id: "u-sam",
    name: "Sam Okafor",
    handle: "sam",
    title: "Engineering manager",
    color: "teal",
    presence: "away",
  },
  {
    id: "u-lena",
    name: "Lena Fischer",
    handle: "lena",
    title: "Backend engineer",
    color: "grape",
    presence: "dnd",
  },
  {
    id: "u-yuki",
    name: "佐藤 ゆき",
    handle: "yuki",
    title: "QA エンジニア",
    color: "orange",
    presence: "active",
  },
  {
    id: "u-diego",
    name: "Diego Alvarez",
    handle: "diego",
    title: "Developer relations",
    color: "lime",
    presence: "offline",
  },
  {
    id: BOT,
    name: "Kit",
    handle: "kit",
    title: "Workspace assistant",
    color: "violet",
    presence: "active",
    bot: true,
  },
];

export const userById = (id: string): User => USERS.find((u) => u.id === id) ?? USERS[0];

export const initials = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const PRESENCE_LABEL: Record<User["presence"], string> = {
  active: "Active",
  away: "Away",
  dnd: "Do not disturb",
  offline: "Offline",
};

export const PRESENCE_COLOR: Record<User["presence"], string> = {
  active: "green",
  away: "yellow",
  dnd: "red",
  offline: "gray",
};
