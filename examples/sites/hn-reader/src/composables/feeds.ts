import { computed, reactive } from "vue";
import { fetchFeedIds, fetchItems, type Feed, type Item } from "../api/hn";
import { listOptions, settings } from "./settings";

interface FeedState {
  ids: number[];
  items: Item[];
  /** How many of the ids have been loaded (some may have been dropped as dead). */
  loaded: number;
  status: "idle" | "loading" | "ready" | "error";
  updated: number;
}

const states = reactive(new Map<Feed, FeedState>()) as Map<Feed, FeedState>;

export function feedState(feed: Feed): FeedState {
  let state = states.get(feed);
  if (!state) {
    states.set(feed, { ids: [], items: [], loaded: 0, status: "idle", updated: 0 });
    state = states.get(feed)!;
  }
  return state;
}

/** Loads the feed's ids, then its first page. */
export async function loadFeed(feed: Feed): Promise<void> {
  const state = feedState(feed);
  state.status = "loading";
  try {
    const ids = await fetchFeedIds(feed);
    const first = await fetchItems(ids.slice(0, settings.pageSize));
    Object.assign(state, {
      ids,
      items: first,
      loaded: settings.pageSize,
      status: "ready",
      updated: Date.now(),
    });
  } catch (error) {
    state.status = "error";
    throw error;
  }
}

/** Loads the next page; false when there is no more. */
export async function loadMore(feed: Feed): Promise<boolean> {
  const state = feedState(feed);
  if (state.status !== "ready") return true;
  if (state.loaded >= state.ids.length) return false;
  const next = state.ids.slice(state.loaded, state.loaded + settings.pageSize);
  const items = await fetchItems(next);
  state.loaded += next.length;
  const seen = new Set(state.items.map((i) => i.id));
  state.items.push(...items.filter((i) => !seen.has(i.id)));
  return state.loaded < state.ids.length;
}

/** Reloads the feed from the top, fresh; how many stories are new in the first page. */
export async function refreshFeed(feed: Feed): Promise<number> {
  const state = feedState(feed);
  const before = new Set(state.items.map((i) => i.id));
  const ids = await fetchFeedIds(feed);
  const first = await fetchItems(ids.slice(0, settings.pageSize), { fresh: true });
  Object.assign(state, {
    ids,
    items: first,
    loaded: settings.pageSize,
    status: "ready",
    updated: Date.now(),
  });
  return first.filter((i) => !before.has(i.id)).length;
}

/** The feed's loaded stories, sorted and filtered as the sort menu says. */
export function useFeedItems(feed: () => Feed) {
  return computed(() => {
    const state = feedState(feed());
    const rank = new Map(state.ids.map((id, i) => [id, i + 1]));
    let list = state.items.map((item) => ({ item, rank: rank.get(item.id) ?? 0 }));
    if (listOptions.minScore > 0)
      list = list.filter(({ item }) => (item.score ?? 0) >= listOptions.minScore);
    if (listOptions.linksOnly) list = list.filter(({ item }) => !!item.url);
    const by: Record<string, (e: { item: Item; rank: number }) => number> = {
      rank: (e) => e.rank,
      score: (e) => -(e.item.score ?? 0),
      comments: (e) => -(e.item.descendants ?? 0),
      time: (e) => -e.item.time,
    };
    const key = by[listOptions.sort];
    return [...list].sort((a, b) => key(a) - key(b));
  });
}
