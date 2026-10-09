<script lang="ts">
  // The editor's preview: the image with the edit applied by CSS (filters and
  // transforms), the drawing layer (a canvas), the crop rectangle and the
  // before/after divider. Everything here is driven by pointer events, with
  // pointer capture while dragging.

  import { fade } from "svelte/transition";
  import type { Photo } from "../images/catalog";
  import { drawStrokes, filterCss, orientMatrix, orientedSize, type Rect } from "../edit/model";
  import { editor } from "../state/editor.svelte";

  let { photo, aspect = null }: { photo: Photo; aspect?: number | null } = $props();

  let areaWidth = $state(800);
  let areaHeight = $state(500);
  let canvas = $state<HTMLCanvasElement>();
  let box = $state<HTMLElement>();

  const s = $derived(editor.state);
  const oriented = $derived(orientedSize(photo.width, photo.height, s.rotation));
  /** Displayed pixels per image pixel. */
  const fit = $derived(Math.min((areaWidth - 32) / oriented.w, (areaHeight - 32) / oriented.h));
  const boxW = $derived(Math.max(1, Math.round(oriented.w * fit)));
  const boxH = $derived(Math.max(1, Math.round(oriented.h * fit)));
  const imgW = $derived(photo.width * fit);
  const imgH = $derived(photo.height * fit);
  const imageTransform = $derived(`rotate(${s.rotation}deg) scale(${s.flipH ? -1 : 1}, ${s.flipV ? -1 : 1})`);
  const filter = $derived(filterCss(s.adjust, imgW));
  const dpr = typeof devicePixelRatio === "number" ? Math.min(2, devicePixelRatio) : 1;

  // The drawing layer: redrawn from the strokes whenever they or the view change.
  $effect(() => {
    if (!canvas) return;
    canvas.width = Math.round(boxW * dpr);
    canvas.height = Math.round(boxH * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(new DOMMatrix().scale(fit * dpr).multiply(orientMatrix(photo.width, photo.height, s)));
    drawStrokes(ctx, s.strokes);
  });

  // ---- Drawing -------------------------------------------------------------

  let drawing: { id: number; inverse: DOMMatrix } | null = null;

  function sourcePoint(event: PointerEvent, inverse: DOMMatrix): [number, number] {
    const r = box!.getBoundingClientRect();
    const p = inverse.transformPoint({ x: (event.clientX - r.left) / fit, y: (event.clientY - r.top) / fit });
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  }

  function drawStart(event: PointerEvent) {
    if (editor.tool !== "draw" || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const inverse = orientMatrix(photo.width, photo.height, s).inverse();
    drawing = { id: event.pointerId, inverse };
    editor.addStroke({ color: editor.brushColor, size: editor.brushSize / fit, points: [sourcePoint(event, inverse)] });
  }

  function drawMove(event: PointerEvent) {
    if (!drawing || event.pointerId !== drawing.id) return;
    const stroke = s.strokes[s.strokes.length - 1];
    const p = sourcePoint(event, drawing.inverse);
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) * fit >= 1.5) stroke.points.push(p);
  }

  function drawEnd(event: PointerEvent) {
    if (!drawing || event.pointerId !== drawing.id) return;
    drawing = null;
    editor.commit();
  }

  // ---- Crop ----------------------------------------------------------------

  type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const MIN = 0.06;

  let cropDrag: { id: number; handle: Handle; x: number; y: number; start: Rect } | null = null;
  let cropping = $state(false);

  function cropStart(event: PointerEvent, handle: Handle) {
    if (editor.tool !== "crop" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    cropDrag = { id: event.pointerId, handle, x: event.clientX, y: event.clientY, start: { ...s.crop } };
    cropping = true;
  }

  function cropMove(event: PointerEvent) {
    if (!cropDrag || event.pointerId !== cropDrag.id) return;
    const dx = (event.clientX - cropDrag.x) / boxW;
    const dy = (event.clientY - cropDrag.y) / boxH;
    const { handle, start } = cropDrag;
    let { x, y, w, h } = start;
    if (handle === "move") {
      x = Math.max(0, Math.min(1 - w, x + dx));
      y = Math.max(0, Math.min(1 - h, y + dy));
    } else {
      let left = x, top = y, right = x + w, bottom = y + h;
      if (handle.includes("w")) left = Math.max(0, Math.min(right - MIN, left + dx));
      if (handle.includes("e")) right = Math.min(1, Math.max(left + MIN, right + dx));
      if (handle.includes("n")) top = Math.max(0, Math.min(bottom - MIN, top + dy));
      if (handle.includes("s")) bottom = Math.min(1, Math.max(top + MIN, bottom + dy));
      if (aspect && handle.length === 2) {
        // Keep the ratio: the height follows the width, from the opposite corner.
        const ratio = oriented.w / oriented.h / aspect;
        let nw = right - left;
        let nh = nw * ratio;
        const maxH = handle.includes("n") ? bottom : 1 - top;
        if (nh > maxH) {
          nh = maxH;
          nw = nh / ratio;
        }
        if (handle.includes("w")) left = right - nw;
        else right = left + nw;
        if (handle.includes("n")) top = bottom - nh;
        else bottom = top + nh;
      }
      x = left;
      y = top;
      w = right - left;
      h = bottom - top;
    }
    editor.setCrop({ x, y, w, h });
  }

  function cropEnd(event: PointerEvent) {
    if (!cropDrag || event.pointerId !== cropDrag.id) return;
    cropDrag = null;
    cropping = false;
    editor.commit();
  }

  // ---- Before/after divider ------------------------------------------------

  let splitDrag: number | null = null;

  function splitStart(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    splitDrag = event.pointerId;
  }

  function splitMove(event: PointerEvent) {
    if (splitDrag !== event.pointerId) return;
    const r = box!.getBoundingClientRect();
    editor.split = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width));
  }

  function splitEnd(event: PointerEvent) {
    if (splitDrag === event.pointerId) splitDrag = null;
  }

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
</script>

