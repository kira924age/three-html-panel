// Turns the host's pointer, wheel and keyboard input, received by the agent,
// into DOM events in the panel page.
//
// The panel iframe never receives real input (the host keeps it at
// pointer-events: none and does not let it hold focus), so everything here is
// synthesized. Synthesized events are not trusted, which means the browser
// skips some of its usual default actions. Those that matter for typical pages
// are reimplemented:
//
// - hover/enter/leave bookkeeping, and the :hover/:active state (via attributes)
// - pointer capture, which throws for a pointer the browser does not know
// - focus (see VirtualFocus), and placing the caret where a field was pressed;
//   selecting text by dragging, double click (word) and triple click (line)
// - click and dblclick, only when the pointer did not move in between
// - wheel scrolling, and text editing in <input>/<textarea> (editing.ts)
// - scrolling by dragging a finger or a VR controller, as touch does (pan.ts)
// - scrollbars: dragging the thumb, paging by pressing (and holding) the
//   track (the scrollbars in the image are the agent's own, see scrollbars.ts)
//
// Events are constructed from the page's own window, so that they belong to
// the page's realm like events the browser would dispatch there.

import { caretAt, indexFromPoint, isTextField, revealIndex, verticalIndex, type Composition, type TextField } from "./caret"
import { editAction, lineEnd, lineStart, wordAt } from "./editing"
import { EditHistory, type FieldState } from "./history"
import { PAN_START_DISTANCE, panAxes, type PanAxes } from "./pan"
import { contains, hitBox, maxScroll, scrollbarAt, scrollbarsOf, thumbTravel, type Axis, type Scrollbar } from "./scrollbars"
import type { FrameWindow, PanelInput, PointerInput } from "../../types"

const POINTER_ID = 1
/** Movement (CSS px) after which a press is a drag, not a click. */
const CLICK_SLOP = 6
const DOUBLE_CLICK_MS = 500
/** Pressing a scrollbar's track scrolls by this share of the visible length, like browsers do. */
const PAGE_SCROLL_RATIO = 0.875
/** Holding a press on the track keeps paging: after this long, then at this interval. */
const PAGE_REPEAT_DELAY_MS = 400
const PAGE_REPEAT_INTERVAL_MS = 60

// macOS and iOS keep Emacs-style keys in text fields: Ctrl+A and Ctrl+E move to
// the start and end of the line. Select all is Cmd+A there.
const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i

const FOCUSABLE_SELECTOR =
  'input, textarea, select, button, a[href], [tabindex], [contenteditable=""], [contenteditable="true"]'

function ancestors(element: Element | null): Element[] {
  const chain: Element[] = []
  for (let node = element; node; node = node.parentElement) chain.push(node)
  return chain
}

function commonAncestor(a: Element, b: Element): Element | null {
  const chain = new Set(ancestors(a))
  for (let node: Element | null = b; node; node = node.parentElement) if (chain.has(node)) return node
  return null
}

/**
 * Focus inside the panel, kept by the agent instead of the browser.
 *
 * Real focus cannot work here. The host keeps keyboard focus for itself, and
 * when focus moves out of an iframe, browsers blur the element focused inside
 * it (Chrome does, at least): a text field would lose focus right after it got
 * it. A page that calls focus() would also pull the window's focus into the
 * iframe, away from the host.
 *
 * So focus(), blur() and document.activeElement are replaced in the page's
 * realm, and focus/blur events are dispatched by hand. Real focus events that
 * still happen (an `autofocus` attribute, the browser's own handling) are
 * swallowed and turned into virtual focus.
 */
export class VirtualFocus {
  private element: Element | null = null
  private readonly window: FrameWindow

  constructor(
    private readonly document: Document,
    private readonly onChange: () => void
  ) {
    this.window = document.defaultView as FrameWindow
    const self = this
    const proto = this.window.HTMLElement.prototype
    const realBlur = proto.blur
    proto.focus = function (this: HTMLElement) {
      if (self.isFocusable(this)) self.set(this)
    }
    proto.blur = function (this: HTMLElement) {
      if (self.element === this) self.set(null)
    }

    // The agent should run before the page's scripts. If it was loaded later,
    // something may have been focused for real already: take it over.
    const realActive = document.activeElement
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => this.current ?? document.body
    })
    if (realActive instanceof this.window.HTMLElement && realActive !== document.body) {
      this.element = realActive
      realBlur.call(realActive)
    }

    const swallowRealFocus = (event: Event) => {
      if (!event.isTrusted || !(event.target instanceof this.window.Element)) return
      event.stopImmediatePropagation()
      if (event.type === "focusin" && event.target instanceof this.window.HTMLElement) {
        const target = event.target
        queueMicrotask(() => {
          this.set(target)
          realBlur.call(target)
        })
      }
    }
    for (const type of ["focus", "blur", "focusin", "focusout"]) {
      this.window.addEventListener(type, swallowRealFocus, true)
    }
  }

  /** The focused element, or null. An element removed from the page loses focus. */
  get current(): Element | null {
    if (this.element && !this.element.isConnected) this.element = null
    return this.element
  }

  isFocusable(element: Element): boolean {
    if (element.matches(":disabled")) return false
    return (
      element.matches(FOCUSABLE_SELECTOR) || (element instanceof this.window.HTMLElement && element.isContentEditable)
    )
  }

  set(element: Element | null): void {
    const previous = this.current
    if (previous === element) return
    this.element = element
    const { FocusEvent } = this.window
    if (previous) {
      previous.dispatchEvent(new FocusEvent("blur", { relatedTarget: element }))
      previous.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: element }))
    }
    // A blur handler may have moved focus somewhere else already.
    if (element && this.element === element) {
      element.dispatchEvent(new FocusEvent("focus", { relatedTarget: previous }))
      element.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true, relatedTarget: previous }))
    }
    this.onChange()
  }
}

