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
