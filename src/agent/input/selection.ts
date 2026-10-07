// The page's own selection (window.getSelection()) outside <input> and
// <textarea>: text selected by dragging over the page, and the caret and
// selection of contenteditable elements.
//
// Untrusted mousedown does not move it, so presses and drags place it here
// (input.ts). It is the page's real selection: the page reads it with
// getSelection(), and Selection.modify() and execCommand() act on it
// (contenteditable.ts). The image cannot show it, so it is measured here and
// drawn over the copy, like a text field's selection.

import type { Box, FrameWindow } from "../../types"
import { wordAt } from "./editing"

/** A position in the page's text: a node and an offset in it, as in a Range. */
export interface Point {
  node: Node
  offset: number
}

/** The most boxes measured for a selection; a selection of a whole long page draws its first ones. */
const MAX_SELECTION_BOXES = 2000

const windowOf = (node: Node) => (node.ownerDocument ?? (node as Document)).defaultView as FrameWindow

const elementOf = (node: Node): Element | null =>
  node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement

/** The outermost contenteditable element `node` is in (the editing host), or null. */
export function editingHostOf(node: Node | null): HTMLElement | null {
  const start = node ? elementOf(node) : null
  if (!start) return null
  const { HTMLElement } = windowOf(start)
  if (!(start instanceof HTMLElement) || !start.isContentEditable) return null
  let host: HTMLElement = start
  while (host.parentElement instanceof HTMLElement && host.parentElement.isContentEditable) host = host.parentElement
  return host
}

/**
 * Whether text in `element` can be selected: not where user-select is none
 * (unless it is editable, which is always selectable).
 */
export function isSelectable(element: Element): boolean {
  const window = windowOf(element)
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node instanceof window.HTMLElement && node.isContentEditable) return true
    const style = window.getComputedStyle(node) as CSSStyleDeclaration & { webkitUserSelect?: string }
    const value = style.userSelect || style.webkitUserSelect || "auto"
    if (value === "none") return false
    if (value === "text" || value === "all") return true
  }
  return true
}

/**
 * The text position at a point (CSS px of the viewport), or null where there is
 * none to select: outside text, in a text field (whose text is its own), or
 * where user-select is none.
 */
export function pointAt(document: Document, x: number, y: number): Point | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let point: Point | null = null
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y)
    if (position) point = { node: position.offsetNode, offset: position.offset }
  } else if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y)
    if (range) point = { node: range.startContainer, offset: range.startOffset }
  }
  if (!point) return null
  const element = elementOf(point.node)
  if (!element || element.closest("input, textarea, select") || !isSelectable(element)) return null
  return point
}

/** -1 if `a` comes before `b` in the document, 1 after, 0 if they are the same position. */
export function comparePoints(a: Point, b: Point): -1 | 0 | 1 {
  const range = (a.node.ownerDocument ?? (a.node as Document)).createRange()
  range.setStart(a.node, a.offset)
  // comparePoint tells where `b` is relative to the collapsed range at `a`.
  return -range.comparePoint(b.node, b.offset) as -1 | 0 | 1
}

/** The word at a text position, as two positions; just the position where there is no word. */
export function wordAround(point: Point): [Point, Point] {
  if (point.node.nodeType !== Node.TEXT_NODE) return [point, point]
  const [start, end] = wordAt((point.node as Text).data, point.offset)
  return [
    { node: point.node, offset: start },
    { node: point.node, offset: end }
  ]
}

/** The block (paragraph, list item...) a text position is in, as two positions spanning its content. */
export function blockAround(point: Point): [Point, Point] {
  const window = windowOf(point.node)
  let block = elementOf(point.node)
  while (block && block.parentElement && /^(inline|contents)/.test(window.getComputedStyle(block).display)) {
    block = block.parentElement
  }
  if (!block) return [point, point]
  return [
    { node: block, offset: 0 },
    { node: block, offset: block.childNodes.length }
  ]
}

/** The page's selection, if it is not collapsed (an editable's caret is collapsed). */
export function selectedRange(window: FrameWindow): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  return selection.getRangeAt(0)
}

/**
 * The part of the viewport an element shows its content in: the viewport,
 * cut by every ancestor that clips what overflows it.
 */
