import type { Item, SearchHit } from "./hn";

/** What a story card shows, from a feed's item or a search hit. */
export interface StorySummary {
  id: number;
  title: string;
  url: string | null;
  by: string | null;
  score: number;
  comments: number;
  time: number;
  kind: Item["type"];
}

export function fromItem(item: Item): StorySummary {
  return {
    id: item.id,
    title: item.title ?? "(untitled)",
    url: item.url ?? null,
    by: item.by ?? null,
    score: item.score ?? 0,
    comments: item.descendants ?? 0,
    time: item.time,
    kind: item.type,
  };
}

export function fromHit(hit: SearchHit): StorySummary {
  return {
    id: hit.id,
    title: hit.title || "(untitled)",
    url: hit.url,
    by: hit.author,
    score: hit.points ?? 0,
    comments: hit.comments ?? 0,
    time: hit.time,
    kind: "story",
  };
}
