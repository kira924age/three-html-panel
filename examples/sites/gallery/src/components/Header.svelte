<script lang="ts">
  import Icon from "./Icon.svelte";
  import { gallery } from "../state/gallery.svelte";
  import { ui } from "../state/ui.svelte";

  let { search = $bindable() }: { search?: HTMLInputElement } = $props();

  function openEditor() {
    const id = ui.editingId ?? gallery.visible[0]?.id ?? gallery.photos[0]?.id;
    if (id) ui.edit(id);
  }
</script>

<header>
  <div class="inner">
    <button class="brand" onclick={() => (ui.view = "gallery")} aria-label="Lumen, back to the gallery">
      <span class="logo" aria-hidden="true"></span>
      <span class="name">Lumen</span>
    </button>

    <nav aria-label="Views">
      <button class:current={ui.view === "gallery"} onclick={() => (ui.view = "gallery")}>
        <Icon name="grid" size={16} /> <span class="label">Gallery</span>
      </button>
      <button class:current={ui.view === "editor"} onclick={openEditor} disabled={!gallery.photos.length}>
        <Icon name="sliders" size={16} /> <span class="label">Editor</span>
      </button>
    </nav>

    <label class="search" class:hidden={ui.view !== "gallery"}>
      <Icon name="search" size={16} />
      <span class="visually-hidden">Search photos</span>
      <input
        bind:this={search}
        type="text"
        placeholder="Search titles, places, tags…"
        autocomplete="off"
        spellcheck="false"
        bind:value={gallery.query}
      />
      {#if gallery.query}
        <button class="clear" onclick={() => (gallery.query = "")} aria-label="Clear search"><Icon name="close" size={14} /></button>
      {:else}
        <kbd>/</kbd>
      {/if}
    </label>

    <button class="btn ghost icon" onclick={() => (ui.shortcutsOpen = true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
      <Icon name="keyboard" />
    </button>
  </div>
</header>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(15, 16, 19, 0.82);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--line);
  }
  .inner {
    max-width: 1280px;
    margin: 0 auto;
    height: 56px;
    padding: 0 24px;
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 0;
    background: none;
    padding: 0;
  }
  .logo {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background:
      radial-gradient(circle at 50% 50%, #fff 0 5px, transparent 6px),
      conic-gradient(from 200deg, #ff7a59, #ffb36b, #ffd36b, #7b61ff, #ff5fc8, #ff7a59);
    box-shadow: 0 2px 10px rgba(255, 122, 89, 0.35);
  }
  .name {
    font-weight: 700;
    font-size: 17px;
    letter-spacing: -0.02em;
  }
  nav {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 10px;
    background: var(--bg-2);
    border: 1px solid var(--line);
  }
  nav button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--muted);
    font-weight: 500;
    transition:
      background 0.15s,
      color 0.15s;
  }
  nav button:hover:not(:disabled) {
    color: var(--text);
  }
  nav button.current {
    background: var(--surface-2);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  }
  .search {
    margin-left: auto;
    flex: 0 1 340px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border-radius: 10px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--faint);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .search:focus-within {
    border-color: rgba(255, 122, 89, 0.6);
    box-shadow: 0 0 0 3px rgba(255, 122, 89, 0.15);
  }
  .search.hidden {
    visibility: hidden;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
  }
  .search input::placeholder {
    color: var(--faint);
  }
  .clear {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--muted);
  }
  @media (max-width: 560px) {
    nav .label {
      display: none;
    }
    nav button {
      padding: 0 9px;
    }
    .search {
      flex: 1 1 auto;
      min-width: 0;
    }
  }
  @media (max-width: 720px) {
    .inner {
      padding: 0 14px;
      gap: 10px;
    }
    .name {
      display: none;
    }
    .search kbd {
      display: none;
    }
  }
</style>
