// Copies the live page into an XHTML string that can go inside an SVG
// <foreignObject>.
//
// Serializing the DOM is not enough on its own, because a lot of what is on
// screen is not in the markup:
//
// - form state (value, checked, selected) lives in properties, not attributes
// - scroll positions are not rendered by foreignObject at all, and the real
//   scrollbars would not show them either: they are replaced (scrollbars.ts)
// - interaction states (:hover, :focus) are expressed as attributes, see css.ts
// - animations are frozen: finite ones as they will end, the others as they are
//   now (see collectAnimatedValues)
// - images and canvases must be embedded as data URLs, and a video as its
//   current frame
//
// The copy is built in an inert document, so <img> elements in it never start
// loading anything.
//
// Type checks on live elements use the page's window (see FrameWindow).

import type { Box, FrameWindow } from "../../types"
import { scrolledText } from "../input/caret"
import { scrollbarsOf, type Scrollbar } from "../input/scrollbars"
import type { PopupView } from "../input/select-popup"
import { ACTIVE_ATTRIBUTE, FOCUS_ATTRIBUTE, FOCUS_WITHIN_ATTRIBUTE, HOVER_ATTRIBUTE } from "./css"

/** Elements that do not contribute to what is on screen. <style> is collected separately. */
const SKIPPED_ELEMENTS = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE", "STYLE", "LINK", "META", "TITLE", "BASE", "IFRAME"])

export interface SnapshotOptions {
  hovered: ReadonlySet<Element>
  active: ReadonlySet<Element>
  focused: Element | null
  /** Elements added to the page only for measuring (e.g. the caret mirror); left out of the copy. */
  ignored?: ReadonlySet<Element>
  /** Returns a data URL for an image, or null if it is not available yet. */
  inlineImage: (url: string) => string | null
  /** The selected text in the focused field, as measured by measureSelection(). */
  selection?: readonly Box[]
  /** The page's ::selection background, if any; a default is used when it is transparent. */
  selectionColor?: string
  /**
   * Text being composed with an IME in a field: the value it shows while
   * composing, which goes into the copy only (never into the page), and the
   * boxes the composed text covers, underlined.
   */
  composition?: { field: Element; value: string; boxes: readonly Box[]; color: string } | null
  /**
   * Text being composed with an IME in a contenteditable element: shown, in the
   * copy only, where the selection starts (in place of the selected text when
   * that is within one text node), underlined.
   */
  inlineComposition?: { node: Node; offset: number; endOffset: number; text: string } | null
  /** The scrollbar being hovered or pressed, drawn darker. */
  scrollbar?: { element: Element; axis: "x" | "y"; state: "hover" | "active" } | null
  /** The open list of a <select>, drawn over everything. */
  selectPopup?: PopupView | null
}

/** A video's attributes that mean nothing on the image that stands for it. */
const VIDEO_ATTRIBUTES = new Set(["src", "poster", "controls", "autoplay", "loop", "muted", "preload", "playsinline", "crossorigin"])
/** A video frame is drawn at most this many times its size on the page (the panel's pixel ratio is not known here). */
const VIDEO_SCALE = 2

const toKebabCase = (property: string) =>
  property.startsWith("--") ? property : property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

const KEYFRAME_META_KEYS = new Set(["offset", "computedOffset", "easing", "composite"])

/** Whether `animation` is a CSS transition. Checked by shape: the page is another realm in tests. */
const isTransition = (animation: Animation) => "transitionProperty" in animation

/**
 * Which end of its keyframes (0 or 1) a finite animation stops at, from its
 * direction and iteration count; null if it does not stop at an end (infinite,
 * or a fractional count such as 1.5).
 */
export function endOffsetOf(timing: EffectTiming): 0 | 1 | null {
  const iterations = timing.iterations ?? 1
  if (!Number.isInteger(iterations) || iterations < 1) return null
  const last = iterations - 1
  const reversed =
    timing.direction === "reverse" ||
    (timing.direction === "alternate" && last % 2 === 1) ||
    (timing.direction === "alternate-reverse" && last % 2 === 0)
  return reversed ? 0 : 1
}

/** Whether an animation's value is copied as it is now, so the panel must keep sampling it. */
export function isSampledLive(animation: Animation): boolean {
  if (isTransition(animation)) return false
  const effect = animation.effect as KeyframeEffect | null
  return animation.playState === "paused" || endOffsetOf(effect?.getTiming?.() ?? {}) === null
}

