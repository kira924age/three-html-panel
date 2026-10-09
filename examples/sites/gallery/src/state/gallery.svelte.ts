// The collection, and how the gallery filters, searches and sorts it. All state
// is in memory: the page may run sandboxed, without any storage.

import type { Photo } from "../images/catalog";
import { hueOf } from "../images/palette";

export type SortKey = "newest" | "oldest" | "title" | "color" | "size";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "title", label: "Title A–Z" },
  { key: "color", label: "By colour" },
  { key: "size", label: "Largest first" },
];

class Gallery {
  photos = $state<Photo[]>([]);
  loading = $state(true);
  /** How many images the catalog will have, for placeholders while it is generated. */
  expected = $state(0);

  query = $state("");
  tags = $state<string[]>([]);
  favoritesOnly = $state(false);
  sort = $state<SortKey>("newest");

  allTags = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const p of this.photos) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  });

  featured = $derived(this.photos.filter((p) => p.featured));

  visible = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    const list = this.photos.filter(
      (p) =>
        (!this.favoritesOnly || p.favorite) &&
        this.tags.every((t) => p.tags.includes(t)) &&
        (!q ||
          [p.title, p.description, p.location, ...p.tags].some((s) => s.toLowerCase().includes(q))),
    );
    const by: Record<SortKey, (a: Photo, b: Photo) => number> = {
      newest: (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
      oldest: (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
      title: (a, b) => a.title.localeCompare(b.title),
      color: (a, b) =>
        hueOf(a.palette[0]?.hex ?? "#000000") - hueOf(b.palette[0]?.hex ?? "#000000"),
      size: (a, b) => b.width * b.height - a.width * a.height,
    };
    return list.sort(by[this.sort]);
  });

  get(id: string | null | undefined): Photo | undefined {
    return id ? this.photos.find((p) => p.id === id) : undefined;
  }

  toggleTag(tag: string) {
    this.tags = this.tags.includes(tag) ? this.tags.filter((t) => t !== tag) : [...this.tags, tag];
  }

  clearFilters() {
    this.tags = [];
    this.query = "";
    this.favoritesOnly = false;
  }

  toggleFavorite(id: string) {
    const p = this.get(id);
    if (p) p.favorite = !p.favorite;
  }

  add(photo: Photo) {
    this.photos = [photo, ...this.photos];
  }

  remove(id: string) {
    this.photos = this.photos.filter((p) => p.id !== id);
  }
}

export const gallery = new Gallery();
