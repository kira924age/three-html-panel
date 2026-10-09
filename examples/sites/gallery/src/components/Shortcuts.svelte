<script lang="ts">
  import { fade, scale } from "svelte/transition";
  import Icon from "./Icon.svelte";
  import { ui } from "../state/ui.svelte";

  const GROUPS: { title: string; keys: [string[], string][] }[] = [
    {
      title: "Gallery",
      keys: [
        [["/"], "Search"],
        [["F"], "Favorites only"],
        [["Enter"], "Open the first photo"],
        [["E"], "Edit the first photo"],
        [["Esc"], "Clear filters"],
        [["?"], "This help"],
      ],
    },
    {
      title: "Viewer",
      keys: [
        [["←", "→"], "Previous / next"],
        [["+", "−"], "Zoom in / out"],
        [["0"], "Reset zoom"],
        [["I"], "Info panel"],
        [["F"], "Favorite"],
        [["E"], "Edit"],
        [["Esc"], "Close"],
      ],
    },
    {
      title: "Editor",
      keys: [
        [["A", "C", "D"], "Adjust / crop / draw"],
        [["R"], "Rotate (Shift: left)"],
        [["H", "V"], "Flip"],
        [["B"], "Before / after"],
        [["[", "]"], "Brush size"],
        [["Ctrl", "Z"], "Undo (Shift: redo)"],
        [["Ctrl", "Enter"], "Apply"],
      ],
    },
  ];
</script>

<div class="backdrop" transition:fade={{ duration: 150 }} onclick={() => (ui.shortcutsOpen = false)} role="presentation">
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" tabindex="-1" transition:scale={{ start: 0.95, duration: 180 }} onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <div class="head">
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <button class="btn ghost icon" onclick={() => (ui.shortcutsOpen = false)} aria-label="Close"><Icon name="close" /></button>
    </div>
    <div class="groups">
      {#each GROUPS as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          <dl>
            {#each group.keys as [keys, what] (what)}
              <dt>{#each keys as k (k)}<kbd>{k}</kbd>{/each}</dt>
              <dd>{what}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
  }
  .sheet {
    width: min(760px, 100%);
    max-height: 100%;
    overflow-y: auto;
    padding: 18px 22px 22px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin-top: 12px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent-2);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 7px 10px;
    margin: 0;
    font-size: 12.5px;
    align-items: center;
  }
  dt {
    display: flex;
    gap: 3px;
  }
  dd {
    margin: 0;
    color: var(--muted);
  }
</style>
