<script lang="ts" module>
  // Icons as stroked 24×24 paths (in the style of Lucide).
  const PATHS = {
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35",
    heart: "M19.5 12.6 12 20l-7.5-7.4A4.9 4.9 0 0 1 12 6.1a4.9 4.9 0 0 1 7.5 6.5z",
    left: "M15 18l-6-6 6-6",
    right: "M9 18l6-6-6-6",
    close: "M18 6 6 18M6 6l12 12",
    zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35M11 8v6M8 11h6",
    zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35M8 11h6",
    info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 16v-4M12 8h.01",
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
    sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    crop: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
    brush: "M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z",
    undo: "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
    redo: "M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13",
    rotate: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
    rotateLeft: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
    flipH: "M12 3v18M8 7 3 12l5 5M16 7l5 5-5 5",
    flipV: "M3 12h18M7 8l5-5 5 5M7 16l5 5 5-5",
    compare: "M12 3v18M5 5h4v14H5zM15 5h4v14h-4",
    check: "M20 6 9 17l-5-5",
    sparkle: "M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z",
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
    keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
    trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
    chevronDown: "M6 9l6 6 6-6",
    sort: "M3 6h18M6 12h12M10 18h4",
    image: "M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21",
    reset: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5",
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 18, fill = false }: { name: IconName; size?: number; fill?: boolean } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={fill ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