/**
 * The animated values to bake into each element's copy: property (kebab-case)
 * to value, where null means the live document's value now.
 *
 * Browsers can hold back rendering in the panel's iframe (to them it is a
 * cross-origin frame the user never touches), for up to a second in Chrome,
 * and animations do not advance meanwhile. Copying their values now would show
 * a fade-in still transparent long after it should have ended. So animations
 * that end are copied as they will be at the end:
 * - transitions, and animations that do not fill forwards, end on the element's
 *   own style, which the image shows anyway: nothing is baked
 * - animations that fill forwards (or both) end on their last keyframe
 * - animations that repeat forever, and paused ones, are copied as they are now
 * Pseudo-element animations cannot go into an inline style and are left out.
 */
function collectAnimatedValues(document: Document): Map<Element, Map<string, string | null>> {
  const result = new Map<Element, Map<string, string | null>>()
  if (typeof document.getAnimations !== "function") return result
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null
    if (!effect?.target || effect.pseudoElement || typeof effect.getKeyframes !== "function") continue
    if (isTransition(animation)) continue
    let values = result.get(effect.target)
    if (!values) result.set(effect.target, (values = new Map()))
    const keyframes = effect.getKeyframes()

    if (isSampledLive(animation)) {
      for (const keyframe of keyframes) {
        for (const key of Object.keys(keyframe)) if (!KEYFRAME_META_KEYS.has(key)) values.set(toKebabCase(key), null)
      }
      continue
    }
    const timing = effect.getTiming()
    if (timing.fill !== "forwards" && timing.fill !== "both") continue
    // A property missing from the end keyframe ends on the element's own style.
    const endOffset = endOffsetOf(timing)
    for (const keyframe of keyframes) {
      if (keyframe.computedOffset !== endOffset) continue
      for (const [key, value] of Object.entries(keyframe)) {
        if (!KEYFRAME_META_KEYS.has(key) && typeof value === "string") values.set(toKebabCase(key), value)
      }
    }
  }
  return result
}

class Snapshotter {
  // A separate document without a browsing context, so the copies never load anything.
  private readonly inert = globalThis.document.implementation.createHTMLDocument("")
  private readonly window: FrameWindow
  private readonly animated: Map<Element, Map<string, string | null>>
  private readonly focusWithin = new Set<Element>()
  /** Scrollbars to draw over the copy. */
  readonly scrollbars: Scrollbar[] = []

  constructor(
    private readonly document: Document,
    private readonly options: SnapshotOptions
  ) {
    this.window = document.defaultView as FrameWindow
    this.animated = collectAnimatedValues(document)
    for (let element = options.focused; element; element = element.parentElement) this.focusWithin.add(element)
  }

  copy(live: Node): Node | null {
    if (live.nodeType === Node.TEXT_NODE) {
      const composition = this.options.inlineComposition
      if (composition?.node === live) return this.composedText(live as Text, composition)
      return this.inert.importNode(live, false)
    }
    if (live.nodeType !== Node.ELEMENT_NODE) return null
    const element = live as Element
    if (SKIPPED_ELEMENTS.has(element.tagName) || this.options.ignored?.has(element)) return null

    if (element instanceof this.window.HTMLCanvasElement) return this.copyCanvas(element)
    if (element instanceof this.window.HTMLVideoElement) return this.copyVideo(element)

    const copy = this.inert.importNode(element, false) as Element
    this.copyFormState(element, copy)
    this.copyImage(element, copy)
    this.copyInteractionState(element, copy)
    this.copyAnimatedValues(element, copy)

    // <head> carries no visible content, but keep the element so the structure stays valid.
    if (element.tagName === "HEAD") return copy

    const children = element.tagName === "TEXTAREA" ? [] : Array.from(element.childNodes)
    // Composed text between two children (an empty line of an editable, say).
    const composition = this.options.inlineComposition
    const composedAt = composition?.node === element ? composition.offset : -1
    children.forEach((child, index) => {
      if (index === composedAt) copy.appendChild(this.composedSpan(composition!.text))
      const childCopy = this.copy(child)
      if (childCopy) copy.appendChild(childCopy)
    })
    if (composedAt === children.length) copy.appendChild(this.composedSpan(composition!.text))
    this.copyScroll(element, copy)
    this.hideScrollbars(element, copy)
    return copy
  }

