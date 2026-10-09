/** A small curated set of emoji for the picker, by category. */
export const EMOJI_GROUPS: { label: string; emoji: string[] }[] = [
  {
    label: "Smileys",
    emoji: [
      "😀",
      "😄",
      "😂",
      "🥲",
      "😊",
      "😍",
      "🤔",
      "😎",
      "🥳",
      "😅",
      "😭",
      "😤",
      "🙃",
      "😴",
      "🤯",
      "🫠",
    ],
  },
  {
    label: "Gestures",
    emoji: ["👍", "👎", "👏", "🙌", "🙏", "👋", "🤝", "💪", "🤌", "✌️", "👀", "🙋"],
  },
  {
    label: "Objects",
    emoji: [
      "🎉",
      "🔥",
      "🚀",
      "✅",
      "❌",
      "⚠️",
      "💡",
      "📌",
      "📄",
      "🐛",
      "☕",
      "🍜",
      "🌱",
      "❤️",
      "⭐",
      "💯",
    ],
  },
];

/** The emoji offered first for a quick reaction. */
export const QUICK_REACTIONS = ["👍", "🎉", "😂", "👀", "🙏", "✅"];
