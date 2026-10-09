/** The plain text of a message's HTML (for search, previews and the bot). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Block elements end with a space, so that words of adjacent blocks don't run together.
  doc.querySelectorAll("p, li, pre, br").forEach((el) => el.append(" "));
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Whether the message's HTML mentions the user. */
export function mentions(html: string, userId: string): boolean {
  return html.includes(`data-id="${userId}"`);
}

/** Whether the editor's HTML has no content worth sending. */
export function isEmptyHtml(html: string): boolean {
  if (/<(img|pre|li)[\s>]/.test(html) || html.includes('data-type="mention"')) return false;
  return htmlToText(html).length === 0;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
