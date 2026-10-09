const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", from a Unix time in seconds. */
export function timeAgo(seconds: number, now = Date.now()): string {
  const elapsed = now / 1000 - seconds;
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return relative.format(-Math.floor(elapsed / size), unit);
  }
  return "just now";
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const fullFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function formatDate(seconds: number): string {
  return dateFormat.format(seconds * 1000);
}

export function formatDateTime(seconds: number): string {
  return fullFormat.format(seconds * 1000);
}

/** "github.com" from a URL, without "www.". */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const compact = new Intl.NumberFormat("en", { notation: "compact" });

export function formatCount(n: number): string {
  return n < 1000 ? String(n) : compact.format(n);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${formatCount(n)} ${n === 1 ? word : many}`;
}

export function hnLink(id: number | string, kind: "item" | "user" = "item"): string {
  return `https://news.ycombinator.com/${kind}?id=${encodeURIComponent(id)}`;
}
