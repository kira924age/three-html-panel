// The gallery's initial collection: what each generated image is, and how to make it.

import { addGrain, painters, rng } from "./paint";
import { extractPalette, type Swatch } from "./palette";

export interface Photo {
  id: string;
  title: string;
  description: string;
  tags: string[];
  /** ISO date. */
  date: string;
  location: string;
  width: number;
  height: number;
  /** Full-size image (an object URL of a JPEG). */
  src: string;
  /** A small version for grids and filmstrips. */
  thumb: string;
  bytes: number;
  palette: Swatch[];
  favorite: boolean;
  featured: boolean;
  /** For edited copies: the photo it was made from. */
  editedFrom?: string;
  generator: string;
  seed: number;
}

interface Entry {
  title: string;
  painter: keyof typeof painters;
  w: number;
  h: number;
  tags: string[];
  date: string;
  location: string;
  description: string;
  featured?: boolean;
}

export const CATALOG: Entry[] = [
  {
    title: "Alpine Dawn",
    painter: "alpine",
    w: 1200,
    h: 800,
    tags: ["landscape", "mountains", "warm"],
    date: "2026-09-14",
    location: "Dolomites",
    description: "Layered ridges dissolving into a pink morning haze.",
    featured: true,
  },
  {
    title: "Northern Veil",
    painter: "aurora",
    w: 1200,
    h: 800,
    tags: ["landscape", "night", "cool"],
    date: "2026-02-03",
    location: "Tromsø",
    description: "Aurora ribbons over a frozen pine forest.",
    featured: true,
  },
  {
    title: "Golden Dunes",
    painter: "dunes",
    w: 800,
    h: 1100,
    tags: ["landscape", "desert", "warm"],
    date: "2025-11-21",
    location: "Erg Chebbi",
    description: "Wind-carved dunes catching the late sun.",
  },
  {
    title: "Last Light",
    painter: "ocean",
    w: 1400,
    h: 700,
    tags: ["landscape", "sea", "warm"],
    date: "2026-07-30",
    location: "Big Sur",
    description: "The sun dipping under a quiet Pacific horizon.",
    featured: true,
  },
  {
    title: "Neon Skyline",
    painter: "city",
    w: 1000,
    h: 1000,
    tags: ["city", "night"],
    date: "2026-05-12",
    location: "Shinjuku",
    description: "Lit windows stacking up under a violet dusk.",
    featured: true,
  },
  {
    title: "Mirror Lake",
    painter: "forest",
    w: 1200,
    h: 800,
    tags: ["landscape", "nature", "cool"],
    date: "2026-06-08",
    location: "Banff",
    description: "Pines doubled in perfectly still water.",
  },
  {
    title: "Rose Bloom",
    painter: "meshRose",
    w: 800,
    h: 1000,
    tags: ["abstract", "gradient", "warm"],
    date: "2026-03-19",
    location: "Studio",
    description: "Soft mesh gradient in rose, peach and violet.",
  },
  {
    title: "Lagoon",
    painter: "meshLagoon",
    w: 1200,
    h: 800,
    tags: ["abstract", "gradient", "cool"],
    date: "2026-01-27",
    location: "Studio",
    description: "Teal and indigo light blending in deep water tones.",
    featured: true,
  },
  {
    title: "Bauhaus No. 4",
    painter: "bauhaus",
    w: 900,
    h: 1125,
    tags: ["geometric", "minimal"],
    date: "2025-10-02",
    location: "Studio",
    description: "Primary forms on a warm paper ground.",
  },
  {
    title: "Low Poly Ember",
    painter: "lowpoly",
    w: 1200,
    h: 800,
    tags: ["geometric", "abstract", "warm"],
    date: "2026-04-11",
    location: "Studio",
    description: "A triangulated gradient from coral to midnight.",
  },
  {
    title: "Tidal Bands",
    painter: "waves",
    w: 1000,
    h: 1000,
    tags: ["abstract", "sea"],
    date: "2025-12-15",
    location: "Studio",
    description: "Stacked sine waves in ocean and saffron.",
  },
  {
    title: "Interference",
    painter: "rings",
    w: 1200,
    h: 800,
    tags: ["geometric", "abstract", "night"],
    date: "2026-08-22",
    location: "Studio",
    description: "Two ring fields overlapping into a moiré.",
    featured: true,
  },
  {
    title: "Lavender Rows",
    painter: "lavender",
    w: 1200,
    h: 800,
    tags: ["landscape", "nature"],
    date: "2026-07-04",
    location: "Valensole",
    description: "Purple furrows running to a lone tree.",
  },
  {
    title: "Moonlit Bay",
    painter: "moon",
    w: 800,
    h: 1100,
    tags: ["landscape", "night", "sea", "cool"],
    date: "2026-09-29",
    location: "Algarve",
    description: "A full moon laying a path across the bay.",
  },
  {
    title: "Contours",
    painter: "contour",
    w: 1000,
    h: 1000,
    tags: ["abstract", "minimal", "cool"],
    date: "2025-09-18",
    location: "Studio",
    description: "Topographic lines tracing an imaginary terrain.",
  },
  {
    title: "Prism",
    painter: "prism",
    w: 1400,
    h: 700,
    tags: ["abstract", "night", "geometric"],
    date: "2026-02-20",
    location: "Studio",
    description: "White light split into a spectrum.",
    featured: true,
  },
  {
    title: "Terrazzo",
    painter: "terrazzo",
    w: 900,
    h: 1125,
    tags: ["geometric", "minimal", "warm"],
    date: "2026-05-30",
    location: "Studio",
    description: "Scattered stone chips set in plaster.",
  },
  {
    title: "Red Canyon",
    painter: "canyon",
    w: 1200,
    h: 800,
    tags: ["landscape", "desert", "warm"],
    date: "2025-08-09",
    location: "Utah",
    description: "Banded cliffs falling into a narrow gorge.",
  },
];

