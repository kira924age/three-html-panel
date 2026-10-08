<script lang="ts">
  let {
    label,
    value,
    min,
    max,
    step = 1,
    unit = "",
    neutral,
    oninput,
    onchange,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    neutral: number;
    oninput: (value: number) => void;
    onchange: () => void;
  } = $props();

  const id = `slider-${Math.random().toString(36).slice(2, 8)}`;
  const fill = $derived(`${((value - min) / (max - min)) * 100}%`);
  const shown = $derived(`${value > 0 && min < 0 ? "+" : ""}${Number.isInteger(step) ? value : value.toFixed(1)}${unit}`);
</script>

<div class="slider" class:changed={value !== neutral}>
  <div class="top">
    <label for={id}>{label}</label>
    <button
      class="value"
      onclick={() => {
        oninput(neutral);
        onchange();
      }}
      title="Reset"
      disabled={value === neutral}>{shown}</button
    >
  </div>
  <input
    {id}
    type="range"
    {min}
    {max}
    {step}
    {value}
    style:--fill={fill}
    oninput={(e) => oninput(+e.currentTarget.value)}
    onchange={onchange}
    ondblclick={() => {
      oninput(neutral);
      onchange();
    }}
  />
</div>

<style>
  .slider {
    padding: 6px 0;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  label {
    font-size: 12.5px;
    color: var(--muted);
  }
  .changed label {
    color: var(--text);
  }
  .value {
    min-width: 46px;
    padding: 1px 6px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .changed .value {
    color: var(--accent-2);
  }
  .value:not(:disabled):hover {
    background: var(--surface-2);
  }
  .value:disabled {
    cursor: default;
  }
</style>