export interface InputSynthesizerOptions {
  /** Runs a measurement that temporarily adds elements to the page (see caret.ts). */
  measure: <T>(run: () => T) => T
  /** Called after anything that may have changed what the page looks like. */
  onChange: () => void
}

/** A finger or controller drag that may scroll, from where it was pressed. */
interface Pan {
  target: Element
  scroller: Element
  axes: PanAxes
  start: { x: number; y: number }
  last: { x: number; y: number }
  /** It has started scrolling (and the page got pointercancel). */
  active: boolean
}

interface Press {
  target: Element
  x: number
  y: number
  moved: boolean
  /** False when the page cancelled pointerdown, which suppresses the mouse events. */
  mouseEvents: boolean
  /**
   * The mousedown held back while a finger or controller drag may still scroll:
   * like a touch in browsers, the mouse events (and focusing) come only if the
   * press ends without moving.
   */
  deferred: { detail: number; shiftKey: boolean } | null
}

/**
 * Whether a press moved too far to be a click. A held-back finger or controller
 * press is a tap for as long as it does not scroll: until it moves
 * PAN_START_DISTANCE along an axis.
 */
function movedOff(press: Press, x: number, y: number): boolean {
  const dx = Math.abs(x - press.x)
  const dy = Math.abs(y - press.y)
  return press.deferred ? Math.max(dx, dy) >= PAN_START_DISTANCE : Math.hypot(dx, dy) > CLICK_SLOP
}

export class InputSynthesizer {
  readonly hovered = new Set<Element>()
  readonly active = new Set<Element>()
  private readonly window: FrameWindow
  private readonly focus: VirtualFocus
  private hoverTarget: Element | null = null
  private captureTarget: Element | null = null
  private press: Press | null = null
  private lastClick: { time: number; x: number; y: number } | null = null
  /** The last press, to count double and triple presses. */
  private lastDown: { time: number; x: number; y: number; count: number } | null = null
  /** Where the pointer is over the page, if it is. */
  private pointer: { x: number; y: number } | null = null
  /** Text being selected by dragging: the field, and the range the press selected (a word on a double press). */
  private textDrag: { field: TextField; unit: "char" | "word" | "line"; start: number; end: number } | null = null
  /** Text being composed with the host's IME in the focused field (not in its value yet). */
  private composing: { field: TextField; composition: Composition } | null = null
  private readonly history = new EditHistory()
  /** The horizontal position Up/Down keep to, while they keep moving the caret. */
  private goal: { field: TextField; index: number; x: number } | null = null
  /**
   * A press on a scrollbar, until it is released. On the thumb, it drags: where
   * the press was and the scroll offset then. On the track, it pages toward the
   * pointer while held.
   */
  private scrollbarPress: {
    bar: Scrollbar
    drag: { from: number; scroll: number } | null
    position: number
  } | null = null
  private pageTimer = 0
  /** What drives the pointer now, and the drag it may be scrolling. */
  private pointerInput: PointerInput = "mouse"
  private pan: Pan | null = null
  /** The scrollbar the pointer hovers (it is not part of the page). */
  private hoveredScrollbar: Scrollbar | null = null

  constructor(
    private readonly document: Document,
    private readonly options: InputSynthesizerOptions
  ) {
    this.window = document.defaultView as FrameWindow
    this.patchPointerCapture()
    this.focus = new VirtualFocus(document, options.onChange)
  }

