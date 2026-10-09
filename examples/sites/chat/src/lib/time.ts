const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** The day divider's label: "Today", "Yesterday", or the date. */
export function dayLabel(time: number): string {
  const date = new Date(time);
  const now = new Date();
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export const dayKey = (time: number): string => new Date(time).toDateString();

export const shortTime = (time: number): string =>
  new Date(time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export const fullTime = (time: number): string =>
  new Date(time).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