  private copyFormState(element: Element, copy: Element): void {
    const { HTMLInputElement, HTMLTextAreaElement, HTMLOptionElement } = this.window
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") {
        copy.toggleAttribute("checked", element.checked)
      } else if (element.type !== "file") {
        const value = this.shownValue(element)
        copy.setAttribute("value", value)
        // Only text inputs have a selection, and scroll their text.
        if (element.selectionStart !== null) this.copyTextScroll(element, copy, value)
      }
    } else if (element instanceof HTMLTextAreaElement) {
      const value = this.shownValue(element)
      copy.textContent = value
      this.copyTextScroll(element, copy, value)
    } else if (element instanceof HTMLOptionElement) {
      copy.toggleAttribute("selected", element.selected)
    }
  }

  /**
   * A text field's own scroll is not drawn either. Leave out the text scrolled
   * past and move the rest into place with the padding (measured, see
   * scrolledText). A line only partly scrolled past is left out whole.
   */
  private copyTextScroll(field: HTMLInputElement | HTMLTextAreaElement, copy: Element, value: string): void {
    const scrolled = scrolledText(field)
    if (!scrolled || !(copy instanceof HTMLElement)) return
    const isInput = field.tagName === "INPUT"
    const rest = value.slice(scrolled.index)
    if (isInput) copy.setAttribute("value", rest)
    else copy.textContent = rest
    const side = isInput ? "padding-left" : "padding-top"
    const padding = parseFloat(this.window.getComputedStyle(field).getPropertyValue(side)) || 0
    copy.style.setProperty(side, `${padding + scrolled.offset}px`, "important")
  }

  /** A field's value, or what it shows while text is composed in it. */
  private shownValue(field: HTMLInputElement | HTMLTextAreaElement): string {
    const composition = this.options.composition
    return composition?.field === field ? composition.value : field.value
  }

  private copyImage(element: Element, copy: Element): void {
    if (!(element instanceof this.window.HTMLImageElement)) return
    copy.removeAttribute("srcset")
    copy.removeAttribute("loading")
    const source = element.currentSrc || element.src
    const dataUrl = source ? this.options.inlineImage(source) : null
    if (dataUrl) copy.setAttribute("src", dataUrl)
    else copy.removeAttribute("src")
  }

  private copyCanvas(canvas: HTMLCanvasElement): Node | null {
    const image = this.inert.createElement("img")
    for (const attribute of Array.from(canvas.attributes)) image.setAttribute(attribute.name, attribute.value)
    try {
      image.setAttribute("src", canvas.toDataURL())
    } catch {
      // A canvas tainted by cross-origin content cannot be read.
    }
    const { width, height } = canvas.getBoundingClientRect()
    image.style.width = `${width}px`
    image.style.height = `${height}px`
    return image
  }

  private composedSpan(text: string): Element {
    const span = this.inert.createElement("span")
    span.setAttribute("style", "text-decoration: underline")
    span.textContent = text
    return span
  }

  /** A text node with the composed text in it, in place of what the composition replaces. */
  private composedText(text: Text, composition: NonNullable<SnapshotOptions["inlineComposition"]>): Node {
    const fragment = this.inert.createDocumentFragment()
    fragment.append(text.data.slice(0, composition.offset), this.composedSpan(composition.text), text.data.slice(composition.endOffset))
    return fragment
  }

  /** A video, as an image of the frame it shows (its poster before it plays). */
  private copyVideo(video: HTMLVideoElement): Node {
    const image = this.inert.createElement("img")
    for (const attribute of Array.from(video.attributes)) {
      if (!VIDEO_ATTRIBUTES.has(attribute.name)) image.setAttribute(attribute.name, attribute.value)
    }
    const showsPoster = video.poster !== "" && video.paused && video.currentTime === 0
    const poster = video.poster ? this.options.inlineImage(video.poster) : null
    const source = showsPoster ? (poster ?? this.videoFrame(video)) : (this.videoFrame(video) ?? poster)
    if (source) image.setAttribute("src", source)
    const { width, height } = video.getBoundingClientRect()
    const computed = this.window.getComputedStyle(video)
    image.style.setProperty("box-sizing", "border-box")
    image.style.setProperty("width", `${width}px`)
    image.style.setProperty("height", `${height}px`)
    // A video letterboxes its frame by default; an image would stretch it.
    image.style.setProperty("object-fit", computed.objectFit)
    image.style.setProperty("object-position", computed.objectPosition)
    this.copyInteractionState(video, image)
    return image
  }

  /** The frame a video shows now, as a data URL; null before it has one, or if it cannot be read (cross-origin). */
  private videoFrame(video: HTMLVideoElement): string | null {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null
    const { width } = video.getBoundingClientRect()
    const scale = Math.min(1, (VIDEO_SCALE * Math.max(1, width)) / video.videoWidth)
    const canvas = this.document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext("2d")
    if (!context) return null
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL("image/jpeg", 0.85)
    } catch {
      // A video from another origin without CORS taints the canvas.
      return null
    }
  }

  private copyInteractionState(element: Element, copy: Element): void {
    if (this.options.hovered.has(element)) copy.setAttribute(HOVER_ATTRIBUTE, "")
    if (this.options.active.has(element)) copy.setAttribute(ACTIVE_ATTRIBUTE, "")
    if (this.options.focused === element) copy.setAttribute(FOCUS_ATTRIBUTE, "")
    if (this.focusWithin.has(element)) copy.setAttribute(FOCUS_WITHIN_ATTRIBUTE, "")
  }

  private copyAnimatedValues(element: Element, copy: Element): void {
    const values = this.animated.get(element)
    if (!values?.size || !(copy instanceof HTMLElement || copy instanceof SVGElement)) return
    const computed = this.window.getComputedStyle(element)
    for (const [property, value] of values) {
      const baked = value ?? computed.getPropertyValue(property)
      if (baked) copy.style.setProperty(property, baked, "important")
    }
  }

  private copyScroll(element: Element, copy: Element): void {
    const scrollingElement = this.document.scrollingElement
    // The document's own scroll is applied to <body>; <html> must not move.
    if (element === scrollingElement) return
    const isBody = element === this.document.body
    const { scrollLeft, scrollTop } = isBody && scrollingElement ? scrollingElement : element
    if (scrollLeft === 0 && scrollTop === 0) return
    if (isBody && copy instanceof HTMLElement) {
      copy.style.setProperty("translate", `${-scrollLeft}px ${-scrollTop}px`)
      return
    }
    // foreignObject renders every scroll container at its origin. Shift the
    // children instead. The individual `translate` property composes with any
    // `transform` the child already has. Bare text directly inside a scroll
    // container does not move (a known limitation).
    for (const child of Array.from(copy.children)) {
      if (child instanceof HTMLElement || child instanceof SVGElement) {
        child.style.setProperty("translate", `${-scrollLeft}px ${-scrollTop}px`)
      }
    }
  }

  /**
   * The copy is not scrolled, so its real scrollbars would show the wrong
   * position: hide them, keeping the room a classic scrollbar takes, and
   * remember them to be drawn by drawScrollbars().
   */
  private hideScrollbars(element: Element, copy: Element): void {
    const bars = scrollbarsOf(element)
    if (bars.length === 0) return
    this.scrollbars.push(...bars)
    // The document's scrollbars are the viewport's; the root copy never shows any.
    if (element === this.document.scrollingElement || !(copy instanceof HTMLElement)) return
    copy.style.setProperty("overflow", "hidden", "important")
    if (bars.some(bar => bar.gutter)) copy.style.setProperty("scrollbar-gutter", "stable", "important")
  }
}

