<script lang="ts">
  import type { Photo } from "../images/catalog";
  import { isLight } from "../images/palette";
  import { gallery } from "../state/gallery.svelte";
  import { ui } from "../state/ui.svelte";

  let { photo }: { photo: Photo } = $props();

  const source = $derived(gallery.get(photo.editedFrom));
  const date = $derived(new Date(photo.date + "T12:00:00").toLocaleDateString("en", { weekday: "short", day: "numeric", month: "long", year: "numeric" }));
  const size = $derived(photo.bytes > 1e6 ? `${(photo.bytes / 1e6).toFixed(1)} MB` : `${Math.round(photo.bytes / 1e3)} KB`);
  const megapixels = $derived(((photo.width * photo.height) / 1e6).toFixed(1));

  function filterByTag(tag: string) {
    gallery.clearFilters();
    gallery.tags = [tag];
    ui.closeLightbox();
    ui.view = "gallery";
  }
</script>

<div class="info">
  <h3>{photo.title}</h3>
  <p class="desc">{photo.description}</p>

  <dl>
    <dt>Date</dt>
    <dd>{date}</dd>
    <dt>Location</dt>
    <dd>{photo.location}</dd>
    <dt>Dimensions</dt>
    <dd>{photo.width} × {photo.height} <span class="muted">· {megapixels} MP</span></dd>
    <dt>File</dt>
    <dd>JPEG · {size}</dd>
    <dt>Generator</dt>
    <dd><code>{photo.generator}</code> <span class="muted">· seed {photo.seed}</span></dd>
    {#if source}
      <dt>Edited from</dt>
      <dd>{source.title}</dd>
    {/if}
  </dl>

  <h4>Tags</h4>
  <div class="tags">
    {#each photo.tags as tag (tag)}
      <button onclick={() => filterByTag(tag)} title={`Show all “${tag}” photos`}>#{tag}</button>
    {/each}
  </div>

  <h4>Palette</h4>
  <div class="bar" aria-hidden="true">
    {#each photo.palette as s (s.hex)}
      <span style:background={s.hex} style:flex-grow={s.weight}></span>
    {/each}
  </div>
  <ul class="swatches">
    {#each photo.palette as s (s.hex)}
      <li>
        <span class="chip" style:background={s.hex} style:color={isLight(s.hex) ? "#111" : "#fff"}>{Math.round(s.weight * 100)}%</span>
        <code>{s.hex}</code>
      </li>
    {/each}
  </ul>
</div>

<style>
  .info {
    padding: 18px;
  }
  h3 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.01em;
  }
  .desc {
    margin: 6px 0 16px;
    color: var(--muted);
    font-size: 13px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 7px 14px;
    margin: 0;
    font-size: 12.5px;
  }
  dt {
    color: var(--faint);
  }
  dd {
    margin: 0;
  }
  .muted {
    color: var(--faint);
  }
  code {
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  h4 {
    margin: 20px 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faint);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tags button {
    padding: 3px 9px;
    border-radius: 99px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--muted);
    font-size: 12px;
  }
  .tags button:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .bar {
    display: flex;
    height: 28px;
    border-radius: 8px;
    overflow: hidden;
  }
  .bar span {
    flex-basis: 0;
  }
  .swatches {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 10px 0 0;
    padding: 0;
    list-style: none;
  }
  .swatches li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .chip {
    display: grid;
    place-items: center;
    width: 34px;
    height: 26px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  }
</style>
