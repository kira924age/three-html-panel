<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import Header from "./components/Header.svelte";
  import Carousel from "./components/Carousel.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import Grid from "./components/Grid.svelte";
  import Lightbox from "./components/Lightbox.svelte";
  import Editor from "./components/Editor.svelte";
  import Shortcuts from "./components/Shortcuts.svelte";
  import Toasts from "./components/Toasts.svelte";
  import { CATALOG, generateCatalog } from "./images/catalog";
  import { gallery } from "./state/gallery.svelte";
  import { ui } from "./state/ui.svelte";

  let search = $state<HTMLInputElement>();

  onMount(() => {
    gallery.expected = CATALOG.length;
    (async () => {
      for await (const photo of generateCatalog()) gallery.photos = [...gallery.photos, photo];
      gallery.loading = false;
    })();
  });

  // Each view starts at the top of the page.
  let lastView = ui.view;
  $effect(() => {
    if (ui.view !== lastView) {
      lastView = ui.view;
      if (ui.view === "editor") window.scrollTo({ top: 0, behavior: "instant" });
    }
  });

  const typing = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || (target instanceof HTMLInputElement && target.type === "text"));

  function onKeydown(event: KeyboardEvent) {
    // The lightbox and the editor handle their own keys.
    if (ui.lightbox || ui.view !== "gallery") return;
    if (event.key === "Escape" && ui.shortcutsOpen) {
      ui.shortcutsOpen = false;
      return;
    }
    if (typing(event.target)) {
      if (event.key === "Escape") (event.target as HTMLElement).blur();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "/") {
      event.preventDefault();
      search?.focus();
    } else if (event.key === "?") ui.shortcutsOpen = !ui.shortcutsOpen;
    else if (event.key === "f") gallery.favoritesOnly = !gallery.favoritesOnly;
    else if (event.key === "Escape") gallery.clearFilters();
    else if (event.key === "e" && gallery.visible[0]) ui.edit(gallery.visible[0].id);
    else if (event.key === "Enter" && gallery.visible[0]) ui.openLightbox(gallery.visible.map((p) => p.id), gallery.visible[0].id);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Header bind:search />

{#if ui.view === "gallery"}
  <main class="gallery" tabindex="-1" in:fade={{ duration: 200 }}>
    <Carousel />
    <Toolbar />
    <Grid />
    <footer>
      <span>Lumen · every image here is painted by the page itself, on a canvas.</span>
      <button class="btn ghost" onclick={() => (ui.shortcutsOpen = true)}>Keyboard shortcuts <kbd>?</kbd></button>
    </footer>
  </main>
{:else}
  <Editor />
{/if}

{#if ui.lightbox}
  <Lightbox />
{/if}

{#if ui.shortcutsOpen}
  <Shortcuts />
{/if}

<Toasts />

<style>
  .gallery {
    outline: none;
    max-width: 1280px;
    margin: 0 auto;
    padding: 18px 24px 32px;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    color: var(--faint);
    font-size: 12px;
  }
  @media (max-width: 640px) {
    .gallery {
      padding: 12px 14px 24px;
    }
    footer {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