<div class="area" bind:clientWidth={areaWidth} bind:clientHeight={areaHeight}>
  <div
    class="box tool-{editor.tool}"
    bind:this={box}
    style:width="{boxW}px"
    style:height="{boxH}px"
    onpointerdown={drawStart}
    onpointermove={drawMove}
    onpointerup={drawEnd}
    onpointercancel={drawEnd}
    role="presentation"
  >
    <div class="layer before" aria-hidden={!editor.compare}>
      <img
        src={photo.src}
        alt=""
        draggable="false"
        style:width="{imgW}px"
        style:height="{imgH}px"
        style:left="{(boxW - imgW) / 2}px"
        style:top="{(boxH - imgH) / 2}px"
        style:transform={imageTransform}
      />
    </div>
    <div class="layer after" style:clip-path={editor.compare ? `inset(0 0 0 ${pct(editor.split)})` : "none"}>
      <img
        src={photo.src}
        alt={`${photo.title}, edited`}
        draggable="false"
        style:width="{imgW}px"
        style:height="{imgH}px"
        style:left="{(boxW - imgW) / 2}px"
        style:top="{(boxH - imgH) / 2}px"
        style:transform={imageTransform}
        style:filter={filter}
      />
      <canvas bind:this={canvas} style:width="{boxW}px" style:height="{boxH}px"></canvas>
    </div>

    <div
      class="crop"
      class:active={editor.tool === "crop"}
      class:dragging={cropping}
      class:full={s.crop.x === 0 && s.crop.y === 0 && s.crop.w === 1 && s.crop.h === 1}
      style:left={pct(s.crop.x)}
      style:top={pct(s.crop.y)}
      style:width={pct(s.crop.w)}
      style:height={pct(s.crop.h)}
      onpointerdown={(e) => cropStart(e, "move")}
      onpointermove={cropMove}
      onpointerup={cropEnd}
      onpointercancel={cropEnd}
      role="presentation"
    >
      {#if editor.tool === "crop"}
        <span class="third v1"></span><span class="third v2"></span><span class="third h1"></span><span class="third h2"></span>
        {#each HANDLES as handle (handle)}
          {#if !aspect || handle.length === 2}
            <span
              class="handle {handle}"
              data-handle={handle}
              onpointerdown={(e) => cropStart(e, handle)}
              onpointermove={cropMove}
              onpointerup={cropEnd}
              onpointercancel={cropEnd}
              role="presentation"
            ></span>
          {/if}
        {/each}
        <span class="dims" transition:fade={{ duration: 120 }}>{Math.round(s.crop.w * oriented.w)} × {Math.round(s.crop.h * oriented.h)}</span>
      {/if}
    </div>

    {#if editor.compare}
      <span class="label left" transition:fade={{ duration: 150 }}>Before</span>
      <span class="label right" transition:fade={{ duration: 150 }}>After</span>
      <div
        class="divider"
        style:left={pct(editor.split)}
        onpointerdown={splitStart}
        onpointermove={splitMove}
        onpointerup={splitEnd}
        onpointercancel={splitEnd}
        role="slider"
        tabindex="0"
        aria-label="Before and after divider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(editor.split * 100)}
        onkeydown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            editor.split = Math.max(0, Math.min(1, editor.split + (e.key === "ArrowLeft" ? -0.05 : 0.05)));
          }
        }}
        transition:fade={{ duration: 150 }}
      >
        <span class="knob">⇆</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .area {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    background:
      repeating-conic-gradient(#1a1b20 0% 25%, #15161a 0% 50%) 50% / 22px 22px;
  }
  .box {
    position: relative;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    touch-action: none;
    user-select: none;
  }
  .box.tool-draw {
    cursor: crosshair;
  }
  .layer {
    position: absolute;
    inset: 0;
  }
  .layer img {
    position: absolute;
    max-width: none;
    transform-origin: center;
    transition:
      transform 0.3s var(--ease),
      width 0.3s var(--ease),
      height 0.3s var(--ease);
  }
  canvas {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .crop {
    position: absolute;
    box-shadow: 0 0 0 9999px rgba(8, 8, 12, 0.72);
    pointer-events: none;
  }
  .crop.full:not(.active) {
    box-shadow: none;
  }
  .crop.active {
    pointer-events: auto;
    cursor: move;
    box-shadow: 0 0 0 9999px rgba(8, 8, 12, 0.6);
    outline: 1.5px solid rgba(255, 255, 255, 0.9);
  }
  .third {
    position: absolute;
    background: rgba(255, 255, 255, 0.35);
    pointer-events: none;
    opacity: 0.5;
    transition: opacity 0.2s;
  }
  .crop.dragging .third {
    opacity: 1;
  }
  .third.v1,
  .third.v2 {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .third.h1,
  .third.h2 {
    left: 0;
    right: 0;
    height: 1px;
  }
  .v1 {
    left: 33.333%;
  }
  .v2 {
    left: 66.666%;
  }
  .h1 {
    top: 33.333%;
  }
  .h2 {
    top: 66.666%;
  }
  .handle {
    position: absolute;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    border-radius: 4px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }
  .handle.n,
  .handle.s {
    width: 26px;
    height: 8px;
    margin: -4px 0 0 -13px;
    cursor: ns-resize;
  }
  .handle.e,
  .handle.w {
    width: 8px;
    height: 26px;
    margin: -13px 0 0 -4px;
    cursor: ew-resize;
  }
  .nw {
    left: 0;
    top: 0;
    cursor: nwse-resize;
  }
  .n {
    left: 50%;
    top: 0;
  }
  .ne {
    left: 100%;
    top: 0;
    cursor: nesw-resize;
  }
  .e {
    left: 100%;
    top: 50%;
  }
  .se {
    left: 100%;
    top: 100%;
    cursor: nwse-resize;
  }
  .s {
    left: 50%;
    top: 100%;
  }
  .sw {
    left: 0;
    top: 100%;
    cursor: nesw-resize;
  }
  .w {
    left: 0;
    top: 50%;
  }
  .dims {
    position: absolute;
    left: 50%;
    bottom: 8px;
    translate: -50% 0;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  .label {
    position: absolute;
    top: 10px;
    padding: 3px 9px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    pointer-events: none;
  }
  .label.left {
    left: 10px;
  }
  .label.right {
    right: 10px;
  }
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 24px;
    margin-left: -12px;
    cursor: ew-resize;
    display: grid;
    place-items: center;
    outline: none;
  }
  .divider::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 11px;
    width: 2px;
    background: #fff;
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
  }
  .knob {
    position: relative;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #fff;
    color: #111;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  }
  .divider:focus-visible .knob {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
</style>
