// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { probeScaling } from "./frame-renderer"

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