  handle(input: PanelInput): void {
    switch (input.type) {
      case "pointer":
        if (input.kind === "down") this.pointerDown(input.x, input.y, input.shiftKey === true, input.input ?? "mouse")
        else if (input.kind === "move") this.pointerMove(input.x, input.y)
        else if (input.kind === "up") this.pointerUp(input.x, input.y)
        else {
          this.pointer = null
          this.hoveredScrollbar = null
          this.updateHover(null, 0, 0)
        }
        break
      case "wheel":
        this.wheel(input.x, input.y, input.deltaX, input.deltaY)
        break
      case "key":
        this.key(input)
        break
      case "text":
        this.composing = null
        this.text(input.text)
        break
      case "cut":
        this.cut()
        break
      case "composition": {
        const field = this.focused
        this.composing =
          input.text !== "" && isTextField(field) ? { field, composition: { text: input.text, cursor: input.cursor } } : null
        break
      }
      case "blur":
        this.focus.set(null)
        break
    }
    this.options.onChange()
  }

  /** The focused element, if any. */
  get focused(): Element | null {
    return this.focus.current
  }

  /**
   * The text selected in the focused field, for the host to copy (it takes the
   * keys, so the browser's copy acts on the host's field). None from a password.
   */
  get selectedText(): string {
    const field = this.focused
    if (!isTextField(field) || (field.tagName === "INPUT" && (field as HTMLInputElement).type === "password")) return ""
    const { selectionStart, selectionEnd } = field
    return selectionStart === null || selectionEnd === null ? "" : field.value.slice(selectionStart, selectionEnd)
  }

  /** What is being composed in the focused field, if anything. Ends when focus moves on. */
  get composition(): Composition | null {
    const composing = this.composing
    if (!composing || composing.field !== this.focused) return null
    return composing.composition
  }

  /**
   * The mouse cursor the page asks for where the pointer is, as a CSS keyword,
   * or "" while the pointer is not over the page.
   */
  get cursor(): string {
    if (this.scrollbarPress || this.hoveredScrollbar) return "default"
    // While selecting text, the text cursor stays wherever the pointer goes.
    if (this.textDrag) return "text"
    const target = this.captureTarget?.isConnected ? this.captureTarget : this.hoverTarget
    if (!target?.isConnected) return ""
    // The computed value lists url() images before a keyword to fall back on; only the keyword is used.
    const keyword = this.window.getComputedStyle(target).cursor.split(",").pop()!.trim()
    if (keyword !== "auto" && /^[a-z-]+$/.test(keyword)) return keyword
    // "auto" is the text cursor over editable text, and over text itself.
    const editable = target instanceof this.window.HTMLElement && target.isContentEditable
    if (isTextField(target) || editable) return "text"
    return this.pointer && this.isOverText(this.pointer.x, this.pointer.y) ? "text" : "default"
  }

  /** The scrollbar being pressed or hovered, to be drawn that way. */
  get scrollbarState(): { element: Element; axis: Axis; state: "active" | "hover" } | null {
    const bar = this.scrollbarPress?.bar ?? this.hoveredScrollbar
    if (!bar) return null
    return { element: bar.element, axis: bar.axis, state: this.scrollbarPress ? "active" : "hover" }
  }

  dispose(): void {
    window.clearTimeout(this.pageTimer)
  }

