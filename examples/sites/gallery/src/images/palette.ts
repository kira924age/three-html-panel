// Extracts a colour palette from an image: k-means on a small sample of its pixels.

export interface Swatch {
  hex: string;
  /** Share of the image's pixels closest to this colour, 0..1. */
  weight: number;
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function extractPalette(source: CanvasImageSource, k = 6): Swatch[] {
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const pixels: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2]]);

  // k-means++-like start: spread the initial centres over the colours present.
  const centres: [number, number, number][] = [pixels[Math.floor(pixels.length / 2)]];
  while (centres.length < k) {
    let best = pixels[0];
    let bestDist = -1;
    for (const p of pixels) {
      const d = Math.min(...centres.map((c) => dist(p, c)));
      if (d > bestDist) {
        bestDist = d;
        best = p;
      }
    }
    centres.push([...best]);
  }
  const counts = Array.from({ length: k }, () => 0);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centres.map(() => [0, 0, 0]);
    counts.fill(0);
    for (const p of pixels) {
      let j = 0;
      let d = Infinity;
      centres.forEach((c, i) => {
        const dd = dist(p, c);
        if (dd < d) {
          d = dd;
          j = i;
        }
      });
      counts[j]++;
      sums[j][0] += p[0];
      sums[j][1] += p[1];
      sums[j][2] += p[2];
    }
    centres.forEach((c, i) => {
      if (counts[i]) for (let ch = 0; ch < 3; ch++) c[ch] = sums[i][ch] / counts[i];
    });
  }
  return centres
    .map((c, i) => ({ hex: toHex(...c), weight: counts[i] / pixels.length }))
    .filter((s) => s.weight > 0.01)
    .sort((a, b) => b.weight - a.weight);
}

function dist(a: number[], b: number[]) {
  // A rough perceptual weighting of the channels.
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

/** Hue of a hex colour in degrees (0..360), for sorting by colour. */
export function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Whether text on this colour should be dark. */
export function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
