import { reactive } from "vue";
import type { Feed } from "../api/hn";

export type View = "feed" | "story" | "search";

interface NavigationState {
  view: View;
  feed: Feed;
  storyId: number | null;
  /** The view to go back to from a story. */
  from: View;
  query: string;
}

export const navigation = reactive<NavigationState>({
  view: "feed",
  feed: "top",
  storyId: null,
  from: "feed",
  query: "",
});

// The window's scroll position of each list, to come back where one was.
const scrolls = new Map<string, number>();
const key = () => (navigation.view === "feed" ? `feed:${navigation.feed}` : navigation.view);

function restore(): void {
  const y = scrolls.get(key()) ?? 0;
  // After the list is rendered again.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" })),
  );
}

export function openFeed(feed: Feed): void {
  if (navigation.view !== "story") scrolls.set(key(), window.scrollY);
  const same = navigation.view === "feed" && navigation.feed === feed;
  navigation.view = "feed";
  navigation.feed = feed;
  if (same) window.scrollTo({ top: 0, behavior: "smooth" });
  else restore();
}

export function openStory(id: number): void {
  if (navigation.view !== "story") {
    scrolls.set(key(), window.scrollY);
    navigation.from = navigation.view;
  }
  navigation.storyId = id;
  navigation.view = "story";
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function openSearch(query: string): void {
  if (navigation.view === "feed") scrolls.set(key(), window.scrollY);
  navigation.query = query;
  if (navigation.view !== "search") {
    navigation.view = "search";
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

export function goBack(): void {
  navigation.view = navigation.from === "story" ? "feed" : navigation.from;
  restore();
}