// The image cannot show a text field's selection, so it is drawn over the field.
const SELECTION_COLOR = "rgb(51 144 255 / 35%)"
const SCROLLBAR_TRACK_COLOR = "rgb(0 0 0 / 5%)"
const SCROLLBAR_THUMB_COLOR = "rgb(0 0 0 / 38%)"
const SCROLLBAR_THUMB_HOVER_COLOR = "rgb(0 0 0 / 52%)"
const SCROLLBAR_THUMB_ACTIVE_COLOR = "rgb(0 0 0 / 64%)"
const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$/
const SCROLLBAR_INSET = 2

/** Adds a fixed box on top of everything to the root copy. */
function drawBox(root: HTMLElement, left: number, top: number, width: number, height: number, css: string): void {
  const element = root.ownerDocument.createElement("div")
  element.setAttribute(
    "style",
    `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;` +
      `margin:0;padding:0;border:0;pointer-events:none;z-index:2147483647;${css}`
  )
  root.appendChild(element)
}

/** Adds the scrollbars on top of everything, as fixed boxes in the root copy. */
function drawScrollbars(root: HTMLElement, bars: readonly Scrollbar[], state: SnapshotOptions["scrollbar"]): void {
  const box = (left: number, top: number, width: number, height: number, css: string) =>
    drawBox(root, left, top, width, height, css)
  for (const { element, axis, track, thumb, gutter } of bars) {
    if (gutter) box(track.left, track.top, track.width, track.height, `background:${SCROLLBAR_TRACK_COLOR}`)
    const width = Math.max(0, thumb.width - 2 * SCROLLBAR_INSET)
    const height = Math.max(0, thumb.height - 2 * SCROLLBAR_INSET)
    const current = state?.element === element && state.axis === axis ? state.state : null
    const color =
      current === "active" ? SCROLLBAR_THUMB_ACTIVE_COLOR : current === "hover" ? SCROLLBAR_THUMB_HOVER_COLOR : SCROLLBAR_THUMB_COLOR
    const style = `background:${color};border-radius:${Math.min(width, height) / 2}px`
    box(thumb.left + SCROLLBAR_INSET, thumb.top + SCROLLBAR_INSET, width, height, style)
  }
}