function clipOf(element: Element | null, viewport: Box, cache: Map<Element, Box>): Box {
  if (!element) return viewport
  const cached = cache.get(element)
  if (cached) return cached
  const window = windowOf(element)
  const parentClip = clipOf(element.parentElement, viewport, cache)
  let clip = parentClip
  const style = window.getComputedStyle(element)
  if (element !== element.ownerDocument.documentElement && element !== element.ownerDocument.body) {
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      const rect = element.getBoundingClientRect()
      const own = {
        left: rect.left + element.clientLeft,
        top: rect.top + element.clientTop,
        width: element.clientWidth,
        height: element.clientHeight
      }
      clip = intersect(parentClip, own)
    }
  }
  cache.set(element, clip)
  return clip
}

/**
 * The part of the viewport where an element's content shows: its padding box
 * (a text field clips its text there), cut by every ancestor that clips what
 * overflows it.
 */
export function visibleBoxOf(element: Element): Box {
  const document = element.ownerDocument
  const viewport = { left: 0, top: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
  const rect = element.getBoundingClientRect()
  const own = { left: rect.left + element.clientLeft, top: rect.top + element.clientTop, width: element.clientWidth, height: element.clientHeight }
  return intersect(clipOf(element.parentElement, viewport, new Map()), own)
}

/**
 * A caret cut to what shows of it, as browsers draw it: the part outside the
 * box is not drawn (a line scrolled half out of a field). Null if none shows.
 */
export function clipCaret<T extends { x: number; y: number; height: number }>(caret: T, box: Box): T | null {
  // A caret at the very edge of the box (the end of a full line) still shows.
  if (caret.x < box.left - 1 || caret.x > box.left + box.width + 1) return null
  const top = Math.max(caret.y, box.top)
  const bottom = Math.min(caret.y + caret.height, box.top + box.height)
  if (bottom - top < 1) return null
  return { ...caret, y: top, height: bottom - top }
}

function intersect(a: Box, b: Box): Box {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/**
 * The boxes the selected text covers, in CSS px of the viewport: one per line
 * of each text node, cut to what is shown (a scrolled box hides the rest).
 * Measured per text node: a range's own rectangles would also cover every
 * element it contains whole.
 */
export function selectionBoxes(window: FrameWindow, range: Range): Box[] {
  const document = window.document
  const viewport = { left: 0, top: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
  const clips = new Map<Element, Box>()
  const boxes: Box[] = []
  const root = range.commonAncestorContainer
  const texts: Text[] = []
  if (root.nodeType === Node.TEXT_NODE) texts.push(root as Text)
  else {
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (range.intersectsNode(node)) texts.push(node as Text)
    }
  }
  const part = document.createRange()
  for (const text of texts) {
    const parent = text.parentElement
    if (!parent || parent.closest("script, style, textarea, select")) continue
    part.setStart(text, text === range.startContainer ? range.startOffset : 0)
    part.setEnd(text, text === range.endContainer ? range.endOffset : text.length)
    if (part.collapsed) continue
    const clip = clipOf(parent, viewport, clips)
    for (const rect of Array.from(part.getClientRects())) {
      const box = intersect(clip, { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      if (box.width > 0 && box.height > 0) boxes.push(box)
      if (boxes.length === MAX_SELECTION_BOXES) return boxes
    }
  }
  return boxes
}

/**
 * The selected text as it reads on screen, for copying: white space collapsed
 * where CSS collapses it, a line break for <br> and between blocks. The
 * selection's own toString() gives the source's white space in some browsers
 * when the page is not painted (the panel's iframe is transparent).
 * Stops once the text is longer than `limit` (the caller then drops it).
 */
export function selectedText(window: FrameWindow, range: Range, limit = Infinity): string {
  const document = window.document
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT | window.NodeFilter.SHOW_ELEMENT)
  const nodes: Node[] = root.nodeType === Node.TEXT_NODE ? [root] : []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (range.intersectsNode(node)) nodes.push(node)
  // Text nodes share their parents and blocks: look each element up once.
  const blocks = new Map<Element, Element | null>()
  /** Each parent's white-space, or null where its text is not shown. */
  const spaces = new Map<Element, string | null>()
  const blockOf = (element: Element): Element | null => {
    const known = blocks.get(element)
    if (known !== undefined) return known
    const parent = element.parentElement
    const block = parent && /^(inline|contents)/.test(window.getComputedStyle(element).display) ? blockOf(parent) : element
    blocks.set(element, block)
    return block
  }
  let text = ""
  let lastBlock: Element | null = null
  const breakLine = () => {
    text = text.replace(/ +$/, "")
    if (text !== "" && !text.endsWith("\n")) text += "\n"
  }
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName === "BR") {
        text = text.replace(/ +$/, "") + "\n"
      }
      continue
    }
    const parent = node.parentElement
    if (!parent) continue
    let space = spaces.get(parent)
    if (space === undefined) {
      const style = window.getComputedStyle(parent)
      const hidden =
        parent.closest("script, style, textarea, select, noscript, template") !== null ||
        style.display === "none" ||
        style.visibility === "hidden"
      space = hidden ? null : style.whiteSpace
      spaces.set(parent, space)
    }
    if (space === null) continue
    const block = blockOf(parent)
    if (lastBlock && block !== lastBlock) breakLine()
    lastBlock = block
    const data = (node as Text).data
    let part = data.slice(node === range.startContainer ? range.startOffset : 0, node === range.endContainer ? range.endOffset : data.length)
    if (space === "pre-line") part = part.replace(/[ \t]+/g, " ")
    else if (!/^(pre|break-spaces)/.test(space)) {
      part = part.replace(/[ \t\n\r\f]+/g, " ")
      // Collapsed white space at the start of a line is not shown.
      if (text === "" || text.endsWith("\n") || text.endsWith(" ")) part = part.replace(/^ /, "")
    }
    text += part
    if (text.length > limit) return text
  }
  return text.replace(/ +$/, "")
}

