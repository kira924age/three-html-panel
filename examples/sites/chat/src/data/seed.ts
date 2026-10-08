import type { Channel, Message } from "./types";
import { BOT, ME, userById } from "./users";

export const CHANNELS: Channel[] = [
  {
    id: "c-general",
    kind: "channel",
    name: "general",
    topic: "Company-wide announcements and work-based matters",
    members: ["u-me", "u-mika", "u-sam", "u-lena", "u-yuki", "u-diego", "u-kit"],
  },
  {
    id: "c-engineering",
    kind: "channel",
    name: "engineering",
    topic: "Builds, reviews and the occasional fire 🔥",
    members: ["u-me", "u-sam", "u-lena", "u-yuki", "u-kit"],
  },
  {
    id: "c-design",
    kind: "channel",
    name: "design",
    topic: "Figma links, critiques and pixel pushing",
    members: ["u-me", "u-mika", "u-diego", "u-kit"],
  },
  {
    id: "c-tokyo",
    kind: "channel",
    name: "tokyo-office",
    topic: "東京オフィスの雑談とお知らせ",
    members: ["u-me", "u-yuki", "u-mika", "u-kit"],
  },
  {
    id: "c-release",
    kind: "channel",
    name: "release-2-0",
    topic: "Shipping v2.0 on Friday",
    private: true,
    members: ["u-me", "u-sam", "u-lena", "u-kit"],
  },
  {
    id: "c-random",
    kind: "channel",
    name: "random",
    topic: "Non-work banter and water cooler conversation",
    members: ["u-me", "u-mika", "u-sam", "u-lena", "u-yuki", "u-diego", "u-kit"],
  },
  {
    id: "d-kit",
    kind: "dm",
    name: BOT,
    topic: "Ask me anything about the workspace",
    members: [ME, BOT],
  },
  { id: "d-mika", kind: "dm", name: "u-mika", topic: "", members: [ME, "u-mika"] },
  { id: "d-sam", kind: "dm", name: "u-sam", topic: "", members: [ME, "u-sam"] },
  { id: "d-yuki", kind: "dm", name: "u-yuki", topic: "", members: [ME, "u-yuki"] },
];

/** The HTML the editor's mention extension produces for a user. */
export const mentionHtml = (userId: string): string => {
  const user = userById(userId);
  return `<span data-type="mention" class="mention" data-id="${user.id}" data-label="${user.handle}">@${user.handle}</span>`;
};

const m = mentionHtml;
const DAY = 24 * 60 * 60 * 1000;

/** A time `daysAgo` days before today, at hh:mm local time. */
const at = (daysAgo: number, hh: number, mm: number): number => {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.getTime() - daysAgo * DAY;
};

/** Today's seeded messages must be in the past, whatever the time now. */
const today = (hh: number, mm: number): number =>
  Math.min(at(0, hh, mm), Date.now() - (24 - hh) * 60_000);

let seq = 0;
const msg = (
  channelId: string,
  userId: string,
  createdAt: number,
  html: string,
  extra: Partial<Message> = {},
): Message => ({ id: `m-${++seq}`, channelId, userId, createdAt, html, reactions: [], ...extra });

