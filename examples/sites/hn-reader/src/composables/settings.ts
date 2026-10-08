import { reactive } from "vue";

export type ThemeChoice = "light" | "dark" | "system";
export type SortOrder = "rank" | "score" | "comments" | "time";

/** The reader's settings. In memory only: a sandboxed page has no storage. */
export const settings = reactive({
  pageSize: 20,
  compact: false,
  showDomains: true,
  /** Replies shown down to this depth when a story opens; deeper ones are collapsed. */
  expandDepth: 3,
  theme: "light" as ThemeChoice,
});

/** How the loaded stories of a feed are sorted and filtered (the sort menu). */
export const listOptions = reactive({
  sort: "rank" as SortOrder,
  minScore: 0,
  linksOnly: false,
});

export const SORT_LABELS: Record<SortOrder, string> = {
  rank: "Rank",
  score: "Points",
  comments: "Comments",
  time: "Newest",
};
