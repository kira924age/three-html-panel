<script lang="ts">
  import { fly } from "svelte/transition";
  import Icon from "./Icon.svelte";
  import { gallery, SORTS } from "../state/gallery.svelte";

  let menuOpen = $state(false);
  let menu = $state<HTMLElement>();

  const current = $derived(SORTS.find((s) => s.key === gallery.sort)!);
  const filtered = $derived(gallery.tags.length > 0 || gallery.query !== "" || gallery.favoritesOnly);

  function onWindowPointer(event: PointerEvent) {
    if (menuOpen && menu && !menu.contains(event.target as Node)) menuOpen = false;
  }

  function onMenuKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      menuOpen = false;
      event.stopPropagation();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const i = SORTS.findIndex((s) => s.key === gallery.sort);
    gallery.sort = SORTS[(i + (event.key === "ArrowDown" ? 1 : SORTS.length - 1)) % SORTS.length].key;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="toolbar">
  <div class="chips" role="group" aria-label="Filter by tag">
    <button class="chip" class:on={!filtered} onclick={() => gallery.clearFilters()}>All</button>
    <button class="chip fav" class:on={gallery.favoritesOnly} aria-pressed={gallery.favoritesOnly} onclick={() => (gallery.favoritesOnly = !gallery.favoritesOnly)}>
      <Icon name="heart" size={13} fill={gallery.favoritesOnly} /> Favorites
    </button>
    {#each gallery.allTags as [tag, count] (tag)}
      <button class="chip" class:on={gallery.tags.includes(tag)} aria-pressed={gallery.tags.includes(tag)} onclick={() => gallery.toggleTag(tag)}>
        {tag}<span class="count">{count}</span>
      </button>
    {/each}
  </div>

  <div class="right">
    <span class="total" aria-live="polite">
      {gallery.visible.length}
      {gallery.visible.length === 1 ? "photo" : "photos"}
    </span>
    <div class="sort" bind:this={menu}>
      <button class="btn" aria-haspopup="listbox" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)} onkeydown={onMenuKey}>
        <Icon name="sort" size={16} />
        {current.label}
        <Icon name="chevronDown" size={14} />
      </button>
      {#if menuOpen}
        <ul class="menu" role="listbox" aria-label="Sort by" transition:fly={{ y: -6, duration: 140 }}>
          {#each SORTS as sort (sort.key)}
            <li role="option" aria-selected={sort.key === gallery.sort}>
              <button
                class:selected={sort.key === gallery.sort}
                onclick={() => {
                  gallery.sort = sort.key;
                  menuOpen = false;
                }}
              >
                {sort.label}
                {#if sort.key === gallery.sort}<Icon name="check" size={14} />{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 11px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--muted);
    font-size: 13px;
    text-transform: capitalize;
    transition:
      background 0.15s,
      color 0.15s,
      border-color 0.15s;
  }
  .chip:hover {
    color: var(--text);
    border-color: #444755;
  }
  .chip.on {
    background: var(--text);
    border-color: var(--text);
    color: #121318;
  }
  .chip.fav.on {
    background: #ff5f7e;
    border-color: #ff5f7e;
    color: #fff;
  }
  .count {
    font-size: 11px;
    opacity: 0.6;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }
  .total {
    color: var(--muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .sort {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 15;
    min-width: 180px;
    margin: 0;
    padding: 5px;
    list-style: none;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: 7px;
    background: none;
    text-align: left;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .menu button.selected {
    color: var(--accent-2);
  }
  @media (max-width: 720px) {
    .toolbar {
      flex-direction: column-reverse;
    }
    .right {
      width: 100%;
      justify-content: space-between;
    }
  }
</style>