  /** Whether a point is on a character of the page's text (not only inside an element with text). */
  private isOverText(x: number, y: number): boolean {
    const document = this.document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    let node: Node | null = null
    let offset = 0
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y)
      node = position?.offsetNode ?? null
      offset = position?.offset ?? 0
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y)
      node = range?.startContainer ?? null
      offset = range?.startOffset ?? 0
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return false
    const length = (node as Text).length
    const range = document.createRange()
    // The caret position is between two characters; the point is on one of them.
    for (const [from, to] of [[offset - 1, offset], [offset, offset + 1]] as const) {
      if (from < 0 || to > length) continue
      range.setStart(node, from)
      range.setEnd(node, to)
      for (const rect of Array.from(range.getClientRects())) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true
      }
    }
    return false
  }

  /**
   * setPointerCapture() throws for pointers the browser did not create. Emulate
   * capture for the synthetic pointer, so that drag handlers written the usual
   * way keep receiving moves after the pointer leaves the element.
   */
  private patchPointerCapture(): void {
    const self = this
    const proto = this.window.Element.prototype
    const { setPointerCapture, releasePointerCapture, hasPointerCapture } = proto
    proto.setPointerCapture = function (pointerId: number) {
      if (pointerId !== POINTER_ID) return setPointerCapture.call(this, pointerId)
      self.captureTarget = this
    }
    proto.releasePointerCapture = function (pointerId: number) {
      if (pointerId !== POINTER_ID) return releasePointerCapture.call(this, pointerId)
      if (self.captureTarget === this) self.captureTarget = null
    }
    proto.hasPointerCapture = function (pointerId: number) {
      if (pointerId !== POINTER_ID) return hasPointerCapture.call(this, pointerId)
      return self.captureTarget === this
    }
  }

  // --- Focus -----------------------------------------------------------------

  /** Focuses what a press landed on, the way mousedown does. `count` is 2 for a double press, and so on. */
  private focusAt(target: Element, x: number, y: number, count: number, shiftKey: boolean): void {
    // Pressing a <label> focuses its control.
    const focusable = target.closest(FOCUSABLE_SELECTOR) ?? target.closest("label")?.control ?? null
    if (focusable && this.focus.isFocusable(focusable)) {
      const wasFocused = this.focus.current === focusable
      this.focus.set(focusable)
      // Untrusted mousedown does not move the caret; place it where the press was
      // (unless the press was on a label, which only focuses the field).
      if (isTextField(focusable) && focusable.contains(target)) {
        this.pressText(focusable, x, y, count, shiftKey && wasFocused)
      }
    } else {
      this.focus.set(null)
    }
  }

  /**
   * A press in a text field: places the caret, or selects a word (double) or a
   * line (triple), or extends the selection (Shift). Dragging then extends it.
   */
  private pressText(field: TextField, x: number, y: number, count: number, extend: boolean): void {
    const index = this.options.measure(() => indexFromPoint(field, x, y))
    const value = field.value
    const multiline = field.tagName === "TEXTAREA"
    let start = index
    let end = index
    let unit: "char" | "word" | "line" = "char"
    if (extend) {
      const anchor = field.selectionDirection === "backward" ? (field.selectionEnd ?? index) : (field.selectionStart ?? index)
      start = end = anchor
    } else if (count === 2) {
      ;[start, end] = wordAt(value, index)
      unit = "word"
    } else if (count >= 3) {
      start = multiline ? lineStart(value, index) : 0
      end = multiline ? lineEnd(value, index) : value.length
      unit = "line"
    }
    this.textDrag = { field, unit, start, end }
    if (extend) this.dragText(x, y)
    else this.select(field, start, end)
  }

  /** Extends the selection being dragged to the point, by the unit the press chose. */
  private dragText(x: number, y: number): void {
    const { field, unit, start, end } = this.textDrag!
    const index = this.options.measure(() => indexFromPoint(field, x, y))
    const value = field.value
    if (unit === "char") {
      this.select(field, start, index)
      return
    }
    const [from, to] =
      unit === "word"
        ? wordAt(value, index)
        : field.tagName === "TEXTAREA"
          ? [lineStart(value, index), lineEnd(value, index)]
          : [0, value.length]
    if (index < start) this.select(field, end, from)
    else this.select(field, start, Math.max(to, end))
  }

  /** Selects from `anchor` to `focus` (the end that moves), and scrolls the field to show `focus`. */
  private select(field: TextField, anchor: number, focus: number): void {
    this.history.breakTyping(field)
    field.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), focus < anchor ? "backward" : "forward")
    this.options.measure(() => revealIndex(field, focus))
  }

  // --- Pointer ---------------------------------------------------------------

  private hitTest(x: number, y: number): Element {
    return this.document.elementFromPoint(x, y) ?? this.document.documentElement
  }

  private pointerInit(x: number, y: number, buttons: number, relatedTarget: Element | null = null): PointerEventInit {
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: this.window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons,
      relatedTarget,
      pointerId: POINTER_ID,
      // A VR controller acts as a mouse to the page (it hovers, and has no touch events).
      pointerType: this.pointerInput === "touch" ? "touch" : "mouse",
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: buttons ? 0.5 : 0
    }
  }

  private pointerEvent(type: string, init: PointerEventInit): Event {
    // jsdom (tests) has no PointerEvent.
    const PointerEvent = this.window.PointerEvent ?? this.window.MouseEvent
    return new PointerEvent(type, init)
  }

  private mouseEvent(type: string, init: MouseEventInit): Event {
    return new this.window.MouseEvent(type, init)
  }

  /** Dispatches a pointer event and its compatibility mouse event. */
  private dispatchPair(target: Element, pointerType: string, mouseType: string, init: PointerEventInit, bubbles = true) {
    target.dispatchEvent(this.pointerEvent(pointerType, { ...init, bubbles }))
    target.dispatchEvent(this.mouseEvent(mouseType, { ...init, bubbles }))
  }

  private updateHover(target: Element | null, x: number, y: number): void {
    const previous = this.hoverTarget
    if (previous === target) return
    const chain = ancestors(target)
    const chainSet = new Set(chain)
    const init = (related: Element | null) => this.pointerInit(x, y, this.press ? 1 : 0, related)

    if (previous?.isConnected) this.dispatchPair(previous, "pointerout", "mouseout", init(target))
    for (const element of Array.from(this.hovered)) {
      if (!chainSet.has(element) && element.isConnected) {
        this.dispatchPair(element, "pointerleave", "mouseleave", init(target), false)
      }
    }
    if (target) this.dispatchPair(target, "pointerover", "mouseover", init(previous))
    for (const element of chain.slice().reverse()) {
      if (!this.hovered.has(element)) this.dispatchPair(element, "pointerenter", "mouseenter", init(previous), false)
    }

    this.hovered.clear()
    for (const element of chain) this.hovered.add(element)
    this.hoverTarget = target
  }

  private pointerDown(x: number, y: number, shiftKey: boolean, input: PointerInput = "mouse"): void {
    this.pointer = { x, y }
    this.pointerInput = input
    this.pan = null
    // Like a real scrollbar, pressing one is not a press on the page.
    const bar = scrollbarAt(this.document, x, y)
    if (bar) {
      this.pressScrollbar(bar, x, y)
      return
    }
    const now = performance.now()
    const last = this.lastDown
    const count =
      last && now - last.time < DOUBLE_CLICK_MS && Math.hypot(x - last.x, y - last.y) <= CLICK_SLOP ? last.count + 1 : 1
    this.lastDown = { time: now, x, y, count }
    const target = this.hitTest(x, y)
    this.updateHover(target, x, y)
    this.captureTarget = null
    this.active.clear()
    for (const element of ancestors(target)) this.active.add(element)

    const init = this.pointerInit(x, y, 1)
    const pointerOk = target.dispatchEvent(this.pointerEvent("pointerdown", init))
    this.press = { target, x, y, moved: false, mouseEvents: pointerOk, deferred: null }
    // A finger or controller drag scrolls, unless the page took the press (cancelled it).
    if (input !== "mouse" && pointerOk) this.pan = this.startPan(target, x, y)
    if (this.pan) {
      this.press.deferred = { detail: count, shiftKey }
      return
    }
    // Cancelling pointerdown suppresses the compatibility mouse events, and with
    // them the default action of mousedown (focusing).
    if (pointerOk) this.mouseDown(target, x, y, count, shiftKey)
  }

  private mouseDown(target: Element, x: number, y: number, detail: number, shiftKey: boolean): void {
    if (target.dispatchEvent(this.mouseEvent("mousedown", { ...this.pointerInit(x, y, 1), detail, shiftKey }))) {
      this.focusAt(target, x, y, detail, shiftKey)
    }
  }

  private pointerMove(x: number, y: number): void {
    this.pointer = { x, y }
    if (this.scrollbarPress) {
      this.dragScrollbar(x, y)
      return
    }
    // Once the page captures the pointer, the drag is the page's.
    if (this.captureTarget) this.pan = null
    if (this.pan && this.updatePan(this.pan, x, y)) return
    this.hoveredScrollbar = this.press ? null : scrollbarAt(this.document, x, y)
    const target = this.hitTest(x, y)
    this.updateHover(target, x, y)
    const press = this.press
    if (press && movedOff(press, x, y)) press.moved = true

    const destination = this.captureTarget?.isConnected ? this.captureTarget : target
    const init = this.pointerInit(x, y, press ? 1 : 0)
    destination.dispatchEvent(this.pointerEvent("pointermove", init))
    if (!press || (press.mouseEvents && !press.deferred)) destination.dispatchEvent(this.mouseEvent("mousemove", init))
    if (press && this.textDrag?.field.isConnected) this.dragText(x, y)
  }

  private pointerUp(x: number, y: number): void {
    if (this.scrollbarPress) {
      this.scrollbarPress = null
      window.clearTimeout(this.pageTimer)
      return
    }
    this.textDrag = null
    const pan = this.pan
    this.pan = null
    // A drag that scrolled already ended for the page (pointercancel): no pointerup, no click.
    if (pan?.active) {
      this.press = null
      this.active.clear()
      this.updateHover(this.hitTest(x, y), x, y)
      return
    }
    const target = this.hitTest(x, y)
    const press = this.press
    const destination = this.captureTarget?.isConnected ? this.captureTarget : target
    const init = this.pointerInit(x, y, 0)
    destination.dispatchEvent(this.pointerEvent("pointerup", init))
    // A held-back press: a tap gets its mouse events now, a drag none.
    const deferred = press?.deferred
    let mouseEvents = !press || press.mouseEvents
    if (press && deferred) {
      mouseEvents = !press.moved
      if (mouseEvents) this.mouseDown(press.target, press.x, press.y, deferred.detail, deferred.shiftKey)
      this.textDrag = null
    }
    if (mouseEvents) destination.dispatchEvent(this.mouseEvent("mouseup", init))
    if (this.captureTarget) {
      this.captureTarget.dispatchEvent(this.pointerEvent("lostpointercapture", init))
      this.captureTarget = null
    }
    this.press = null
    this.active.clear()
    this.updateHover(target, x, y)

    if (!press || press.moved) return
    const clickTarget = commonAncestor(press.target, target)
    if (!clickTarget) return
    const now = performance.now()
    const last = this.lastClick
    const isDouble =
      last !== null && now - last.time < DOUBLE_CLICK_MS && Math.hypot(x - last.x, y - last.y) <= CLICK_SLOP
    clickTarget.dispatchEvent(this.pointerEvent("click", { ...init, detail: isDouble ? 2 : 1 }))
    if (isDouble) {
      clickTarget.dispatchEvent(this.mouseEvent("dblclick", { ...init, detail: 2 }))
      this.lastClick = null
    } else {
      this.lastClick = { time: now, x, y }
    }
  }

  // --- Drag scrolling ---------------------------------------------------------

  /** What a drag from `target` would scroll, and in which directions; null if nothing. */
  private startPan(target: Element, x: number, y: number): Pan | null {
    const touchActions = ancestors(target).map(element => this.window.getComputedStyle(element).touchAction ?? "")
    const axes = panAxes(touchActions)
    if (!axes.x && !axes.y) return null
    const scroller = this.panScroller(target, axes)
    if (!scroller) return null
    return { target, scroller, axes, start: { x, y }, last: { x, y }, active: false }
  }

  /** The nearest element that can scroll in an allowed direction, or the document's scroller. */
  private panScroller(target: Element, axes: PanAxes): Element | null {
    for (const element of ancestors(target)) {
      const style = this.window.getComputedStyle(element)
      const y = axes.y && /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1
      const x = axes.x && /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1
      if (x || y) return element
    }
    const root = this.document.scrollingElement
    if (!root) return null
    return root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1 ? root : null
  }

  /** Follows the drag: true once it scrolls (and the page gets no more pointer events for it). */
  private updatePan(pan: Pan, x: number, y: number): boolean {
    if (!pan.active) {
      const dx = pan.axes.x ? Math.abs(x - pan.start.x) : 0
      const dy = pan.axes.y ? Math.abs(y - pan.start.y) : 0
      if (Math.max(dx, dy) < PAN_START_DISTANCE) return false
      // Browsers send pointercancel when a touch turns into a scroll.
      pan.active = true
      this.textDrag = null
      pan.target.dispatchEvent(this.pointerEvent("pointercancel", this.pointerInit(x, y, 0)))
    }
    pan.scroller.scrollBy(pan.axes.x ? pan.last.x - x : 0, pan.axes.y ? pan.last.y - y : 0)
    pan.last = { x, y }
    return true
  }

  // --- Scrollbars ------------------------------------------------------------

  private pressScrollbar(bar: Scrollbar, x: number, y: number): void {
    const position = bar.axis === "y" ? y : x
    if (contains(hitBox(bar, bar.thumb), x, y)) {
      const scroll = bar.axis === "y" ? bar.element.scrollTop : bar.element.scrollLeft
      this.scrollbarPress = { bar, drag: { from: position, scroll }, position }
      return
    }
    // A press on the track pages toward the press, and keeps paging while held
    // until the thumb reaches the pointer.
    this.scrollbarPress = { bar, drag: null, position }
    this.pageToward(bar, position)
    const repeat = () => {
      const press = this.scrollbarPress
      if (!press || press.drag) return
      const current = scrollbarsOf(press.bar.element).find(other => other.axis === press.bar.axis)
      if (!current || !this.pageToward(current, press.position)) return
      this.options.onChange()
      this.pageTimer = window.setTimeout(repeat, PAGE_REPEAT_INTERVAL_MS)
    }
    this.pageTimer = window.setTimeout(repeat, PAGE_REPEAT_DELAY_MS)
  }

  /** Scrolls a page toward `position` on the track. False once the thumb is there. */
  private pageToward(bar: Scrollbar, position: number): boolean {
    const [thumbStart, thumbEnd] =
      bar.axis === "y" ? [bar.thumb.top, bar.thumb.top + bar.thumb.height] : [bar.thumb.left, bar.thumb.left + bar.thumb.width]
    if (position >= thumbStart && position < thumbEnd) return false
    const direction = position < thumbStart ? -1 : 1
    const page = (bar.axis === "y" ? bar.element.clientHeight : bar.element.clientWidth) * PAGE_SCROLL_RATIO
    if (bar.axis === "y") bar.element.scrollBy(0, direction * page)
    else bar.element.scrollBy(direction * page, 0)
    return true
  }

  /** Moves the thumb with the pointer: the thumb's travel maps onto the scroll range. */
  private dragScrollbar(x: number, y: number): void {
    const press = this.scrollbarPress!
    const { bar, drag } = press
    press.position = bar.axis === "y" ? y : x
    if (!drag) return
    const { from, scroll } = drag
    const travel = thumbTravel(bar)
    if (travel <= 0) return
    const moved = (bar.axis === "y" ? y : x) - from
    const offset = scroll + (moved * maxScroll(bar)) / travel
    if (bar.axis === "y") bar.element.scrollTop = offset
    else bar.element.scrollLeft = offset
  }

  private canScroll(element: Element, deltaX: number, deltaY: number): boolean {
    const style = this.window.getComputedStyle(element)
    const scrollableY = /(auto|scroll|overlay)/.test(style.overflowY)
    const scrollableX = /(auto|scroll|overlay)/.test(style.overflowX)
    if (scrollableY && deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true
    if (scrollableY && deltaY < 0 && element.scrollTop > 0) return true
    if (scrollableX && deltaX > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1) return true
    if (scrollableX && deltaX < 0 && element.scrollLeft > 0) return true
    return false
  }

  private wheel(x: number, y: number, deltaX: number, deltaY: number): void {
    const target = this.hitTest(x, y)
    const event = new this.window.WheelEvent("wheel", { ...this.pointerInit(x, y, 0), deltaX, deltaY, deltaMode: 0 })
    if (!target.dispatchEvent(event)) return
    for (const element of ancestors(target)) {
      if (this.canScroll(element, deltaX, deltaY)) {
        element.scrollBy(deltaX, deltaY)
        return
      }
    }
    this.document.scrollingElement?.scrollBy(deltaX, deltaY)
  }

  // --- Keyboard --------------------------------------------------------------

  private key(input: Extract<PanelInput, { type: "key" }>): void {
    const target = this.focused ?? this.document.body
    const init: KeyboardEventInit = {
      key: input.key,
      shiftKey: input.shiftKey,
      ctrlKey: input.ctrlKey,
      altKey: input.altKey,
      metaKey: input.metaKey,
      bubbles: true,
      cancelable: true,
      composed: true
    }
    const { KeyboardEvent } = this.window
    if (target.dispatchEvent(new KeyboardEvent("keydown", init))) this.keyDefaultAction(target, input)
    target.dispatchEvent(new KeyboardEvent("keyup", init))
  }

  private keyDefaultAction(target: Element, input: Extract<PanelInput, { type: "key" }>): void {
    if (input.key === "Escape") {
      this.focus.set(null)
      return
    }
    const plain = !input.ctrlKey && !input.metaKey && !input.altKey
    if (input.key === "Tab" && plain) {
      this.moveFocus(input.shiftKey ? -1 : 1)
      return
    }
    if (!isTextField(target)) {
      if (plain) this.activate(target, input.key)
      return
    }

    const field = target
    const length = field.value.length
    const action = editAction(
      {
        value: field.value,
        start: field.selectionStart ?? length,
        end: field.selectionEnd ?? length,
        direction: field.selectionDirection ?? "none",
        multiline: field.tagName === "TEXTAREA"
      },
      input,
      { apple: this.isApple(), verticalTarget: (index, direction, page) => this.verticalTarget(field, index, direction, page) }
    )
    if (!action) return
    if (action.type === "select") this.select(field, action.anchor, action.focus)
    else if (action.type === "edit") this.editText(field, action.text, action.start, action.end, action.inputType)
    else if (action.type === "undo" || action.type === "redo") this.undo(field, action.type)
    else field.form?.requestSubmit()
  }

  /** The default actions of keys on buttons, links, checkboxes and radio buttons. */
  private activate(target: Element, key: string): void {
    const { HTMLInputElement, HTMLElement } = this.window
    const kind = target instanceof HTMLInputElement ? target.type : ""
    if (kind === "checkbox" || kind === "radio") {
      if (key === " ") (target as HTMLInputElement).click()
      else if (kind === "radio" && /^Arrow(Up|Down|Left|Right)$/.test(key)) {
        this.stepRadio(target as HTMLInputElement, key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1)
      }
      return
    }
    if ((key === "Enter" || key === " ") && target.matches("button, a[href], [role=button]")) {
      if (target instanceof HTMLElement) target.click()
    }
  }

  /** Arrows in a radio group check the next (or previous) radio, as browsers do. */
  private stepRadio(radio: HTMLInputElement, direction: -1 | 1): void {
    const group = this.radioGroup(radio).filter(other => !other.disabled)
    const index = group.indexOf(radio)
    const next = group[(index + direction + group.length) % group.length]
    if (!next || next === radio) return
    this.focus.set(next)
    next.click()
  }

  private radioGroup(radio: HTMLInputElement): HTMLInputElement[] {
    if (!radio.name) return [radio]
    const scope = radio.form ?? radio.ownerDocument
    return Array.from(scope.querySelectorAll<HTMLInputElement>("input[type=radio]")).filter(
      other => other.name === radio.name && other.form === radio.form
    )
  }

  /**
   * Tab: focus moves to the next element in tab order (a positive tabindex
   * first, by its value, then document order), Shift+Tab to the previous one,
   * wrapping around. A radio group is one stop, at its checked radio. A text
   * field focused this way has its text selected, as in browsers.
   */
  private moveFocus(direction: -1 | 1): void {
    const order = this.tabOrder()
    if (order.length === 0) return
    const current = this.focused
    const index = current ? order.indexOf(current) : -1
    const next =
      index === -1 ? order[direction > 0 ? 0 : order.length - 1]! : order[(index + direction + order.length) % order.length]!
    this.focus.set(next)
    if (isTextField(next)) next.setSelectionRange(0, next.value.length)
    next.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }

  private tabOrder(): Element[] {
    const { HTMLElement, HTMLInputElement } = this.window
    const candidates = Array.from(this.document.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => {
      if (!(element instanceof HTMLElement) || element.tabIndex < 0 || !this.focus.isFocusable(element)) return false
      if (element.closest("[inert]")) return false
      // jsdom has no checkVisibility; there, everything counts as shown.
      if (typeof element.checkVisibility === "function" && !element.checkVisibility({ visibilityProperty: true })) {
        return false
      }
      if (element instanceof HTMLInputElement && element.type === "radio") {
        // One stop per group: the checked radio, or else the first one.
        const group = this.radioGroup(element)
        return element === (group.find(radio => radio.checked) ?? group[0])
      }
      return true
    }) as HTMLElement[]
    const positive = candidates.filter(element => element.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex)
    return [...positive, ...candidates.filter(element => element.tabIndex === 0)]
  }

  private stateOf(field: TextField): FieldState {
    const length = field.value.length
    return { value: field.value, start: field.selectionStart ?? length, end: field.selectionEnd ?? length }
  }

  /** Puts a field back to a state from its history, the way the browser's undo would. */
  private undo(field: TextField, which: "undo" | "redo"): void {
    const now = this.stateOf(field)
    const state = which === "undo" ? this.history.undo(field, now) : this.history.redo(field, now)
    if (!state) return
    const inputType = which === "undo" ? "historyUndo" : "historyRedo"
    const { InputEvent } = this.window
    const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType, data: null })
    if (!field.dispatchEvent(before)) return
    field.setRangeText(state.value, 0, field.value.length)
    field.setSelectionRange(state.start, state.end)
    this.history.edited(field, field.value)
    this.options.measure(() => revealIndex(field, state.end))
    field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType, data: null }))
  }

  /** The host's field cut the selected text to the clipboard: take it out of the page's field too. */
  private cut(): void {
    const field = this.focused
    if (!isTextField(field)) return
    const { start, end } = this.stateOf(field)
    if (start !== end) this.editText(field, "", start, end, "deleteByCut")
  }

  /** Up/Down keep to the horizontal position they started from, like browsers do. */
  private verticalTarget(field: TextField, index: number, direction: -1 | 1, page: boolean): number | null {
    const goal = this.goal
    const x =
      goal && goal.field === field && goal.index === index ? goal.x : this.options.measure(() => caretAt(field, index).x)
    const target = this.options.measure(() => verticalIndex(field, index, direction, page, x))
    this.goal = { field, index: target ?? (direction < 0 ? 0 : field.value.length), x }
    return target
  }

  private isApple(): boolean {
    const navigator = this.window.navigator as Navigator & { userAgentData?: { platform?: string } }
    return APPLE_PLATFORM.test(navigator.userAgentData?.platform || navigator.platform || "")
  }

  private text(text: string): void {
    const target = this.focused
    // A space is typed, not a key, as far as the host can tell. On a checkbox or a
    // button it is the key that toggles or presses it.
    if (text === " " && target && !isTextField(target)) {
      this.key({ type: "key", key: " ", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false })
      return
    }
    if (!isTextField(target) || text === "") return
    const length = target.value.length
    this.editText(target, text, target.selectionStart ?? length, target.selectionEnd ?? length, "insertText")
  }

  /**
   * Replaces a range of a text field the way typing would, with beforeinput and
   * input events. setRangeText does not go through the `value` setter, so
   * frameworks that track the value (React) still see the change on `input`.
   */
  private editText(field: TextField, text: string, start: number, end: number, inputType: string): void {
    const data = text === "" ? null : text
    const { InputEvent } = this.window
    const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType, data })
    if (!field.dispatchEvent(before)) return
    this.history.record(field, { value: field.value, start, end: field.selectionEnd ?? end }, inputType)
    if (data !== null && field.maxLength >= 0) {
      const room = field.maxLength - (field.value.length - (end - start))
      text = text.slice(0, Math.max(0, room))
    }
    field.setRangeText(text, start, end, "end")
    this.history.edited(field, field.value)
    this.options.measure(() => revealIndex(field, field.selectionEnd ?? field.value.length))
    field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType, data }))
  }
}