/** The page's ::selection background where the selection starts, if it sets one. */
export function selectionColorAt(window: FrameWindow, range: Range): string | undefined {
  const element = elementOf(range.startContainer)
  return element ? window.getComputedStyle(element, "::selection").backgroundColor : undefined
}

/** A CSS font shorthand for an element's text, for measuring it on a canvas. */
export function fontOf(element: Element): string {
  const style = windowOf(element).getComputedStyle(element)
  return style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

let measuringContext: CanvasRenderingContext2D | null | undefined

/** How wide `text` is in `font` (CSS px). */
export function textWidth(document: Document, font: string, text: string): number {
  if (measuringContext === undefined) measuringContext = document.createElement("canvas").getContext("2d")
  if (!measuringContext) return text.length * 8
  measuringContext.font = font
  return measuringContext.measureText(text).width
}

/**
 * Where the caret of a collapsed selection in an editable is (CSS px of the
 * viewport). `extra` is text that is not in the page yet but shows before the
 * caret (being composed with an IME).
 */
export function caretAtPoint(point: Point, extra = ""): { x: number; y: number; height: number } | null {
  const document = point.node.ownerDocument
  const container = elementOf(point.node)
  if (!document || !container) return null
  const style = windowOf(container).getComputedStyle(container)
  const fontSize = parseFloat(style.fontSize) || 16
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2
  let x: number
  let top: number
  let height: number
  if (point.node.nodeType === Node.TEXT_NODE) {
    const text = point.node as Text
    const range = document.createRange()
    // A collapsed range has no box in some browsers: measure the character after, or before.
    let rect: DOMRect | null = null
    let after = false
    if (point.offset < text.length) {
      range.setStart(text, point.offset)
      range.setEnd(text, point.offset + 1)
      rect = range.getClientRects()[0] ?? null
    }
    if (!rect && point.offset > 0) {
      range.setStart(text, point.offset - 1)
      range.setEnd(text, point.offset)
      const rects = range.getClientRects()
      rect = rects[rects.length - 1] ?? null
      after = true
    }
    if (!rect) return null
    x = after ? rect.right : rect.left
    top = rect.top
    height = rect.height
  } else {
    const child = point.node.childNodes[point.offset] ?? null
    const before = point.node.childNodes[point.offset - 1] ?? null
    if (child?.nodeType === Node.TEXT_NODE && (child as Text).length > 0) {
      return caretAtPoint({ node: child, offset: 0 }, extra)
    }
    if (before?.nodeType === Node.TEXT_NODE && (before as Text).length > 0) {
      return caretAtPoint({ node: before, offset: (before as Text).length }, extra)
    }
    if (child?.nodeType === Node.ELEMENT_NODE) {
      // A <br> (an empty line) or another element: the caret is at its start.
      const rect = (child as Element).getBoundingClientRect()
      x = rect.left
      top = rect.top
      height = rect.height
    } else {
      // An empty element: inside its padding.
      const rect = container.getBoundingClientRect()
      x = rect.left + container.clientLeft + (parseFloat(style.paddingLeft) || 0)
      top = rect.top + container.clientTop + (parseFloat(style.paddingTop) || 0)
      height = lineHeight
    }
  }
  if (!(height > 0) || height > lineHeight * 2) height = lineHeight
  if (extra) x += textWidth(document, fontOf(container), extra)
  return { x, y: top, height }
}
