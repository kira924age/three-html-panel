// What an edit is, independent of how it is shown: adjustments (CSS filters),
// the orientation, a crop and the strokes drawn over the image. The preview
// shows it with CSS; bake() renders it into a new image with a canvas.

export interface Adjustments {
  brightness: number; // %
  contrast: number; // %
  saturate: number; // %
  hue: number; // deg
  blur: number; // px per 1000 px of image width
  sepia: number; // %
}

export type Rotation = 0 | 90 | 180 | 270;

/** A rectangle in fractions (0..1) of the oriented image. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stroke {
  color: string;
  /** Width in source-image pixels. */
  size: number;
  /** Points in source-image pixels (before orientation), so strokes follow rotation. */
  points: [number, number][];
}

export interface EditState {
  adjust: Adjustments;
  rotation: Rotation;
  flipH: boolean;
  flipV: boolean;
  crop: Rect;
  strokes: Stroke[];
}

export const NEUTRAL: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
  sepia: 0,
};

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

export function initialState(): EditState {
  return {
    adjust: { ...NEUTRAL },
    rotation: 0,
    flipH: false,
    flipV: false,
    crop: { ...FULL },
    strokes: [],
  };
}

export const PRESETS: { name: string; adjust: Partial<Adjustments> }[] = [
  { name: "Original", adjust: {} },
  { name: "Vivid", adjust: { saturate: 160, contrast: 115, brightness: 104 } },
  { name: "Mono", adjust: { saturate: 0, contrast: 125, brightness: 105 } },
  { name: "Warm", adjust: { sepia: 35, saturate: 125, hue: -8, brightness: 104 } },
  { name: "Cool", adjust: { hue: 18, saturate: 90, brightness: 104, contrast: 105 } },
  { name: "Fade", adjust: { contrast: 78, brightness: 112, saturate: 80 } },
  { name: "Drama", adjust: { contrast: 150, brightness: 88, saturate: 115 } },
  { name: "Dream", adjust: { blur: 2, brightness: 110, saturate: 130, contrast: 92 } },
];

export const SLIDERS: {
  key: keyof Adjustments;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}[] = [
  { key: "brightness", label: "Brightness", min: 0, max: 200, step: 1, unit: "%" },
  { key: "contrast", label: "Contrast", min: 0, max: 200, step: 1, unit: "%" },
  { key: "saturate", label: "Saturation", min: 0, max: 250, step: 1, unit: "%" },
  { key: "hue", label: "Hue", min: -180, max: 180, step: 1, unit: "°" },
  { key: "sepia", label: "Warmth", min: 0, max: 100, step: 1, unit: "%" },
  { key: "blur", label: "Blur", min: 0, max: 20, step: 0.5, unit: "" },
];

/** The CSS filter for the adjustments, with the blur scaled for an image shown `width` px wide. */
export function filterCss(a: Adjustments, width: number): string {
  const parts = [
    `brightness(${a.brightness}%)`,
    `contrast(${a.contrast}%)`,
    `saturate(${a.saturate}%)`,
    `sepia(${a.sepia}%)`,
    `hue-rotate(${a.hue}deg)`,
  ];
  if (a.blur > 0) parts.push(`blur(${((a.blur * width) / 1000).toFixed(2)}px)`);
  return parts.join(" ");
}

export function isNeutral(a: Adjustments): boolean {
  return (Object.keys(NEUTRAL) as (keyof Adjustments)[]).every((k) => a[k] === NEUTRAL[k]);
}

/** The oriented image's size. */
export function orientedSize(w: number, h: number, rotation: Rotation) {
  return rotation % 180 === 0 ? { w, h } : { w: h, h: w };
}

/**
 * Source-image pixels to oriented-image pixels: flip, then rotate (the same
 * order as CSS `rotate(r) scale(fx, fy)`).
 */
export function orientMatrix(
  w: number,
  h: number,
  s: Pick<EditState, "rotation" | "flipH" | "flipV">,
): DOMMatrix {
  const o = orientedSize(w, h, s.rotation);
  return new DOMMatrix()
    .translate(o.w / 2, o.h / 2)
    .rotate(s.rotation)
    .scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1)
    .translate(-w / 2, -h / 2);
}

/** The crop rectangle after rotating the image a quarter turn clockwise. */
export function rotateRect(r: Rect): Rect {
  return { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
}

export const flipRectH = (r: Rect): Rect => ({ ...r, x: 1 - r.x - r.w });
export const flipRectV = (r: Rect): Rect => ({ ...r, y: 1 - r.y - r.h });

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.size;
    if (s.points.length === 1) {
      const [x, y] = s.points[0];
      ctx.beginPath();
      ctx.arc(x, y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s.points[0][0], s.points[0][1]);
    // Smooth the line through the midpoints.
    for (let i = 1; i < s.points.length - 1; i++) {
      const [x, y] = s.points[i];
      const [nx, ny] = s.points[i + 1];
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    const last = s.points[s.points.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }
}

/** Renders the edit at full resolution into a new canvas. */
export function bake(image: HTMLImageElement, state: EditState): HTMLCanvasElement {
  const w = image.naturalWidth,
    h = image.naturalHeight;
  const o = orientedSize(w, h, state.rotation);
  const full = document.createElement("canvas");
  full.width = o.w;
  full.height = o.h;
  const ctx = full.getContext("2d")!;
  const m = orientMatrix(w, h, state);
  ctx.setTransform(m);
  // Blur is relative to the image's own width (before orientation).
  ctx.filter = filterCss(state.adjust, w);
  ctx.drawImage(image, 0, 0);
  ctx.filter = "none";
  drawStrokes(ctx, state.strokes);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const c = state.crop;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(c.w * o.w));
  out.height = Math.max(1, Math.round(c.h * o.h));
  out
    .getContext("2d")!
    .drawImage(full, c.x * o.w, c.y * o.h, c.w * o.w, c.h * o.h, 0, 0, out.width, out.height);
  return out;
}
