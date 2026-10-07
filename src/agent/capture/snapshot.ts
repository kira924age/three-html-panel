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
// - running animations are frozen at their current values
// - images and canvases must be embedded as data URLs
//
// The copy is built in an inert document, so <img> elements in it never start
// loading anything.
//
// Type checks on live elements use the page's window (see FrameWindow).

import type { Box, FrameWindow } from "../../types"
import { scrollbarsOf, type Scrollbar } from "../input/scrollbars"
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
}

const toKebabCase = (property: string) =>
  property.startsWith("--") ? property : property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

const KEYFRAME_META_KEYS = new Set(["offset", "computedOffset", "easing", "composite"])

/**
 * The properties each element currently has animated, keyed by element.
 * Pseudo-element animations cannot be copied into an inline style and are left out.
 */
function collectAnimatedProperties(document: Document, window: FrameWindow): Map<Element, Set<string>> {
  const result = new Map<Element, Set<string>>()
  if (typeof document.getAnimations !== "function") return result
  for (const animation of document.getAnimations()) {
    const effect = animation.effect
    if (!(effect instanceof window.KeyframeEffect) || !effect.target || effect.pseudoElement) continue
    let properties = result.get(effect.target)
    if (!properties) result.set(effect.target, (properties = new Set()))
    for (const keyframe of effect.getKeyframes()) {
      for (const key of Object.keys(keyframe)) {
        if (!KEYFRAME_META_KEYS.has(key)) properties.add(toKebabCase(key))
      }
    }
    // CSS transitions report their property here rather than in the keyframes.
    if (typeof window.CSSTransition !== "undefined" && animation instanceof window.CSSTransition) {
      properties.add(animation.transitionProperty)
    }
  }
  return result
}

class Snapshotter {
  // A separate document without a browsing context, so the copies never load anything.
  private readonly inert = globalThis.document.implementation.createHTMLDocument("")
  private readonly window: FrameWindow
  private readonly animated: Map<Element, Set<string>>
  private readonly focusWithin = new Set<Element>()
  /** Scrollbars to draw over the copy. */
  readonly scrollbars: Scrollbar[] = []

  constructor(
    private readonly document: Document,
    private readonly options: SnapshotOptions
  ) {
    this.window = document.defaultView as FrameWindow
    this.animated = collectAnimatedProperties(document, this.window)
    for (let element = options.focused; element; element = element.parentElement) this.focusWithin.add(element)
  }

  copy(live: Node): Node | null {
    if (live.nodeType === Node.TEXT_NODE) return this.inert.importNode(live, false)
    if (live.nodeType !== Node.ELEMENT_NODE) return null
    const element = live as Element
    if (SKIPPED_ELEMENTS.has(element.tagName) || this.options.ignored?.has(element)) return null

    if (element instanceof this.window.HTMLCanvasElement) return this.copyCanvas(element)

    const copy = this.inert.importNode(element, false) as Element
    this.copyFormState(element, copy)
    this.copyImage(element, copy)
    this.copyInteractionState(element, copy)
    this.copyAnimatedValues(element, copy)

    // <head> carries no visible content, but keep the element so the structure stays valid.
    if (element.tagName === "HEAD") return copy

    const children = element.tagName === "TEXTAREA" ? [] : Array.from(element.childNodes)
    for (const child of children) {
      const childCopy = this.copy(child)
      if (childCopy) copy.appendChild(childCopy)
    }
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
        copy.setAttribute("value", element.value)
      }
    } else if (element instanceof HTMLTextAreaElement) {
      copy.textContent = element.value
    } else if (element instanceof HTMLOptionElement) {
      copy.toggleAttribute("selected", element.selected)
    }
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

  private copyInteractionState(element: Element, copy: Element): void {
    if (this.options.hovered.has(element)) copy.setAttribute(HOVER_ATTRIBUTE, "")
    if (this.options.active.has(element)) copy.setAttribute(ACTIVE_ATTRIBUTE, "")
    if (this.options.focused === element) copy.setAttribute(FOCUS_ATTRIBUTE, "")
    if (this.focusWithin.has(element)) copy.setAttribute(FOCUS_WITHIN_ATTRIBUTE, "")
  }

  private copyAnimatedValues(element: Element, copy: Element): void {
    const properties = this.animated.get(element)
    if (!properties || !(copy instanceof HTMLElement || copy instanceof SVGElement)) return
    const computed = this.window.getComputedStyle(element)
    for (const property of properties) {
      const value = computed.getPropertyValue(property)
      if (value) copy.style.setProperty(property, value, "important")
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
function drawScrollbars(root: HTMLElement, bars: readonly Scrollbar[]): void {
  const box = (left: number, top: number, width: number, height: number, css: string) =>
    drawBox(root, left, top, width, height, css)
  for (const { track, thumb, gutter } of bars) {
    if (gutter) box(track.left, track.top, track.width, track.height, `background:${SCROLLBAR_TRACK_COLOR}`)
    const width = Math.max(0, thumb.width - 2 * SCROLLBAR_INSET)
    const height = Math.max(0, thumb.height - 2 * SCROLLBAR_INSET)
    const style = `background:${SCROLLBAR_THUMB_COLOR};border-radius:${Math.min(width, height) / 2}px`
    box(thumb.left + SCROLLBAR_INSET, thumb.top + SCROLLBAR_INSET, width, height, style)
  }
}

/** Serializes the page as XHTML (an <html> element with the XHTML namespace). */
export function snapshotDocument(document: Document, options: SnapshotOptions): string {
  const snapshotter = new Snapshotter(document, options)
  const root = snapshotter.copy(document.documentElement) as HTMLElement
  root.style.setProperty("width", `${document.documentElement.clientWidth}px`)
  root.style.setProperty("height", `${document.documentElement.clientHeight}px`)
  root.style.setProperty("overflow", "hidden")
  // In the root, not <body>: a scrolled <body> is translated, which would move fixed boxes with it.
  for (const { left, top, width, height } of options.selection ?? []) {
    drawBox(root, left, top, width, height, `background:${SELECTION_COLOR}`)
  }
  drawScrollbars(root, snapshotter.scrollbars)
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