export const SEED_MESSAGES: Message[] = [
  // #general
  msg(
    "c-general",
    "u-sam",
    at(3, 9, 2),
    "<p>Morning all! Quick reminder that the all-hands moved to <strong>Thursday 15:00</strong>. Agenda is in the doc 📄</p>",
    {
      reactions: [{ emoji: "👍", users: ["u-mika", "u-lena", "u-yuki"] }],
    },
  ),
  msg(
    "c-general",
    "u-diego",
    at(3, 9, 15),
    `<p>Thanks ${m("u-sam")}! I'll demo the new onboarding flow if there's time.</p>`,
  ),
  msg(
    "c-general",
    "u-mika",
    at(1, 10, 41),
    '<p>New brand guidelines are live: <a href="https://example.com/brand">example.com/brand</a> — please use the updated logo in decks from now on.</p>',
    {
      reactions: [
        { emoji: "🎉", users: ["u-me", "u-sam", "u-diego"] },
        { emoji: "😍", users: ["u-yuki"] },
      ],
    },
  ),
  msg(
    "c-general",
    "u-lena",
    at(1, 11, 3),
    "<p>Looks great. Is there a dark-mode variant of the wordmark?</p>",
  ),
  msg("c-general", "u-mika", at(1, 11, 6), "<p>Yes! It's on page 4. Both SVG and PNG.</p>"),
  msg(
    "c-general",
    "u-yuki",
    today(9, 12),
    "<p>おはようございます！今日は東京オフィスからリモートで参加します 🗼</p>",
    {
      reactions: [{ emoji: "👋", users: ["u-mika", "u-me"] }],
    },
  ),
  msg(
    "c-general",
    "u-sam",
    today(9, 30),
    `<p>Heads up ${m(ME)} ${m("u-lena")}: we're freezing the <code>main</code> branch at noon for the release cut.</p>`,
  ),
  msg(
    "c-general",
    BOT,
    today(9, 31),
    "<p>📌 I pinned the release checklist to <strong>#release-2-0</strong>. Type <code>Ctrl+K</code> to jump there.</p>",
  ),

  // #engineering
  msg(
    "c-engineering",
    "u-lena",
    at(2, 14, 20),
    "<p>The flaky test in <code>checkout.spec.ts</code> was a race between two fetches. Fix:</p><pre><code>await Promise.all([\n  loadCart(userId),\n  loadPrices(region),\n]);</code></pre>",
    {
      reactions: [{ emoji: "🙌", users: ["u-me", "u-sam"] }],
    },
  ),
  msg(
    "c-engineering",
    ME,
    at(2, 14, 26),
    "<p>Nice catch. Can we also add a retry with backoff to the price service client?</p>",
  ),
  msg(
    "c-engineering",
    "u-lena",
    at(2, 14, 31),
    "<p>Sure, opening a PR. Plan:</p><ol><li>Wrap the client in <code>withRetry()</code></li><li>Exponential backoff, max 3 attempts</li><li>Log the final failure to Sentry</li></ol>",
  ),
  msg(
    "c-engineering",
    "u-sam",
    at(1, 16, 5),
    "<p>Build times went from <strong>11 min</strong> to <strong>4 min</strong> after the cache change. 🚀 Great work everyone.</p>",
    {
      reactions: [
        { emoji: "🚀", users: ["u-me", "u-lena", "u-yuki"] },
        { emoji: "🔥", users: ["u-lena"] },
      ],
    },
  ),
  msg(
    "c-engineering",
    "u-yuki",
    today(10, 2),
    `<p>${m(ME)} 回帰テストで 1 件失敗しています。Safari だけで再現します:</p><ul><li>ログイン後にトーストが二重に表示される</li><li>iOS 18 / macOS 15 で確認</li></ul>`,
  ),
  msg(
    "c-engineering",
    ME,
    today(10, 8),
    "<p>Thanks Yuki, looking now. Probably the <em>StrictMode</em> double effect.</p>",
  ),

  // #design
  msg(
    "c-design",
    "u-mika",
    at(1, 13, 0),
    "<p>Critique at 3? I want eyes on the new empty states.</p><ul><li>Inbox zero</li><li>No search results</li><li>First-run</li></ul>",
  ),
  msg(
    "c-design",
    "u-diego",
    at(1, 13, 12),
    "<p>I'm in. The illustrations are <em>chef's kiss</em> 🤌</p>",
    {
      reactions: [{ emoji: "😂", users: ["u-mika"] }],
    },
  ),
  msg(
    "c-design",
    "u-mika",
    today(8, 50),
    "<p>Updated the spacing scale to 4/8/12/16/24/32. Tokens are synced to the repo.</p>",
  ),

  // #tokyo-office
  msg("c-tokyo", "u-yuki", at(2, 12, 5), "<p>今日のランチはラーメンに行きませんか？🍜</p>", {
    reactions: [{ emoji: "🙋", users: ["u-mika", "u-me"] }],
  }),
  msg("c-tokyo", "u-mika", at(2, 12, 7), "<p>行きます！駅前の新しいお店が気になってます。</p>"),
  msg(
    "c-tokyo",
    "u-yuki",
    today(9, 0),
    "<p>来週の金曜日はオフィスの大掃除です。<strong>17:00</strong> までに私物を片付けてください 🧹</p>",
  ),

  // #release-2-0
  msg(
    "c-release",
    "u-sam",
    at(1, 9, 0),
    "<p><strong>Release checklist</strong></p><ol><li>Cut the release branch</li><li>Run the full e2e suite</li><li>Update the changelog</li><li>Ship to 5% → 50% → 100%</li></ol>",
  ),
  msg(
    "c-release",
    "u-lena",
    at(1, 9, 20),
    "<p>Migrations are ready. Dry run took 42s on a prod snapshot.</p>",
    {
      reactions: [{ emoji: "✅", users: ["u-sam", "u-me"] }],
    },
  ),

  // #random
  msg(
    "c-random",
    "u-diego",
    at(4, 17, 30),
    '<p>Anyone else watching the eclipse livestream? <a href="https://example.com/eclipse">example.com/eclipse</a></p>',
  ),
  msg("c-random", "u-lena", at(4, 17, 33), "<p>Watching from the roof 🌒</p>"),
  msg(
    "c-random",
    "u-mika",
    at(1, 8, 45),
    "<p>Office plant update: the monstera has a new leaf 🌱</p>",
    {
      reactions: [
        { emoji: "🌱", users: ["u-sam", "u-lena", "u-me", "u-yuki", "u-diego"] },
        { emoji: "❤️", users: ["u-yuki"] },
      ],
    },
  ),

  // DMs
  msg(
    "d-kit",
    BOT,
    at(0, 0, 0) - DAY / 2,
    `<p>Hi ${m(ME)} 👋 I'm Kit, your workspace assistant. Try asking me about <strong>shortcuts</strong>, <strong>formatting</strong> or the <strong>release</strong>.</p>`,
  ),
  msg(
    "d-mika",
    "u-mika",
    at(1, 18, 2),
    "<p>Do you have a minute tomorrow to pair on the composer toolbar?</p>",
  ),
  msg("d-mika", ME, at(1, 18, 10), "<p>Sure, 11:00 works 👍</p>"),
  msg(
    "d-sam",
    "u-sam",
    today(9, 45),
    "<p>Can you own the release notes this time? Happy to review.</p>",
  ),
  msg(
    "d-yuki",
    "u-yuki",
    at(2, 19, 0),
    "<p>お疲れさまでした！テスト環境のアカウントを共有しました。</p>",
  ),
];

/** Unread counts at the start, per channel. */
export const SEED_UNREAD: Record<string, number> = {
  "c-engineering": 2,
  "c-design": 1,
  "c-tokyo": 1,
  "d-sam": 1,
};