const POPUP_HIGHLIGHT = "rgb(30 110 220)"

/** Draws the open list of a <select>, as a fixed box over everything. */
function drawSelectPopup(root: HTMLElement, view: PopupView): void {
  const document = root.ownerDocument
  const list = document.createElement("div")
  const { left, top, width, height } = view.box
  list.setAttribute(
    "style",
    `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;box-sizing:border-box;` +
      "margin:0;padding:0;border:1px solid rgb(118 118 118);background:#fff;color:#000;overflow:hidden;" +
      "box-shadow:0 2px 8px rgb(0 0 0 / 25%);pointer-events:none;z-index:2147483647;text-align:left;" +
      `font:${view.font};line-height:${view.itemHeight}px;letter-spacing:normal;text-transform:none`
  )
  for (const item of view.items) {
    const row = document.createElement("div")
    const indent = item.grouped ? 20 : 8
    const color = item.highlighted ? "#fff" : item.disabled && item.index >= 0 ? "rgb(128 128 128)" : "#000"
    const background = item.highlighted ? POPUP_HIGHLIGHT : item.selected ? "rgb(0 0 0 / 8%)" : "transparent"
    row.setAttribute(
      "style",
      `height:${view.itemHeight}px;padding:0 8px 0 ${indent}px;margin:0;white-space:pre;overflow:hidden;` +
        `text-overflow:ellipsis;color:${color};background:${background};font-weight:${item.index < 0 ? "bold" : "normal"}`
    )
    row.textContent = item.label
    list.appendChild(row)
  }
  root.appendChild(list)
}

/** Serializes the page as XHTML (an <html> element with the XHTML namespace). */
export function snapshotDocument(document: Document, options: SnapshotOptions): string {
  const snapshotter = new Snapshotter(document, options)
  const root = snapshotter.copy(document.documentElement) as HTMLElement
  root.style.setProperty("width", `${document.documentElement.clientWidth}px`)
  root.style.setProperty("height", `${document.documentElement.clientHeight}px`)
  root.style.setProperty("overflow", "hidden")
  // In the root, not <body>: a scrolled <body> is translated, which would move fixed boxes with it.
  // The highlight is drawn over the text, not under it: the page's color (often
  // opaque) is multiplied in, which keeps dark text on a light field readable.
  const pageColor = options.selectionColor && !TRANSPARENT.test(options.selectionColor) ? options.selectionColor : null
  const css = pageColor ? `background:${pageColor};mix-blend-mode:multiply` : `background:${SELECTION_COLOR}`
  for (const { left, top, width, height } of options.selection ?? []) drawBox(root, left, top, width, height, css)
  // Composed text is underlined, as IMEs do.
  if (options.composition) {
    const { boxes, color } = options.composition
    for (const box of boxes) {
      const thickness = Math.max(1, Math.round(box.height / 14))
      drawBox(root, box.left, box.top + box.height - thickness, box.width, thickness, `background:${color}`)
    }
  }
  drawScrollbars(root, snapshotter.scrollbars, options.scrollbar)
  if (options.selectPopup) drawSelectPopup(root, options.selectPopup)
  return new XMLSerializer().serializeToString(root)
}

/** Wraps the page's XHTML and CSS in an SVG document of the given size. */
export function buildFrameSvg(xhtml: string, css: string, width: number, height: number): string {
  // "]]>" inside CSS would end the CDATA section early.
  const safeCss = css.replace(/]]>/g, "]]]]><![CDATA[>")
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style><![CDATA[${safeCss}]]></style>` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject>` +
    `</svg>`
  )
}
