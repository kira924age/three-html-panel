// Caret geometry for <input> and <textarea>.
//
// Browsers do not expose where the caret of a text field is, nor which
// character a point falls on. Both are measured with a "mirror": an invisible
// <div> that copies the field's text styles and contains the text, split so
// the position of each character can be read from the layout.

import type { Box, Caret, FrameWindow } from "../../types"
import { clipCaret, visibleBoxOf } from "./selection"

export type TextField = HTMLInputElement | HTMLTextAreaElement

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number", ""])

const windowOf = (node: Node) => node.ownerDocument!.defaultView as FrameWindow

export function isTextField(element: Element | null): element is TextField {
  if (!element) return false
  const { HTMLTextAreaElement, HTMLInputElement } = windowOf(element)
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) && !element.readOnly && !element.disabled
  }
  return false
}

const MIRRORED_PROPERTIES = [
  "box-sizing",
  "width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-family",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-transform",
  "text-indent",
  "tab-size",
  "word-break",
  "overflow-wrap"
]

/**
 * Measures with a temporary mirror, then removes it. Adding and removing the
 * mirror is seen by MutationObservers; PageCapture discards those records.
 */
function withMirror<T>(field: TextField, measure: (mirror: HTMLDivElement) => T): T {
  const document = field.ownerDocument
  const mirror = document.createElement("div")
  const computed = windowOf(field).getComputedStyle(field)
  for (const property of MIRRORED_PROPERTIES) {
    mirror.style.setProperty(property, computed.getPropertyValue(property))
  }
  const isInput = isSingleLine(field)
  mirror.style.position = "absolute"
  mirror.style.visibility = "hidden"
  mirror.style.top = "0"
  mirror.style.left = "-100000px"
  mirror.style.overflow = "hidden"
  // A single-line input never wraps; a textarea wraps like the field does.
  mirror.style.whiteSpace = isInput ? "pre" : "pre-wrap"
  if (isInput) mirror.style.width = "auto"
  else {
    // A classic scrollbar (Windows, Linux) takes its room from the text; the
    // mirror has none, so it is made that much narrower. The width stays
    // fractional (clientWidth and offsetWidth are rounded): a line that just
    // fits must wrap where the field's does.
    const length = (property: string) => parseFloat(computed.getPropertyValue(property)) || 0
    const borders = length("border-left-width") + length("border-right-width")
    const paddings = length("padding-left") + length("padding-right")
    const scrollbar = field.offsetWidth - field.clientWidth - Math.round(borders)
    const width = parseFloat(computed.width)
    if (scrollbar > 0 && Number.isFinite(width)) {
      const content = computed.boxSizing === "border-box" ? width - paddings - borders : width
      mirror.style.boxSizing = "content-box"
      mirror.style.width = `${Math.max(0, content - scrollbar)}px`
    }
  }
  document.body.appendChild(mirror)
  try {
    return measure(mirror)
  } finally {
    mirror.remove()
  }
}

/** An <input> (one line) rather than a <textarea>. */
const isSingleLine = (field: TextField): field is HTMLInputElement => field.tagName === "INPUT"

const displayText = (field: TextField, value = field.value) =>
  isSingleLine(field) && field.type === "password" ? "•".repeat(value.length) : value

/** Text being composed with an IME, not yet in the field's value. `cursor` is its caret, within `text`. */
export interface Composition {
  text: string
  cursor: number
}

/**
 * The field's value as it shows while composing: the composition in place of
 * the selection (which the IME replaces), and where the composition starts.
 */
export function composedValue(field: TextField, composition: Composition): { value: string; start: number } {
  const length = field.value.length
  const start = field.selectionStart ?? length
  const end = field.selectionEnd ?? length
  return { value: field.value.slice(0, start) + composition.text + field.value.slice(end), start }
}

/**
 * Where a caret would be at `index`, in the page's CSS pixels, whether or not it
 * is in view. `value` stands in for the field's value (while composing).
 */
export function caretAt(field: TextField, index: number, value?: string): { x: number; y: number; height: number } {
  const text = displayText(field, value)
  return withMirror(field, mirror => {
    const marker = placeMarker(field, mirror, text, index)
    const rect = field.getBoundingClientRect()
    const height = marker.getClientRects()[0]?.height || parseFloat(windowOf(field).getComputedStyle(field).fontSize) * 1.2
    const x = rect.left + marker.offsetLeft - field.scrollLeft
    // A single-line input centres its line vertically; a textarea starts at the top.
    const y = isSingleLine(field) ? rect.top + (rect.height - height) / 2 : rect.top + marker.offsetTop - field.scrollTop
    return { x, y, height }
  })
}

