<script lang="ts">
  import { flip } from "svelte/animate";
  import { fade, scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Icon from "./Icon.svelte";
  import { gallery } from "../state/gallery.svelte";
  import { ui } from "../state/ui.svelte";
  import type { Photo } from "../images/catalog";

  const MIN_COLUMN = 210;
  const GAP = 14;
  const ROW = 2;

  let width = $state(1000);
  let loaded = $state<Record<string, boolean>>({});

  const columns = $derived(Math.max(1, Math.floor((width + GAP) / (MIN_COLUMN + GAP))));
  const columnWidth = $derived((width - GAP * (columns - 1)) / columns);
  const span = (w: number, h: number) => Math.ceil((columnWidth * (h / w) + GAP) / ROW);
  const pending = $derived(gallery.loading ? Math.max(0, gallery.expected - gallery.photos.length) : 0);

  function open(photo: Photo) {
    ui.openLightbox(gallery.visible.map((p) => p.id), photo.id);
  }

  const formatDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
</script>

<div class="grid" bind:clientWidth={width} style:grid-template-columns={`repeat(${columns}, 1fr)`} style:grid-auto-rows={`${ROW}px`}>
  {#each gallery.visible as photo (photo.id)}
    <article
      class="card"
      class:highlight={ui.highlightId === photo.id}
      style:grid-row-end={`span ${span(photo.width, photo.height)}`}
      animate:flip={{ duration: 450, easing: cubicOut }}
      in:scale={{ start: 0.85, duration: 300, opacity: 0 }}
      out:fade={{ duration: 180 }}
    >
      <button class="open" onclick={() => open(photo)} aria-label={`Open ${photo.title}`}>
        <img
          src={photo.thumb}
          alt={photo.title}
          loading="lazy"
          decoding="async"
          class:loaded={loaded[photo.id]}
          onload={() => (loaded[photo.id] = true)}
          style:aspect-ratio={`${photo.width} / ${photo.height}`}
          style:background={photo.palette[0]?.hex}
        />
      </button>
      <div class="overlay">
        <div class="meta">
          <strong>{photo.title}</strong>
          <span>{photo.location} · {formatDate(photo.date)}</span>
        </div>
        <div class="tags">
          {#each photo.tags.slice(0, 3) as tag (tag)}<span>{tag}</span>{/each}
        </div>
      </div>
      <div class="actions">
        <button class="act" class:fav={photo.favorite} onclick={() => gallery.toggleFavorite(photo.id)} aria-pressed={photo.favorite} aria-label={photo.favorite ? "Remove from favorites" : "Add to favorites"} title="Favorite">
          <Icon name="heart" size={15} fill={photo.favorite} />
        </button>
        <button class="act" onclick={() => ui.edit(photo.id)} aria-label={`Edit ${photo.title}`} title="Edit">
          <Icon name="edit" size={15} />
        </button>
      </div>
      {#if photo.editedFrom}<span class="badge">Edited</span>{/if}
    </article>
  {/each}
  {#each { length: pending } as _, i (i)}
    <div class="card skeleton" style:grid-row-end={`span ${span(3, i % 3 === 0 ? 4 : 2)}`}></div>
  {/each}
</div>

{#if !gallery.loading && gallery.visible.length === 0}
  <div class="empty" in:fade>
    <Icon name="image" size={36} />
    <h3>No photos match</h3>
    <p>Try another search, or clear the filters.</p>
    <button class="btn" onclick={() => gallery.clearFilters()}>Clear filters</button>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    column-gap: 14px;
    align-items: start;
  }
  .card {
    position: relative;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    transition:
      box-shadow 0.25s,
      transform 0.25s var(--ease);
  }
  .card:hover {
    transform: translateY(-3px);
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.45);
  }
  .card.highlight {
    box-shadow:
      0 0 0 3px var(--accent),
      0 14px 30px rgba(255, 122, 89, 0.3);
  }
  .open {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  img {
    display: block;
    width: 100%;
    height: auto;
    opacity: 0;
    transform: scale(1.02);
    transition:
      opacity 0.4s,
      transform 0.6s var(--ease);
  }
  img.loaded {
    opacity: 1;
    transform: none;
  }
  .card:hover img.loaded {
    transform: scale(1.06);
  }
  .overlay {
    position: absolute;
    inset: auto 0 0 0;
    padding: 30px 12px 10px;
    background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.75));
    color: #fff;
    pointer-events: none;
    opacity: 0;
    transform: translateY(8px);
    transition:
      opacity 0.25s,
      transform 0.25s var(--ease);
  }
  .card:hover .overlay,
  .card:focus-within .overlay {
    opacity: 1;
    transform: none;
  }
  .meta {
    display: flex;
    flex-direction: column;
  }
  .meta strong {
    font-size: 14px;
  }
  .meta span {
    font-size: 11.5px;
    opacity: 0.8;
  }
  .tags {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  .tags span {
    padding: 1px 7px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.18);
    font-size: 10.5px;
    text-transform: capitalize;
  }
  .actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 6px;
    opacity: 0;
    transform: translateY(-4px);
    transition:
      opacity 0.2s,
      transform 0.2s var(--ease);
  }
  .card:hover .actions,
  .card:focus-within .actions {
    opacity: 1;
    transform: none;
  }
  .act {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 0;
    background: rgba(20, 20, 26, 0.65);
    backdrop-filter: blur(6px);
    color: #fff;
    transition:
      background 0.15s,
      transform 0.15s;
  }
  .act:hover {
    background: rgba(20, 20, 26, 0.9);
    transform: scale(1.08);
  }
  .act.fav {
    color: #ff5f7e;
  }
  .card:has(.act.fav) .actions {
    opacity: 1;
    transform: none;
  }
  .card:has(.act.fav) .actions .act:not(.fav) {
    opacity: 0;
  }
  .card:hover .actions .act {
    opacity: 1;
  }
  .badge {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 11px;
    font-weight: 600;
  }
  .skeleton {
    background: linear-gradient(100deg, var(--surface) 40%, var(--surface-2) 50%, var(--surface) 60%);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
    height: calc(100% - 14px);
  }
  .card:not(.skeleton) {
    margin-bottom: 14px;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 60px 20px;
    color: var(--muted);
    text-align: center;
  }
  .empty h3 {
    margin: 6px 0 0;
    color: var(--text);
  }
  .empty p {
    margin: 0 0 10px;
  }
</style>
