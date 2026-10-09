<script lang="ts">
  import Icon from "./Icon.svelte";
  import { gallery } from "../state/gallery.svelte";
  import { ui } from "../state/ui.svelte";

  let track = $state<HTMLElement>();
  let atStart = $state(true);
  let atEnd = $state(false);

  function update() {
    if (!track) return;
    atStart = track.scrollLeft <= 2;
    atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  }

  function page(direction: 1 | -1) {
    if (!track) return;
    const card = track.querySelector<HTMLElement>(".slide");
    const step = card ? card.offsetWidth + 14 : track.clientWidth * 0.8;
    track.scrollBy({ left: direction * step, behavior: "smooth" });
  }

  $effect(() => {
    void gallery.featured.length;
    queueMicrotask(update);
  });

  const formatDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en", { month: "short", year: "numeric" });
</script>

<section class="featured" aria-labelledby="featured-title">
  <div class="head">
    <div>
      <h2 id="featured-title">Featured</h2>
      <p>Hand-picked from the collection</p>
    </div>
    <div class="nav">
      <button class="btn icon" onclick={() => page(-1)} disabled={atStart} aria-label="Previous featured photos"><Icon name="left" /></button>
      <button class="btn icon" onclick={() => page(1)} disabled={atEnd} aria-label="Next featured photos"><Icon name="right" /></button>
    </div>
  </div>

  <div class="track" bind:this={track} onscroll={update}>
    {#each gallery.featured as photo (photo.id)}
      <button class="slide" onclick={() => ui.openLightbox(gallery.featured.map((p) => p.id), photo.id)} aria-label={`Open ${photo.title}`}>
        <img src={photo.thumb} alt="" loading="lazy" decoding="async" />
        <span class="shade"></span>
        <span class="caption">
          <strong>{photo.title}</strong>
          <span>{photo.location} · {formatDate(photo.date)}</span>
        </span>
      </button>
    {:else}
      {#each { length: 4 } as _, i (i)}
        <div class="slide skeleton"></div>
      {/each}
    {/each}
  </div>
</section>

<style>
  .featured {
    margin-bottom: 22px;
  }
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: -0.02em;
  }
  p {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 13px;
  }
  .nav {
    display: flex;
    gap: 6px;
  }
  .track {
    display: flex;
    gap: 14px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scroll-padding: 0 2px;
    padding: 2px 2px 10px;
    scrollbar-width: none;
  }
  .track::-webkit-scrollbar {
    display: none;
  }
  .slide {
    position: relative;
    flex: 0 0 min(400px, 78%);
    aspect-ratio: 2 / 1;
    border: 0;
    padding: 0;
    border-radius: var(--radius);
    overflow: hidden;
    scroll-snap-align: start;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .slide img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.6s var(--ease);
  }
  .slide:hover img {
    transform: scale(1.05);
  }
  .shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 45%, rgba(0, 0, 0, 0.7));
  }
  .caption {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    color: #fff;
  }
  .caption strong {
    font-size: 17px;
    letter-spacing: -0.01em;
  }
  .caption span {
    font-size: 12px;
    opacity: 0.8;
  }
  .skeleton {
    background: linear-gradient(100deg, var(--surface) 40%, var(--surface-2) 50%, var(--surface) 60%);
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
</style>