/**
 * Fills the mirror with the text, and a marker at `index`. The marker holds
 * only the character after it, so that it stays on one line; the rest follows,
 * so lines still wrap where the field's do. At a line break or the end, a
 * zero-width space gives it a line box.
 */
function placeMarker(field: TextField, mirror: HTMLDivElement, text: string, index: number): HTMLSpanElement {
  const document = field.ownerDocument
  mirror.textContent = text.slice(0, index)
  const marker = document.createElement("span")
  const next = Array.from(text.slice(index, index + 2))[0] ?? ""
  const markerText = next === "" || next === "\n" ? "\u200b" : next
  marker.textContent = markerText
  mirror.appendChild(marker)
  mirror.appendChild(document.createTextNode(text.slice(index + (markerText === next ? next.length : 0))))
  return marker
}

/**
 * Where the caret of a focused text field is, in the page's CSS pixels, cut to
 * what shows of the field. None while text is selected (browsers do not draw
 * the caret then either), or when the caret is scrolled out of view. While
 * composing, it is the IME's caret.
 */
export function measureCaret(field: TextField, composition?: Composition | null): Caret | null {
  let caret: { x: number; y: number; height: number }
  if (composition) {
    const { value, start } = composedValue(field, composition)
    caret = caretAt(field, start + composition.cursor, value)
  } else {
    if (field.selectionStart !== field.selectionEnd) return null
    caret = caretAt(field, field.selectionEnd ?? field.value.length)
  }
  // A field clips its text to its padding box, and its ancestors may clip it too
  // (a scrolled line half out of view, a field in a box that hides what overflows).
  const shown = clipCaret(caret, visibleBoxOf(field))
  if (!shown) return null
  const computed = windowOf(field).getComputedStyle(field)
  const color = computed.caretColor === "auto" ? computed.color : computed.caretColor
  return { ...shown, color }
}

/** The part of a field that shows its content: the padding box, in the page's CSS pixels. */
function viewOf(field: TextField): Box {
  const rect = field.getBoundingClientRect()
  return { left: rect.left + field.clientLeft, top: rect.top + field.clientTop, width: field.clientWidth, height: field.clientHeight }
}

/** Scrolls the field so that the caret at `index` is in view, as browsers do while typing. */
export function revealIndex(field: TextField, index: number): void {
  const caret = caretAt(field, index)
  const view = viewOf(field)
  const computed = windowOf(field).getComputedStyle(field)
  // Keep the caret inside the padding, not only inside the box.
  const padLeft = parseFloat(computed.paddingLeft) || 0
  const padRight = parseFloat(computed.paddingRight) || 0
  const padTop = parseFloat(computed.paddingTop) || 0
  const padBottom = parseFloat(computed.paddingBottom) || 0
  if (caret.x < view.left + padLeft) field.scrollLeft -= view.left + padLeft - caret.x
  else if (caret.x > view.left + view.width - padRight) field.scrollLeft += caret.x - (view.left + view.width - padRight)
  if (isSingleLine(field)) return
  // A caret is as tall as the text, not the line: where the first one sits
  // unscrolled is the top to keep to, and the same leading goes below the last.
  const top = caretAt(field, 0).y + field.scrollTop - view.top
  const leading = Math.max(0, top - padTop)
  if (caret.y < view.top + top) field.scrollTop -= view.top + top - caret.y
  else if (caret.y + caret.height + leading > view.top + view.height - padBottom) {
    field.scrollTop += caret.y + caret.height + leading - (view.top + view.height - padBottom)
  }
}

/**
 * The index on the visual line above or below the caret at `index` (soft wraps
 * included), at `x` (page CSS pixels) or else the caret's own position; or a
 * page (the field's height) away. Null past the first or last line.
 */
export function verticalIndex(field: TextField, index: number, direction: -1 | 1, page: boolean, x?: number) {
  const caret = caretAt(field, index)
  const distance = page ? Math.max(caret.height, field.clientHeight - caret.height) : caret.height
  const y = caret.y + caret.height / 2 + direction * distance
  const first = caretAt(field, 0)
  const last = caretAt(field, field.value.length)
  if (y < first.y || y > last.y + last.height) return null
  return indexFromPoint(field, x ?? caret.x, y)
}

