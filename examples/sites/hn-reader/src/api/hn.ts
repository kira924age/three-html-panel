// A small client for the official Hacker News API (Firebase) and Algolia's HN
// search API. Both send `Access-Control-Allow-Origin: *`, so they work from any
// origin, including the opaque one of a sandboxed page. Caches live in memory.

const HN = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA = "https://hn.algolia.com/api/v1";

export type Feed = "top" | "new" | "best" | "ask" | "show";

export interface Item {
  id: number;
  type: "story" | "comment" | "job" | "poll" | "pollopt";
  by?: string;
  time: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
}

export interface User {
  id: string;
  created: number;
  karma: number;
  about?: string;
  submitted?: number[];
}

/** A comment of a thread, with its replies (from Algolia's items endpoint). */
export interface ThreadNode {
  id: number;
  author: string | null;
  text: string | null;
  time: number;
  children: ThreadNode[];
}

export interface SearchHit {
  id: number;
  title: string;
  url: string | null;
  author: string;
  points: number | null;
  comments: number | null;
  time: number;
  /** For a comment: its text (HTML) and the story it is on. */
  text: string | null;
  storyId: number | null;
  storyTitle: string | null;
}

export interface SearchPage {
  hits: SearchHit[];
  total: number;
  page: number;
  pages: number;
}

export class ApiError extends Error {}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("Network error: could not reach the server.");
  }
  if (!response.ok) throw new ApiError(`The server answered ${response.status}.`);
  return (await response.json()) as T;
}

/** The ids of a feed's stories, in rank order (up to 500). */
export function fetchFeedIds(feed: Feed): Promise<number[]> {
  return getJSON<number[]>(`${HN}/${feed}stories.json`);
}

const items = new Map<number, Promise<Item | null>>();

export function fetchItem(id: number, { fresh = false } = {}): Promise<Item | null> {
  let item = fresh ? undefined : items.get(id);
  if (!item) {
    item = getJSON<Item | null>(`${HN}/item/${id}.json`);
    items.set(id, item);
    // Not cached when it fails, so that it is tried again.
    item.catch(() => items.delete(id));
  }
  return item;
}

/** The items, in the same order, without the ones deleted or dead. */
export async function fetchItems(ids: number[], options?: { fresh?: boolean }): Promise<Item[]> {
  const loaded = await Promise.all(ids.map((id) => fetchItem(id, options)));
  return loaded.filter((item): item is Item => !!item && !item.deleted && !item.dead);
}

const users = new Map<string, Promise<User | null>>();

export function fetchUser(id: string): Promise<User | null> {
  let user = users.get(id);
  if (!user) {
    user = getJSON<User | null>(`${HN}/user/${encodeURIComponent(id)}.json`);
    users.set(id, user);
    user.catch(() => users.delete(id));
  }
  return user;
}

interface AlgoliaItem {
  id: number;
  author: string | null;
  text: string | null;
  created_at_i: number;
  children: AlgoliaItem[];
}

function toThread(item: AlgoliaItem): ThreadNode {
  return {
    id: item.id,
    author: item.author,
    text: item.text,
    time: item.created_at_i,
    // Algolia keeps deleted comments as empty nodes: drop the ones without replies.
    children: item.children.map(toThread).filter((c) => c.author || c.children.length),
  };
}

/** A story's whole comment tree, in one request. */
export async function fetchThread(id: number, signal?: AbortSignal): Promise<ThreadNode[]> {
  const item = await getJSON<AlgoliaItem>(`${ALGOLIA}/items/${id}`, signal);
  return toThread(item).children;
}

export type SearchSort = "relevance" | "date";
export type SearchKind = "story" | "comment";

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string;
  points: number | null;
  num_comments: number | null;
  created_at_i: number;
  story_text?: string | null;
  comment_text?: string | null;
  story_id?: number | null;
  story_title?: string | null;
}

export async function search(
  query: string,
  {
    sort,
    kind,
    page = 0,
    signal,
  }: { sort: SearchSort; kind: SearchKind; page?: number; signal?: AbortSignal },
): Promise<SearchPage> {
  const endpoint = sort === "date" ? "search_by_date" : "search";
  const params = new URLSearchParams({ query, tags: kind, page: String(page), hitsPerPage: "20" });
  const result = await getJSON<{
    hits: AlgoliaHit[];
    nbHits: number;
    page: number;
    nbPages: number;
  }>(`${ALGOLIA}/${endpoint}?${params}`, signal);
  return {
    total: result.nbHits,
    page: result.page,
    pages: result.nbPages,
    hits: result.hits.map((hit) => ({
      id: Number(hit.objectID),
      title: hit.title ?? hit.story_title ?? "",
      url: hit.url,
      author: hit.author,
      points: hit.points,
      comments: hit.num_comments,
      time: hit.created_at_i,
      text: hit.comment_text ?? hit.story_text ?? null,
      storyId: hit.story_id ?? null,
      storyTitle: hit.story_title ?? null,
    })),
  };
}
