// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { endOffsetOf, isSampledLive, snapshotDocument } from "./snapshot"

afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

/** A fake Web Animation on `target` (jsdom has none). */
function animation(
  target: Element,
  keyframes: Record<string, unknown>[],
  timing: EffectTiming,
  extra: { playState?: AnimationPlayState; transition?: boolean } = {}
): Animation {
  const effect = { target, pseudoElement: null, getKeyframes: () => keyframes, getTiming: () => timing }
  return {
    effect,
    playState: extra.playState ?? "running",
    ...(extra.transition ? { transitionProperty: "opacity" } : {})
  } as unknown as Animation
}

/** Snapshots the page with these animations running, and returns the copy of #box. */
function snapshotWith(animations: (box: Element) => Animation[]): HTMLElement {
  document.body.innerHTML = `<div id="box" style="opacity: 0.3"></div>`
  const box = document.querySelector("#box")!
  document.getAnimations = () => animations(box)
  const xhtml = snapshotDocument(document, { hovered: new Set(), active: new Set(), focused: null, inlineImage: () => null })
  const copy = new DOMParser().parseFromString(xhtml, "application/xhtml+xml")
  return copy.getElementById("box") as HTMLElement
}

describe("animated values in the image", () => {
  it("shows an animation that fills forwards at its last keyframe, not where the stalled clock has it", () => {
    const copy = snapshotWith(box => [
      animation(box, [{ offset: 0, computedOffset: 0, opacity: "0" }, { offset: 1, computedOffset: 1, opacity: "1" }], {
        fill: "forwards",
        iterations: 1
      })
    ])
    expect(copy.style.getPropertyValue("opacity")).toBe("1")
    expect(copy.style.getPropertyPriority("opacity")).toBe("important")
  })

  it("leaves an animation that does not fill forwards, and a transition, to the element's own style", () => {
    const fadeIn = snapshotWith(box => [
      animation(box, [{ computedOffset: 0, opacity: "0" }, { computedOffset: 1, opacity: "0.9" }], { fill: "none", iterations: 1 })
    ])
    // Baked values are important; the element's own inline style is not.
    expect(fadeIn.style.getPropertyPriority("opacity")).toBe("")
    const transition = snapshotWith(box => [
      animation(box, [{ computedOffset: 0, opacity: "0" }, { computedOffset: 1, opacity: "1" }], { fill: "both" }, { transition: true })
    ])
    expect(transition.style.getPropertyPriority("opacity")).toBe("")
  })

  it("copies endless and paused animations as they are now", () => {
    const spinning = snapshotWith(box => [
      animation(box, [{ computedOffset: 0, opacity: "0" }, { computedOffset: 1, opacity: "1" }], {
        iterations: Number.POSITIVE_INFINITY
      })
    ])
    // jsdom's computed value is the element's own; in a browser, the animated one.
    expect(spinning.style.getPropertyValue("opacity")).toBe("0.3")
    expect(spinning.style.getPropertyPriority("opacity")).toBe("important")
  })
})