/**
 * For a scrolled field: the index of the first character to show, and how far
 * from the top (textarea) or left (input) of the padding box it is. The copy in
 * the image cannot be scrolled; leaving out what is scrolled past and moving the
 * rest by that much shows the same. Null when the field is not scrolled.
 */
export function scrolledText(field: TextField): { index: number; offset: number } | null {
  const vertical = !isSingleLine(field)
  const scroll = vertical ? field.scrollTop : field.scrollLeft
  if (scroll <= 0) return null
  const text = displayText(field)
  return withMirror(field, mirror => {
    const at = (index: number) => {
      const marker = placeMarker(field, mirror, text, index)
      return vertical ? marker.offsetTop : marker.offsetLeft
    }
    const origin = at(0)
    // The first character whose line (or position) starts at or after the scroll offset.
    let low = 0
    let high = text.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (at(middle) - origin >= scroll) high = middle
      else low = middle + 1
    }
    return { index: low, offset: at(low) - origin - scroll }
  })
}

/**
 * The rectangles the selected text of a text field covers, one per line, in
 * the page's CSS pixels and clipped to the field. Empty without a selection.
 */
export function measureSelection(field: TextField): Box[] {
  const start = field.selectionStart
  const end = field.selectionEnd
  if (start === null || end === null || start === end) return []
  return measureRange(field, start, end, displayText(field))
}

/** The rectangles the text being composed covers, one per line, like measureSelection. */
export function measureComposition(field: TextField, composition: Composition): Box[] {
  if (composition.text === "") return []
  const { value, start } = composedValue(field, composition)
  return measureRange(field, start, start + composition.text.length, displayText(field, value))
}

/** The rectangles [start, end) of `text`, laid out as in the field, cover. */
function measureRange(field: TextField, start: number, end: number, text: string): Box[] {
  return withMirror(field, mirror => {
    const document = field.ownerDocument
    mirror.textContent = text.slice(0, start)
    const selected = document.createElement("span")
    selected.textContent = text.slice(start, end)
    mirror.appendChild(selected)
    mirror.appendChild(document.createTextNode(text.slice(end)))

    const rect = field.getBoundingClientRect()
    const origin = mirror.getBoundingClientRect()
    const clip = {
      left: rect.left + field.clientLeft,
      top: rect.top + field.clientTop,
      right: rect.left + field.clientLeft + field.clientWidth,
      bottom: rect.top + field.clientTop + field.clientHeight
    }
    const boxes: Box[] = []
    for (const line of Array.from(selected.getClientRects())) {
      const left = rect.left + line.left - origin.left - field.scrollLeft
      // A single-line input centres its line vertically, like measureCaret.
      const top = isSingleLine(field)
        ? rect.top + (rect.height - line.height) / 2
        : rect.top + line.top - origin.top - field.scrollTop
      const x0 = Math.max(left, clip.left)
      const y0 = Math.max(top, clip.top)
      const x1 = Math.min(left + line.width, clip.right)
      const y1 = Math.min(top + line.height, clip.bottom)
      if (x1 > x0 && y1 > y0) boxes.push({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    }
    return boxes
  })
}

/** The character index in a text field closest to a point in the page's CSS pixels. */
export function indexFromPoint(field: TextField, x: number, y: number): number {
  const text = displayText(field)
  if (text.length === 0) return 0
  return withMirror(field, mirror => {
    const document = field.ownerDocument
    const spans = Array.from(text, character => {
      const span = document.createElement("span")
      span.textContent = character
      mirror.appendChild(span)
      return span
    })
    const rect = field.getBoundingClientRect()
    const offsetX = rect.left - field.scrollLeft
    const offsetY = isSingleLine(field) ? 0 : rect.top - field.scrollTop
    let best = text.length
    let bestDistance = Infinity
    spans.forEach((span, index) => {
      const left = offsetX + span.offsetLeft
      const middle = left + span.offsetWidth / 2
      // Single-line inputs only compare horizontally.
      const lineDistance =
        isSingleLine(field) ? 0 : Math.abs(offsetY + span.offsetTop + span.offsetHeight / 2 - y)
      const candidate = x < middle ? index : index + 1
      const distance = lineDistance * 1000 + Math.abs((x < middle ? left : left + span.offsetWidth) - x)
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    })
    return best
  })
}
