// Draws SVG snapshots of the page into a canvas that backs a texture.
//
// The SVG is loaded as an image: a browser renders the <foreignObject> inside
// it, which is the only way to rasterize HTML into a canvas today.

import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from "three"
import type { Frame } from "./types"

export interface FrameRendererOptions {
  /** The page size in CSS pixels. Frames of any other size are dropped. */
  width: number
  height: number
  /** Canvas pixels per CSS pixel. */
  pixelRatio: number
  /** Painted under the page, for pages that do not paint their own background. */
  background: string
  onDraw?: () => void
}

/** The longest canvas side; some mobile GPUs cannot hold larger textures. */
const MAX_CANVAS_LENGTH = 4096

export function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = "async"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("the frame could not be decoded"))
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
  })
}

/**
 * A frame with a box-shadow ring, like a focus ring: an element at (100, 60),
 * 100x50, ringed 4px wide. At 2x, the ring's left side covers x 192..200.
 */
const PROBE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">` +
  `<foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" ` +
  `style="position:absolute;left:100px;top:60px;width:100px;height:50px;box-shadow:0 0 0 4px rgb(0,0,255)"></div>` +
  `</foreignObject></svg>`
const PROBE_POINT = { x: 196, y: 170 }

export type Scaling = "drawImage" | "bitmap"

/** Whether the probe's ring is where it should be on a canvas the probe frame was drawn on at 2x. */
function ringInPlace(context: CanvasRenderingContext2D): boolean {
  const [red, green, blue] = context.getImageData(PROBE_POINT.x, PROBE_POINT.y, 1, 1).data
  return blue! > 200 && red! < 80 && green! < 80
}

function probeCanvas(): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas")
  canvas.width = 800
  canvas.height = 600
  return canvas.getContext("2d")
}

/**
 * How to scale frames to the canvas. drawImage, unless it draws box-shadows in
 * the wrong place (WebKit does, when it scales an SVG image) and
 * createImageBitmap's resize draws them right (WebKit does) without making the
 * canvas unreadable (Chrome would taint it; WebGL refuses a tainted canvas).
 * Tried once with the probe frame; anything unexpected keeps drawImage.
 */
export async function probeScaling(load: (svg: string) => Promise<HTMLImageElement> = loadSvg): Promise<Scaling> {
  try {
    const image = await load(PROBE_SVG)
    const direct = probeCanvas()
    if (!direct) return "drawImage"
    direct.drawImage(image, 0, 0, 800, 600)
    if (ringInPlace(direct) || typeof createImageBitmap !== "function") return "drawImage"
    const bitmap = await createImageBitmap(image, { resizeWidth: 800, resizeHeight: 600, resizeQuality: "high" })
    const viaBitmap = probeCanvas()
    if (!viaBitmap) return "drawImage"
    viaBitmap.drawImage(bitmap, 0, 0)
    bitmap.close()
    return ringInPlace(viaBitmap) ? "bitmap" : "drawImage"
  } catch {
    return "drawImage"
  }
}

/**
 * Scales frames to the canvas the way probeScaling chose, probed once. If a
 * bitmap fails later anyway (a real frame is larger than the probe's, and
 * Safari can refuse one under its memory limit), that frame and all the next
 * ones are drawn with drawImage: shadows misplaced rather than no frames.
 */
export class FrameScaler {
  private scaling: Promise<Scaling> | null = null

  constructor(private readonly probe: () => Promise<Scaling> = probeScaling) {}

  /** What to draw for `image` at width x height: the image itself, or a bitmap to close after drawing. */
  async scale(image: HTMLImageElement, width: number, height: number): Promise<CanvasImageSource> {
    if ((await (this.scaling ??= this.probe())) !== "bitmap") return image
    try {
      return await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" })
    } catch {
      this.scaling = Promise.resolve("drawImage")
      return image
    }
  }
}

const sharedScaler = new FrameScaler()

export class FrameRenderer {
  readonly canvas = document.createElement("canvas")
  readonly texture: CanvasTexture
  private readonly context: CanvasRenderingContext2D
  private pending: Frame | null = null
  private drawing = false
  private disposed = false
  private paused = false

  constructor(private readonly options: FrameRendererOptions) {
    const ratio = Math.min(options.pixelRatio, MAX_CANVAS_LENGTH / Math.max(options.width, options.height))
    this.canvas.width = Math.round(options.width * ratio)
    this.canvas.height = Math.round(options.height * ratio)
    this.context = this.canvas.getContext("2d")!
    this.clear()
    this.texture = new CanvasTexture(this.canvas)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.minFilter = LinearMipmapLinearFilter
    this.texture.magFilter = LinearFilter
  }

  /**
   * Queues a frame. Frames of the wrong size (taken while the iframe was being
   * resized) are dropped. While a frame is being decoded, only the newest of
   * the frames that arrive is kept, and while paused.
   */
  submit(frame: Frame): void {
    if (frame.width !== this.options.width || frame.height !== this.options.height) return
    this.pending = frame
    if (!this.drawing && !this.paused) void this.drain()
  }

  /**
   * Paused (the panel is not seen), frames are kept rather than drawn; resumed,
   * the newest of them is. A page that sends frames anyway costs no drawing.
   */
  setPaused(paused: boolean): void {
    this.paused = paused
    if (!paused && this.pending && !this.drawing) void this.drain()
  }

  /** Paints the background only, e.g. when the page failed to load. */
  clear(): void {
    this.context.fillStyle = this.options.background
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)
    if (this.texture) this.texture.needsUpdate = true
  }

  dispose(): void {
    this.disposed = true
    this.pending = null
    this.texture.dispose()
  }

  private async drain(): Promise<void> {
    this.drawing = true
    while (this.pending && !this.disposed && !this.paused) {
      const frame = this.pending
      this.pending = null
      try {
        const image = await loadSvg(frame.svg)
        const { width, height } = this.canvas
        const source = await sharedScaler.scale(image, width, height)
        if (this.disposed) {
          if (source !== image) (source as ImageBitmap).close()
          continue
        }
        this.context.fillStyle = this.options.background
        this.context.fillRect(0, 0, width, height)
        // At the canvas's size either way (a browser that ignored the resize still fits).
        this.context.drawImage(source, 0, 0, width, height)
        if (source !== image) (source as ImageBitmap).close()
        this.texture.needsUpdate = true
        this.options.onDraw?.()
      } catch {
        // A frame that does not decode is skipped; the next one may.
      }
    }
    this.drawing = false
  }
}