describe("text being composed", () => {
  it("shows in the copy, not in the page, and is underlined", () => {
    document.body.innerHTML = `<input id="name" value="ab">`
    const field = document.querySelector<HTMLInputElement>("#name")!
    document.getAnimations = () => []
    const xhtml = snapshotDocument(document, {
      hovered: new Set(),
      active: new Set(),
      focused: field,
      inlineImage: () => null,
      composition: { field, value: "aにほb", boxes: [{ left: 10, top: 5, width: 30, height: 14 }], color: "rgb(0, 0, 0)" }
    })
    const copy = new DOMParser().parseFromString(xhtml, "application/xhtml+xml")
    expect(copy.getElementById("name")!.getAttribute("value")).toBe("aにほb")
    expect(field.value).toBe("ab")
    // The underline: as wide as the composed text, at the bottom of its line.
    expect(xhtml).toMatch(/left:10px;top:18px;width:30px;height:1px;[^"]*background:rgb\(0, 0, 0\)/)
  })
})

describe("endOffsetOf", () => {
  it("finds the end a finite animation stops at", () => {
    expect(endOffsetOf({})).toBe(1)
    expect(endOffsetOf({ direction: "reverse" })).toBe(0)
    expect(endOffsetOf({ direction: "alternate", iterations: 2 })).toBe(0)
    expect(endOffsetOf({ direction: "alternate", iterations: 3 })).toBe(1)
    expect(endOffsetOf({ direction: "alternate-reverse", iterations: 1 })).toBe(0)
    expect(endOffsetOf({ iterations: Number.POSITIVE_INFINITY })).toBeNull()
    expect(endOffsetOf({ iterations: 1.5 })).toBeNull()
  })

  it("samples live only what does not end on a keyframe", () => {
    const box = document.createElement("div")
    expect(isSampledLive(animation(box, [], { iterations: 1 }))).toBe(false)
    expect(isSampledLive(animation(box, [], { iterations: Number.POSITIVE_INFINITY }))).toBe(true)
    expect(isSampledLive(animation(box, [], { iterations: 1 }, { playState: "paused" }))).toBe(true)
    expect(isSampledLive(animation(box, [], {}, { transition: true }))).toBe(false)
  })
})

describe("what the browser draws outside the page", () => {
  const snapshot = (options: Partial<Parameters<typeof snapshotDocument>[1]> = {}) => {
    const xhtml = snapshotDocument(document, { hovered: new Set(), active: new Set(), focused: null, inlineImage: () => null, ...options })
    return new DOMParser().parseFromString(xhtml, "application/xhtml+xml")
  }

  it("shows a video as an image of its frame, sized and fitted like the video", () => {
    document.body.innerHTML = `<video id="clip" class="wide" src="clip.mp4" controls autoplay></video>`
    const video = document.querySelector<HTMLVideoElement>("#clip")!
    video.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180)
    Object.defineProperties(video, {
      readyState: { value: 4 },
      videoWidth: { value: 1280 },
      videoHeight: { value: 720 },
      paused: { value: false }
    })
    const drawn: number[][] = []
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: (_source: unknown, ...box: number[]) => drawn.push(box)
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,FRAME")
    const image = snapshot().getElementById("clip")!
    expect(image.tagName).toBe("img")
    expect(image.getAttribute("src")).toBe("data:image/jpeg;base64,FRAME")
    expect(image.getAttribute("class")).toBe("wide")
    // Not the video's own attributes, which mean nothing on an image.
    expect(image.hasAttribute("controls")).toBe(false)
    expect(image.getAttribute("style")).toContain("width: 320px")
    // At most twice the size it is shown at.
    expect(drawn).toEqual([[0, 0, 640, 360]])
  })

  it("shows the poster before the video plays, and nothing from a video it cannot read", () => {
    document.body.innerHTML = `<video id="clip" poster="poster.png"></video><video id="other"></video>`
    const posterUrl = new URL("poster.png", document.baseURI).href
    const copy = snapshot({ inlineImage: url => (url === posterUrl ? "data:image/png;base64,POSTER" : null) })
    expect(copy.getElementById("clip")!.getAttribute("src")).toBe("data:image/png;base64,POSTER")
    expect(copy.getElementById("other")!.hasAttribute("src")).toBe(false)
  })

  it("leaves out a frame that cannot be read (a video from another origin)", () => {
    document.body.innerHTML = `<video id="clip"></video>`
    const video = document.querySelector<HTMLVideoElement>("#clip")!
    Object.defineProperties(video, { readyState: { value: 4 }, videoWidth: { value: 640 }, videoHeight: { value: 360 } })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: () => {} } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new DOMException("tainted", "SecurityError")
    })
    expect(snapshot().getElementById("clip")!.hasAttribute("src")).toBe(false)
  })

  it("shows text composed in an editable in place, underlined, only in the copy", () => {
    document.body.innerHTML = `<div id="editor" contenteditable="true">hello world</div>`
    const text = document.querySelector("#editor")!.firstChild!
    const copy = snapshot({ inlineComposition: { node: text, offset: 6, endOffset: 11, text: "にほん" } })
    const editor = copy.getElementById("editor")!
    expect(editor.textContent).toBe("hello にほん")
    expect(editor.querySelector("span")!.getAttribute("style")).toContain("underline")
    expect(document.querySelector("#editor")!.textContent).toBe("hello world")
  })

  it("shows text composed on an empty line, between the editable's children", () => {
    document.body.innerHTML = `<div id="editor" contenteditable="true"><p>a</p><p id="empty"><br></p></div>`
    const empty = document.querySelector("#empty")!
    const copy = snapshot({ inlineComposition: { node: empty, offset: 0, endOffset: 0, text: "か" } })
    expect(copy.getElementById("empty")!.textContent).toBe("か")
    // At the end of an element: after its last child (or in an empty one).
    const editor = document.querySelector("#editor")!
    const atEnd = snapshot({ inlineComposition: { node: editor, offset: 2, endOffset: 2, text: "き" } })
    expect(atEnd.getElementById("editor")!.lastElementChild!.textContent).toBe("き")
  })

  it("draws the open list of a <select> over the page, with its items", () => {
    document.body.innerHTML = `<p>page</p>`
    const copy = snapshot({
      selectPopup: {
        box: { left: 10, top: 40, width: 120, height: 42 },
        itemHeight: 20,
        font: "16px serif",
        items: [
          { label: "Fruit", index: -1, disabled: true, grouped: false, highlighted: false, selected: false },
          { label: "<Apple>", index: 0, disabled: false, grouped: true, highlighted: true, selected: true }
        ]
      }
    })
    const list = copy.documentElement.lastElementChild!
    expect(list.getAttribute("style")).toContain("position:fixed;left:10px;top:40px;width:120px;height:42px")
    expect(Array.from(list.children, row => row.textContent)).toEqual(["Fruit", "<Apple>"])
    expect(list.children[0]!.getAttribute("style")).toContain("font-weight:bold")
    expect(list.children[1]!.getAttribute("style")).toContain("color:#fff")
  })
})
