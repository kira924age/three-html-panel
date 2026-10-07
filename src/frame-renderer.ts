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

function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = "async"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("the frame could not be decoded"))
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
  })
}

export class FrameRenderer {
  readonly canvas = document.createElement("canvas")
  readonly texture: CanvasTexture
  private readonly context: CanvasRenderingContext2D
  private pending: Frame | null = null
  private drawing = false
  private disposed = false

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
   * the frames that arrive is kept.
   */
  submit(frame: Frame): void {
    if (frame.width !== this.options.width || frame.height !== this.options.height) return
    this.pending = frame
    if (!this.drawing) void this.drain()
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
    while (this.pending && !this.disposed) {
      const frame = this.pending
      this.pending = null
      try {
        const image = await loadSvg(frame.svg)
        if (this.disposed) continue
        this.context.fillStyle = this.options.background
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)
        this.context.drawImage(image, 0, 0, this.canvas.width, this.canvas.height)
        this.texture.needsUpdate = true
        this.options.onDraw?.()
      } catch {
        // A frame that does not decode is skipped; the next one may.
      }
    }
    this.drawing = false
  }
}