/** Encodes a canvas as a JPEG object URL. */
export async function encode(
  canvas: HTMLCanvasElement,
  quality = 0.86,
): Promise<{ url: string; bytes: number }> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality,
    ),
  );
  return { url: URL.createObjectURL(blob), bytes: blob.size };
}

/** A small copy of `source` for thumbnails, `width` wide. */
export function downscale(source: HTMLCanvasElement, width: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((source.height / source.width) * width);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Makes a photo from a finished canvas: encodes it and its thumbnail, and extracts its palette. */
export async function photoFromCanvas(
  canvas: HTMLCanvasElement,
  meta: Omit<Photo, "src" | "thumb" | "bytes" | "palette" | "width" | "height">,
): Promise<Photo> {
  const small = downscale(canvas, 480);
  const [full, thumb] = await Promise.all([encode(canvas), encode(small, 0.8)]);
  return {
    ...meta,
    width: canvas.width,
    height: canvas.height,
    src: full.url,
    thumb: thumb.url,
    bytes: full.bytes,
    palette: extractPalette(small),
  };
}

/** Paints the catalog's images one at a time, yielding to the page in between. */
export async function* generateCatalog(): AsyncGenerator<Photo> {
  for (const [i, entry] of CATALOG.entries()) {
    await new Promise((r) => setTimeout(r, 0));
    const canvas = document.createElement("canvas");
    canvas.width = entry.w;
    canvas.height = entry.h;
    const ctx = canvas.getContext("2d")!;
    const seed = 1000 + i * 7919;
    painters[entry.painter](ctx, entry.w, entry.h, rng(seed));
    addGrain(ctx, entry.w, entry.h);
    yield await photoFromCanvas(canvas, {
      id: `p${i + 1}`,
      title: entry.title,
      description: entry.description,
      tags: entry.tags,
      date: entry.date,
      location: entry.location,
      favorite: i % 5 === 1,
      featured: !!entry.featured,
      generator: entry.painter,
      seed,
    });
  }
}
