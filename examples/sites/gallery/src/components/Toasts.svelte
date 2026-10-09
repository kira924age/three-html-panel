<script lang="ts">
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";
  import Icon from "./Icon.svelte";
  import { ui } from "../state/ui.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast" animate:flip={{ duration: 200 }} in:fly={{ y: 20, duration: 220 }} out:fly={{ x: 40, duration: 180 }}>
      <span class="icon"><Icon name="check" size={14} /></span>
      <span class="msg">{toast.message}</span>
      {#if toast.action}
        <button
          class="action"
          onclick={() => {
            toast.action?.run();
            ui.dismiss(toast.id);
          }}>{toast.action.label}</button
        >
      {/if}
      <button class="x" onclick={() => ui.dismiss(toast.id)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 20px;
    translate: -50% 0;
    z-index: 90;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(520px, calc(100vw - 32px));
    padding: 8px 8px 8px 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: #25262e;
    box-shadow: var(--shadow);
    pointer-events: auto;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(61, 220, 132, 0.18);
    color: #3ddc84;
    flex-shrink: 0;
  }
  .msg {
    font-size: 13px;
  }
  .action {
    border: 0;
    background: none;
    color: var(--accent-2);
    font-weight: 600;
    padding: 4px 6px;
  }
  .x {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--faint);
  }
  .x:hover {
    background: rgba(255, 255, 255, 0.06);
  }
</style>
