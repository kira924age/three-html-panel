// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { FrameRenderer, FrameScaler, probeScaling } from "./frame-renderer"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const image = new Image()
const load = () => Promise.resolve(image)
const bitmap = { close: () => {} }

/**
 * Canvases on which the probe's ring lands where it should, or not, depending on
 * whether the frame was drawn directly or through a bitmap; and whether reading
 * a canvas that had a bitmap drawn on it throws (a tainted canvas).
 */
function browser(options: { directInPlace: boolean; bitmapInPlace: boolean; bitmapTaints?: boolean }) {
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap))
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    let drawn: unknown = null
    return {
      drawImage: (source: unknown) => (drawn = source),
      getImageData: () => {
        const viaBitmap = drawn === bitmap
        if (viaBitmap && options.bitmapTaints) throw new DOMException("tainted", "SecurityError")
        const inPlace = viaBitmap ? options.bitmapInPlace : options.directInPlace
        return { data: inPlace ? [0, 0, 255, 255] : [255, 255, 255, 255] }
      }
    } as unknown as CanvasRenderingContext2D
  })
}

describe("probeScaling", () => {
  it("keeps drawImage where it draws box-shadows in place (Chrome, Firefox)", async () => {
    browser({ directInPlace: true, bitmapInPlace: true })
    expect(await probeScaling(load)).toBe("drawImage")
  })

  it("scales through createImageBitmap where drawImage misplaces box-shadows and the bitmap does not (WebKit)", async () => {
    browser({ directInPlace: false, bitmapInPlace: true })
    expect(await probeScaling(load)).toBe("bitmap")
  })

  it("keeps drawImage when the bitmap would not help or would taint the canvas", async () => {
    browser({ directInPlace: false, bitmapInPlace: false })
    expect(await probeScaling(load)).toBe("drawImage")
    browser({ directInPlace: false, bitmapInPlace: true, bitmapTaints: true })
    expect(await probeScaling(load)).toBe("drawImage")
  })

  it("keeps drawImage without createImageBitmap, or when the probe fails", async () => {
    browser({ directInPlace: false, bitmapInPlace: true })
    vi.stubGlobal("createImageBitmap", undefined)
    expect(await probeScaling(load)).toBe("drawImage")
    expect(await probeScaling(() => Promise.reject(new Error("decode")))).toBe("drawImage")
  })
})

describe("FrameScaler", () => {
  it("scales through a bitmap where the probe chose it", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap))
    const scaler = new FrameScaler(async () => "bitmap")
    expect(await scaler.scale(image, 1920, 1280)).toBe(bitmap)
    expect(createImageBitmap).toHaveBeenCalledWith(image, expect.objectContaining({ resizeWidth: 1920, resizeHeight: 1280 }))
  })

  it("draws the image itself from then on when a bitmap fails (Safari's memory limit)", async () => {
    const create = vi.fn(async () => Promise.reject(new Error("out of memory")))
    vi.stubGlobal("createImageBitmap", create)
    const scaler = new FrameScaler(async () => "bitmap")
    expect(await scaler.scale(image, 4096, 2731)).toBe(image)
    expect(await scaler.scale(image, 4096, 2731)).toBe(image)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("probes once, and draws the image itself where the probe chose drawImage", async () => {
    const probe = vi.fn(async () => "drawImage" as const)
    const scaler = new FrameScaler(probe)
    expect(await scaler.scale(image, 800, 600)).toBe(image)
    expect(await scaler.scale(image, 800, 600)).toBe(image)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})

describe("FrameRenderer", () => {
  it("keeps the frames that come while paused, and draws only the newest when resumed", async () => {
    // The SVGs it starts to decode (none decodes: drawing is not what this is about).
    const decoded: string[] = []
    vi.stubGlobal(
      "Image",
      class {
        decoding = ""
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(value: string) {
          decoded.push(decodeURIComponent(value.slice(value.indexOf(",") + 1)))
          queueMicrotask(() => this.onerror?.())
        }
      }
    )
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: () => {},
      drawImage: () => {}
    } as unknown as CanvasRenderingContext2D)
    const renderer = new FrameRenderer({ width: 10, height: 10, pixelRatio: 1, background: "#fff" })
    renderer.setPaused(true)
    renderer.submit({ svg: "<svg>1</svg>", width: 10, height: 10 })
    renderer.submit({ svg: "<svg>2</svg>", width: 10, height: 10 })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(decoded).toEqual([])
    renderer.setPaused(false)
    await vi.waitFor(() => expect(decoded).toEqual(["<svg>2</svg>"]))
    renderer.submit({ svg: "<svg>3</svg>", width: 10, height: 10 })
    await vi.waitFor(() => expect(decoded).toEqual(["<svg>2</svg>", "<svg>3</svg>"]))
    renderer.dispose()
  })

  it("does not go on to the next frame once paused while one was being decoded", async () => {
    const decoded: string[] = []
    const finish: (() => void)[] = []
    vi.stubGlobal(
      "Image",
      class {
        decoding = ""
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(value: string) {
          decoded.push(decodeURIComponent(value.slice(value.indexOf(",") + 1)))
          finish.push(() => this.onerror?.())
        }
      }
    )
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: () => {},
      drawImage: () => {}
    } as unknown as CanvasRenderingContext2D)
    const renderer = new FrameRenderer({ width: 10, height: 10, pixelRatio: 1, background: "#fff" })
    renderer.submit({ svg: "<svg>1</svg>", width: 10, height: 10 })
    renderer.setPaused(true)
    renderer.submit({ svg: "<svg>2</svg>", width: 10, height: 10 })
    finish.shift()!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(decoded).toEqual(["<svg>1</svg>"])
    renderer.setPaused(false)
    await vi.waitFor(() => expect(decoded).toEqual(["<svg>1</svg>", "<svg>2</svg>"]))
    renderer.dispose()
  })
})
