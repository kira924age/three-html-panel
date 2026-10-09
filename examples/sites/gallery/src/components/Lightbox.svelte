<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade, fly, scale } from "svelte/transition";
  import Icon from "./Icon.svelte";
  import InfoPanel from "./InfoPanel.svelte";
  import { gallery } from "../state/gallery.svelte";
  import { ui } from "../state/ui.svelte";

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;

  const box = $derived(ui.lightbox!);
  const photos = $derived(box.ids.map((id) => gallery.get(id)).filter((p) => p !== undefined));
  const photo = $derived(gallery.get(box.ids[box.index]));

  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let dragging = $state(false);
  let stage = $state<HTMLElement>();
  let strip = $state<HTMLElement>();
  let root = $state<HTMLElement>();
  let drag: { id: number; x: number; y: number; panX: number; panY: number } | null = null;

  // A new photo starts unzoomed, and its thumbnail scrolls into view.
  $effect(() => {
    void photo?.id;
    zoom = 1;
    pan = { x: 0, y: 0 };
    tick().then(() => {
      const thumb = strip?.querySelector<HTMLElement>(".thumb.current");
      if (thumb && strip) {
        const left = thumb.offsetLeft - strip.clientWidth / 2 + thumb.offsetWidth / 2;
        strip.scrollTo({ left, behavior: "smooth" });
      }
    });
  });

  onMount(() => {
    // Take focus, so that the arrow keys and Escape come here wherever the viewer was opened from.
    root?.focus({ preventScroll: true });
    const { overflow } = document.documentElement.style;
    document.documentElement.style.overflow = "hidden";
    return () => (document.documentElement.style.overflow = overflow);
  });

  function clampPan(p: { x: number; y: number }, z = zoom) {
    if (!stage) return p;
    const mx = (stage.clientWidth * (z - 1)) / 2;
    const my = (stage.clientHeight * (z - 1)) / 2;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  }

  /** Zooms to `next`, keeping the point at (px, py) (from the stage's centre) where it is. */
  function zoomTo(next: number, px = 0, py = 0) {
    next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    const k = next / zoom;
    const p = { x: px - (px - pan.x) * k, y: py - (py - pan.y) * k };
    zoom = next;
    pan = clampPan(p, next);
  }

  function fromCentre(event: { clientX: number; clientY: number }) {
    const r = stage!.getBoundingClientRect();
    return [event.clientX - r.left - r.width / 2, event.clientY - r.top - r.height / 2] as const;
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const [x, y] = fromCentre(event);
    zoomTo(zoom * Math.exp(-event.deltaY * 0.0025), x, y);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || zoom <= 1) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    dragging = true;
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    pan = clampPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
  }

  function onPointerUp(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    dragging = false;
  }

  function onDoubleClick(event: MouseEvent) {
    const [x, y] = fromCentre(event);
    if (zoom > 1) zoomTo(1);
    else zoomTo(2.5, x, y);
  }

  function onKeydown(event: KeyboardEvent) {
    if (ui.shortcutsOpen) {
      if (event.key === "Escape") ui.shortcutsOpen = false;
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => ui.step(-1),
      ArrowRight: () => ui.step(1),
      Home: () => ui.lightbox && (ui.lightbox.index = 0),
      End: () => ui.lightbox && (ui.lightbox.index = ui.lightbox.ids.length - 1),
      Escape: () => (zoom > 1 ? zoomTo(1) : ui.closeLightbox()),
      "+": () => zoomTo(zoom * 1.5),
      "=": () => zoomTo(zoom * 1.5),
      "-": () => zoomTo(zoom / 1.5),
      "0": () => zoomTo(1),
      i: () => (ui.infoOpen = !ui.infoOpen),
      f: () => photo && gallery.toggleFavorite(photo.id),
      e: () => photo && ui.edit(photo.id),
      "?": () => (ui.shortcutsOpen = true),
    };
    const run = keys[event.key];
    if (run) {
      event.preventDefault();
      run();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="lightbox" bind:this={root} tabindex="-1" role="dialog" aria-modal="true" aria-label={photo ? `${photo.title}, photo viewer` : "Photo viewer"} transition:fade={{ duration: 200 }}>
  <div class="main">
    <div class="bar" in:fly={{ y: -10, duration: 250 }}>
      <div class="title">
        <span class="counter">{box.index + 1} / {box.ids.length}</span>
        {#if photo}<strong>{photo.title}</strong>{/if}
      </div>
      <div class="tools">
        <div class="zoom">
          <button class="btn ghost icon" onclick={() => zoomTo(zoom / 1.5)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out"><Icon name="zoomOut" /></button>
          <button class="pct" onclick={() => zoomTo(1)} title="Reset zoom (0)">{Math.round(zoom * 100)}%</button>
          <button class="btn ghost icon" onclick={() => zoomTo(zoom * 1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in"><Icon name="zoomIn" /></button>
        </div>
        {#if photo}
          <button class="btn ghost icon" class:faved={photo.favorite} onclick={() => gallery.toggleFavorite(photo.id)} aria-pressed={photo.favorite} aria-label="Favorite" title="Favorite (F)">
            <Icon name="heart" fill={photo.favorite} />
          </button>
          <button class="btn ghost icon" class:active={ui.infoOpen} onclick={() => (ui.infoOpen = !ui.infoOpen)} aria-pressed={ui.infoOpen} aria-label="Info" title="Info (I)">
            <Icon name="info" />
          </button>
          <button class="btn" onclick={() => ui.edit(photo.id)} title="Edit (E)"><Icon name="edit" size={16} /> Edit</button>
        {/if}
        <button class="btn ghost icon close" onclick={() => ui.closeLightbox()} aria-label="Close" title="Close (Esc)"><Icon name="close" /></button>
      </div>
    </div>

    <div
      class="stage"
      class:zoomed={zoom > 1}
      class:dragging
      bind:this={stage}
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      ondblclick={onDoubleClick}
      role="presentation"
    >
      {#if photo}
        {#key photo.id}
          <div class="frame" in:fade={{ duration: 320 }} out:fade={{ duration: 320 }}>
            <img
              src={photo.src}
              alt={photo.title}
              draggable="false"
              style:transform={`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}
              in:scale={{ start: 0.96, duration: 320 }}
            />
          </div>
        {/key}
      {/if}
      {#if box.ids.length > 1}
        <button class="nav prev" onclick={() => ui.step(-1)} aria-label="Previous photo" title="Previous (←)"><Icon name="left" size={22} /></button>
        <button class="nav next" onclick={() => ui.step(1)} aria-label="Next photo" title="Next (→)"><Icon name="right" size={22} /></button>
      {/if}
      {#if zoom > 1}
        <span class="hint" transition:fade={{ duration: 150 }}>Drag to pan · double-click or 0 to reset</span>
      {/if}
    </div>

    <div class="strip" bind:this={strip} role="listbox" aria-label="Photos">
      {#each photos as p, i (p.id)}
        <button
          class="thumb"
          class:current={i === box.index}
          onclick={() => ui.lightbox && (ui.lightbox.index = i)}
          role="option"
          aria-selected={i === box.index}
          aria-label={p.title}
        >
          <img src={p.thumb} alt="" loading="lazy" />
        </button>
      {/each}
    </div>
  </div>

  {#if ui.infoOpen && photo}
    <aside transition:fly={{ x: 40, duration: 220 }}>
      <InfoPanel {photo} />
    </aside>
  {/if}
</div>

<style>
  .lightbox {
    outline: none;
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    background: rgba(8, 8, 11, 0.94);
    backdrop-filter: blur(8px);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 54px;
    padding: 0 12px 0 18px;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  .title strong {
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .counter {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .zoom {
    display: flex;
    align-items: center;
    margin-right: 6px;
    padding: 0 2px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
  }
  .pct {
    width: 52px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .faved {
    color: #ff5f7e;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  .stage.zoomed {
    cursor: grab;
  }
  .stage.dragging {
    cursor: grabbing;
  }
  .frame {
    position: absolute;
    inset: 8px 64px;
  }
  .frame img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transform-origin: center;
    transition: transform 0.12s ease-out;
    filter: drop-shadow(0 20px 40px rgba(0, 0, 0, 0.5));
  }
  .dragging .frame img {
    transition: none;
  }
  .nav {
    position: absolute;
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(30, 30, 38, 0.7);
    color: #fff;
    transition:
      background 0.15s,
      transform 0.15s;
  }
  .nav:hover {
    background: rgba(50, 50, 62, 0.95);
    transform: scale(1.06);
  }
  .prev {
    left: 12px;
  }
  .next {
    right: 12px;
  }
  .hint {
    position: absolute;
    left: 50%;
    bottom: 10px;
    translate: -50% 0;
    padding: 4px 10px;
    border-radius: 99px;
    background: rgba(0, 0, 0, 0.6);
    color: var(--muted);
    font-size: 12px;
    pointer-events: none;
  }
  .strip {
    display: flex;
    gap: 6px;
    height: 74px;
    padding: 10px 18px 12px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .thumb {
    flex: 0 0 auto;
    width: 72px;
    height: 52px;
    padding: 0;
    border-radius: 7px;
    border: 2px solid transparent;
    overflow: hidden;
    background: var(--surface);
    opacity: 0.5;
    transition:
      opacity 0.2s,
      border-color 0.2s,
      transform 0.2s;
  }
  .thumb:hover {
    opacity: 0.85;
  }
  .thumb.current {
    opacity: 1;
    border-color: var(--accent);
    transform: translateY(-2px);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  aside {
    width: 290px;
    flex-shrink: 0;
    border-left: 1px solid var(--line);
    background: rgba(22, 23, 28, 0.92);
    overflow-y: auto;
  }
  @media (max-width: 760px) {
    aside {
      position: absolute;
      right: 0;
      top: 54px;
      bottom: 0;
      width: min(290px, 85vw);
    }
    .frame {
      inset: 8px 8px;
    }
    .zoom {
      display: none;
    }
  }
</style>
