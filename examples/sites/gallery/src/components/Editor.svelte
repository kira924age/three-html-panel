<script lang="ts">
  import { tick, untrack } from "svelte";
  import { fade, fly } from "svelte/transition";
  import Icon from "./Icon.svelte";
  import Slider from "./Slider.svelte";
  import EditorStage from "./EditorStage.svelte";
  import { bake, FULL, filterCss, isNeutral, NEUTRAL, orientedSize, PRESETS, SLIDERS, type Rect } from "../edit/model";
  import { photoFromCanvas } from "../images/catalog";
  import { editor, SWATCHES, type Tool } from "../state/editor.svelte";
  import { gallery } from "../state/gallery.svelte";
  import { ui } from "../state/ui.svelte";

  const photo = $derived(gallery.get(ui.editingId) ?? gallery.photos[0]);
  let applying = $state(false);
  let aspect = $state<number | null>(null);
  let root = $state<HTMLElement>();

  // Focus the editor (it is focusable, tabindex -1), so that its shortcuts reach it; pressing anywhere in it keeps focus in it.
  $effect(() => {
    root?.focus({ preventScroll: true });
  });

  // A new photo starts a new edit.
  $effect(() => {
    void photo?.id;
    untrack(() => {
      editor.reset();
      aspect = null;
    });
  });

  const TOOLS: { key: Tool; label: string; icon: "sliders" | "crop" | "brush"; shortcut: string }[] = [
    { key: "adjust", label: "Adjust", icon: "sliders", shortcut: "A" },
    { key: "crop", label: "Crop", icon: "crop", shortcut: "C" },
    { key: "draw", label: "Draw", icon: "brush", shortcut: "D" },
  ];

  const ASPECTS: { label: string; value: number | null }[] = [
    { label: "Free", value: null },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:2", value: 3 / 2 },
    { label: "16:9", value: 16 / 9 },
    { label: "4:5", value: 4 / 5 },
  ];

  const changes = $derived.by(() => {
    const s = editor.state;
    const list: string[] = [];
    if (!isNeutral(s.adjust)) list.push("adjusted");
    if (s.rotation || s.flipH || s.flipV) list.push("rotated");
    if (s.crop.w < 1 || s.crop.h < 1) list.push("cropped");
    if (s.strokes.length) list.push(`${s.strokes.length} stroke${s.strokes.length > 1 ? "s" : ""}`);
    return list;
  });

  function setAspect(value: number | null) {
    aspect = value;
    if (!photo || value === null) return;
    // The largest centred rectangle with this ratio.
    const o = orientedSize(photo.width, photo.height, editor.state.rotation);
    let w = 1;
    let h = (o.w / o.h) / value;
    if (h > 1) {
      w = 1 / h;
      h = 1;
    }
    const rect: Rect = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    editor.setCrop(rect);
    editor.tool = "crop";
    editor.commit();
  }

  function resetCrop() {
    aspect = null;
    editor.setCrop({ ...FULL });
    editor.commit();
  }

  function resetAll() {
    editor.state.adjust = { ...NEUTRAL };
    editor.state.rotation = 0;
    editor.state.flipH = editor.state.flipV = false;
    editor.state.crop = { ...FULL };
    editor.state.strokes = [];
    editor.preset = "Original";
    aspect = null;
    editor.commit();
  }

  async function apply() {
    if (!photo || applying) return;
    applying = true;
    try {
      const image = new Image();
      image.src = photo.src;
      await image.decode();
      const canvas = bake(image, $state.snapshot(editor.state));
      const id = `e${Date.now().toString(36)}`;
      const edited = await photoFromCanvas(canvas, {
        id,
        title: `${photo.title.replace(/ \(edit( \d+)?\)$/, "")} (edit)`,
        description: `An edit of “${photo.title}”: ${changes.join(", ") || "unchanged"}.`,
        tags: [...new Set([...photo.tags, "edited"])],
        date: new Date().toISOString().slice(0, 10),
        location: photo.location,
        favorite: false,
        featured: false,
        editedFrom: photo.id,
        generator: photo.generator,
        seed: photo.seed,
      });
      gallery.clearFilters();
      gallery.sort = "newest";
      gallery.add(edited);
      ui.view = "gallery";
      ui.highlightId = id;
      ui.toast(`Saved “${edited.title}” to the gallery`, { label: "Open", run: () => ui.openLightbox(gallery.visible.map((p) => p.id), id) });
      await tick();
      await new Promise((r) => setTimeout(r, 350));
      document.querySelector(".card.highlight")?.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => ui.highlightId === id && (ui.highlightId = null), 3000);
    } catch (error) {
      ui.toast(`Could not apply the edit: ${(error as Error).message}`);
    } finally {
      applying = false;
    }
  }

  function close() {
    ui.view = "gallery";
  }

  function choose(id: string) {
    if (id === photo?.id) return;
    if (editor.dirty) ui.toast(`Discarded the edits to “${photo?.title}”`);
    ui.editingId = id;
  }

  function onKeydown(event: KeyboardEvent) {
    if (ui.lightbox) return;
    if (ui.shortcutsOpen) {
      if (event.key === "Escape") ui.shortcutsOpen = false;
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    if (mod && key === "y") {
      event.preventDefault();
      editor.redo();
      return;
    }
    if (mod && key === "enter") {
      event.preventDefault();
      apply();
      return;
    }
    if (mod || event.altKey) return;
    const actions: Record<string, () => void> = {
      a: () => (editor.tool = "adjust"),
      c: () => (editor.tool = "crop"),
      d: () => (editor.tool = "draw"),
      r: () => editor.rotate(!event.shiftKey),
      h: () => editor.flip("h"),
      v: () => editor.flip("v"),
      b: () => (editor.compare = !editor.compare),
      "[": () => (editor.brushSize = Math.max(2, editor.brushSize - 2)),
      "]": () => (editor.brushSize = Math.min(60, editor.brushSize + 2)),
      "?": () => (ui.shortcutsOpen = true),
      escape: () => (editor.tool !== "adjust" ? (editor.tool = "adjust") : close()),
    };
    const run = actions[key];
    if (run) {
      event.preventDefault();
      run();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if photo}
  <div class="editor" bind:this={root} tabindex="-1" in:fade={{ duration: 200 }}>
    <div class="topbar">
      <button class="btn ghost" onclick={close}><Icon name="left" size={16} /> Gallery</button>
      <div class="title">
        <strong>{photo.title}</strong>
        <span class="status">
          {#if changes.length}{changes.join(" · ")}{:else}No changes{/if}
        </span>
      </div>
      <div class="actions">
        <button class="btn ghost icon" onclick={() => editor.undo()} disabled={!editor.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
        <button class="btn ghost icon" onclick={() => editor.redo()} disabled={!editor.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
        <span class="sep"></span>
        <button class="btn" class:active={editor.compare} onclick={() => (editor.compare = !editor.compare)} aria-pressed={editor.compare} title="Before / after (B)">
          <Icon name="compare" size={16} /> Compare
        </button>
        <button class="btn" onclick={resetAll} disabled={!changes.length} title="Reset all changes"><Icon name="reset" size={16} /> Reset</button>
        <button class="btn primary apply" onclick={apply} disabled={applying || !changes.length} title="Apply (Ctrl+Enter)">
          <Icon name="check" size={16} />
          {applying ? "Saving…" : "Apply"}
        </button>
      </div>
    </div>

    <div class="body">
      <div class="workspace">
        <EditorStage {photo} {aspect} />
        <div class="picker" aria-label="Choose a photo to edit">
          {#each gallery.photos as p (p.id)}
            <button class="pick" class:current={p.id === photo.id} onclick={() => choose(p.id)} aria-label={`Edit ${p.title}`} title={p.title}>
              <img src={p.thumb} alt="" loading="lazy" />
            </button>
          {/each}
        </div>
      </div>

      <aside class="panel">
        <div class="tabs" role="tablist">
          {#each TOOLS as t (t.key)}
            <button role="tab" aria-selected={editor.tool === t.key} class:current={editor.tool === t.key} onclick={() => (editor.tool = t.key)} title={`${t.label} (${t.shortcut})`}>
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          {/each}
        </div>

        {#key editor.tool}
          <div class="tool" in:fly={{ y: 6, duration: 180 }}>
            {#if editor.tool === "adjust"}
              <h4>Presets</h4>
              <div class="presets">
                {#each PRESETS as preset (preset.name)}
                  <button class="preset" class:current={editor.preset === preset.name} onclick={() => editor.applyPreset(preset.name)}>
                    <img src={photo.thumb} alt="" style:filter={filterCss({ ...NEUTRAL, ...preset.adjust }, 60)} />
                    <span>{preset.name}</span>
                  </button>
                {/each}
              </div>
              <h4>Light &amp; colour</h4>
              {#each SLIDERS as slider (slider.key)}
                <Slider
                  label={slider.label}
                  value={editor.state.adjust[slider.key]}
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  unit={slider.unit}
                  neutral={NEUTRAL[slider.key]}
                  oninput={(v) => editor.setAdjust(slider.key, v)}
                  onchange={() => editor.commit()}
                />
              {/each}
            {:else if editor.tool === "crop"}
              <h4>Aspect ratio</h4>
              <div class="seg">
                {#each ASPECTS as a (a.label)}
                  <button class:current={aspect === a.value} onclick={() => setAspect(a.value)}>{a.label}</button>
                {/each}
              </div>
              <p class="hint">Drag the rectangle to move it, its corners and edges to resize it.</p>
              <h4>Rotate &amp; flip</h4>
              <div class="row">
                <button class="btn" onclick={() => editor.rotate(false)} title="Rotate left (Shift+R)"><Icon name="rotateLeft" size={16} /> Left</button>
                <button class="btn" onclick={() => editor.rotate(true)} title="Rotate right (R)"><Icon name="rotate" size={16} /> Right</button>
              </div>
              <div class="row">
                <button class="btn" onclick={() => editor.flip("h")} title="Flip horizontally (H)"><Icon name="flipH" size={16} /> Flip H</button>
                <button class="btn" onclick={() => editor.flip("v")} title="Flip vertically (V)"><Icon name="flipV" size={16} /> Flip V</button>
              </div>
              <button class="btn wide" onclick={resetCrop}><Icon name="reset" size={16} /> Reset crop</button>
            {:else}
              <h4>Brush</h4>
              <div class="brush">
                <span class="dot" style:width="{editor.brushSize}px" style:height="{editor.brushSize}px" style:background={editor.brushColor}></span>
              </div>
              <Slider label="Size" value={editor.brushSize} min={2} max={60} unit="px" neutral={12} oninput={(v) => (editor.brushSize = v)} onchange={() => {}} />
              <h4>Colour</h4>
              <div class="swatches">
                {#each SWATCHES as c (c)}
                  <button class="swatch" class:current={editor.brushColor === c} style:background={c} onclick={() => (editor.brushColor = c)} aria-label={`Colour ${c}`}></button>
                {/each}
              </div>
              <h4>From this photo</h4>
              <div class="swatches">
                {#each photo.palette as s (s.hex)}
                  <button class="swatch" class:current={editor.brushColor === s.hex} style:background={s.hex} onclick={() => (editor.brushColor = s.hex)} aria-label={`Colour ${s.hex}`}></button>
                {/each}
              </div>
              <p class="hint">Draw on the image with the pointer. Strokes follow rotation and flips.</p>
              <button class="btn wide" onclick={() => editor.clearDrawing()} disabled={!editor.state.strokes.length}><Icon name="trash" size={16} /> Clear drawing</button>
            {/if}
          </div>
        {/key}
      </aside>
    </div>
  </div>
{/if}

<style>
  .editor {
    outline: none;
    display: flex;
    flex-direction: column;
    height: calc(100vh - 57px);
    min-height: 480px;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 52px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
  }
  .title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }
  .title strong {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status {
    color: var(--faint);
    font-size: 12px;
  }
  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sep {
    width: 1px;
    height: 22px;
    background: var(--line);
    margin: 0 4px;
  }
  .apply {
    min-width: 92px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .workspace {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .picker {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    overflow-x: auto;
    border-top: 1px solid var(--line);
    background: var(--bg-2);
    scrollbar-width: thin;
  }
  .pick {
    flex: 0 0 auto;
    width: 54px;
    height: 40px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface);
    opacity: 0.55;
    transition:
      opacity 0.15s,
      border-color 0.15s;
  }
  .pick:hover {
    opacity: 0.9;
  }
  .pick.current {
    opacity: 1;
    border-color: var(--accent);
  }
  .pick img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .panel {
    width: 290px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--line);
    background: var(--bg-2);
  }
  .tabs {
    display: flex;
    gap: 2px;
    margin: 10px 12px 0;
    padding: 3px;
    border-radius: 10px;
    background: var(--bg);
    border: 1px solid var(--line);
  }
  .tabs button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--muted);
    font-weight: 500;
  }
  .tabs button.current {
    background: var(--surface-2);
    color: var(--text);
  }
  .tool {
    flex: 1;
    overflow-y: auto;
    padding: 4px 16px 16px;
  }
  h4 {
    margin: 14px 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faint);
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .preset {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 3px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    font-size: 11px;
    color: var(--muted);
  }
  .preset img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 6px;
    display: block;
  }
  .preset:hover {
    background: var(--surface);
  }
  .preset.current {
    border-color: var(--accent);
    color: var(--text);
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .seg button {
    height: 30px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--surface);
    color: var(--muted);
    font-size: 12.5px;
  }
  .seg button.current {
    border-color: var(--accent);
    color: var(--text);
    background: rgba(255, 122, 89, 0.12);
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 6px;
  }
  .wide {
    width: 100%;
    margin-top: 10px;
  }
  .hint {
    margin: 10px 0 0;
    color: var(--faint);
    font-size: 12px;
  }
  .brush {
    display: grid;
    place-items: center;
    height: 72px;
    border-radius: 10px;
    background: repeating-conic-gradient(#202128 0% 25%, #1a1b20 0% 50%) 50% / 14px 14px;
  }
  .dot {
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }
  .swatch {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.15);
    padding: 0;
    transition: transform 0.12s;
  }
  .swatch:hover {
    transform: scale(1.1);
  }
  .swatch.current {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--accent);
  }
  @media (max-width: 760px) {
    .editor {
      height: auto;
    }
    .body {
      flex-direction: column;
    }
    .workspace {
      flex: none;
      height: 62vh;
    }
    .panel {
      width: auto;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
    .actions .btn:not(.apply):not(.icon) {
      display: none;
    }
  }
</style>
