// Caret geometry for <input> and <textarea>.
//
// Browsers do not expose where the caret of a text field is, nor which
// character a point falls on. Both are measured with a "mirror": an invisible
// <div> that copies the field's text styles and contains the text, split so
// the position of each character can be read from the layout.

import type { Caret, FrameWindow } from "../types"

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
  document.body.appendChild(mirror)
  try {
    return measure(mirror)
  } finally {
    mirror.remove()
  }
}

/** An <input> (one line) rather than a <textarea>. */
const isSingleLine = (field: TextField): field is HTMLInputElement => field.tagName === "INPUT"

const displayText = (field: TextField) =>
  isSingleLine(field) && field.type === "password" ? "•".repeat(field.value.length) : field.value

/** Where the caret of a focused text field is, in the page's CSS pixels. */
export function measureCaret(field: TextField): Caret | null {
  const index = field.selectionEnd ?? field.value.length
  const text = displayText(field)
  return withMirror(field, mirror => {
    mirror.textContent = text.slice(0, index)
    const marker = field.ownerDocument.createElement("span")
    // The marker needs content to get a line box; a zero-width space has no width.
    marker.textContent = text.slice(index) || "​"
    mirror.appendChild(marker)

    const rect = field.getBoundingClientRect()
    const computed = windowOf(field).getComputedStyle(field)
    const height = marker.getBoundingClientRect().height || parseFloat(computed.fontSize) * 1.2
    const x = rect.left + marker.offsetLeft - field.scrollLeft
    // A single-line input centres its line vertically; a textarea starts at the top.
    const y =
      isSingleLine(field)
        ? rect.top + (rect.height - height) / 2
        : rect.top + marker.offsetTop - field.scrollTop
    if (x < rect.left - 1 || x > rect.right + 1 || y + height < rect.top || y > rect.bottom) return null
    const color = computed.caretColor === "auto" ? computed.color : computed.caretColor
    return { x, y, height, color }
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
