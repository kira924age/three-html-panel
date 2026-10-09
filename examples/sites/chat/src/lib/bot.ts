import { mentionHtml } from "../data/seed";
import { escapeHtml } from "./html";

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

/** Kit's answer to a message (plain text in, HTML out). */
export function botReply(text: string, authorId: string): string {
  const t = text.toLowerCase();
  const you = mentionHtml(authorId);
  if (/shortcut|hotkey|keyboard|ショートカット/.test(t)) {
    return `<p>Here are the shortcuts I know, ${you}:</p><ul><li><code>Ctrl/⌘ + K</code> — command palette</li><li><code>Enter</code> — send, <code>Shift + Enter</code> — new line</li><li><code>Ctrl/⌘ + B / I</code> — bold / italic</li><li><code>@</code> — mention someone</li></ul>`;
  }
  if (/format|markdown|code|bold/.test(t)) {
    return `<p>You can format with the toolbar or shortcuts. Code blocks work too:</p><pre><code>function greet(name) {\n  return \`Hello, \${name}!\`;\n}</code></pre>`;
  }
  if (/release|ship|deploy|v2/.test(t)) {
    return `<p>🚢 Release <strong>v2.0</strong> is on track for Friday. 3 of 4 checklist items are done — the changelog is still open.</p>`;
  }
  if (/[぀-ヿ一-龯]/.test(text)) {
    return pick([
      `<p>了解しました、${you} さん！他に手伝えることはありますか？ 🙂</p>`,
      "<p>ありがとうございます！メモしておきますね 📝</p>",
    ]);
  }
  if (/\b(hi|hello|hey|morning)\b/.test(t)) {
    return pick([
      `<p>Hey ${you}! 👋 How can I help?</p>`,
      `<p>Hello ${you}! Hope your day is going well ☀️</p>`,
    ]);
  }
  if (/thank|thx|ty\b/.test(t)) return pick(["<p>Any time! 🙌</p>", "<p>Happy to help 😊</p>"]);
  if (t.endsWith("?")) {
    return pick([
      "<p>Good question 🤔 I'd check with <strong>#engineering</strong> — someone there will know.</p>",
      `<p>I'm not sure, ${you}, but I've noted it for the next standup 📌</p>`,
    ]);
  }
  const quote = escapeHtml(text.length > 60 ? `${text.slice(0, 57)}…` : text);
  return pick([
    `<p>Got it 👍 — “${quote}”</p>`,
    "<p>Noted! I'll keep that in mind ✍️</p>",
    `<p>Thanks for sharing, ${you} 🙏</p>`,
  ]);
}
