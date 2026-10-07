// Turns the host's pointer, wheel and keyboard input into DOM events in the
// panel page.
//
// The panel iframe never receives real input (the host keeps it at
// pointer-events: none and does not let it hold focus), so everything here is
// synthesized. Synthesized events are not trusted, which means the browser
// skips some of its usual default actions. Those that matter for typical pages
// are reimplemented:
//
// - hover/enter/leave bookkeeping, and the :hover/:active state (via attributes)
// - pointer capture, which throws for a pointer the browser does not know
// - focus (see VirtualFocus), and placing the caret where a field was pressed
// - click and dblclick, only when the pointer did not move in between
// - wheel scrolling, and text editing in <input>/<textarea>
//
// Events are constructed from the page's own window, so that they belong to
// the page's realm like events the browser would dispatch there.

import { indexFromPoint, isTextField, type TextField } from "./caret"
import type { FrameWindow, PanelInput } from "../types"

const POINTER_ID = 1
/** Movement (CSS px) after which a press is a drag, not a click. */
const CLICK_SLOP = 6
const DOUBLE_CLICK_MS = 500

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
 * Focus inside the panel, kept by the host instead of the browser.
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

    // The page's scripts ran before this was installed and may have focused
    // something for real already: take it over.
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

interface Press {
  target: Element
  x: number
  y: number
  moved: boolean
  /** False when the page cancelled pointerdown, which suppresses the mouse events. */
  mouseEvents: boolean
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
        if (input.kind === "down") this.pointerDown(input.x, input.y)
        else if (input.kind === "move") this.pointerMove(input.x, input.y)
        else if (input.kind === "up") this.pointerUp(input.x, input.y)
        else this.updateHover(null, 0, 0)
        break
      case "wheel":
        this.wheel(input.x, input.y, input.deltaX, input.deltaY)
        break
      case "key":
        this.key(input)
        break
      case "text":
        this.text(input.text)
        break
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

  /** Focuses what a press landed on, the way mousedown does. */
  private focusAt(target: Element, x: number, y: number): void {
    // Pressing a <label> focuses its control.
    const focusable = target.closest(FOCUSABLE_SELECTOR) ?? target.closest("label")?.control ?? null
    if (focusable && this.focus.isFocusable(focusable)) {
      this.focus.set(focusable)
      // Untrusted mousedown does not move the caret; place it where the press was.
      if (isTextField(focusable)) this.placeCaret(focusable, x, y)
    } else {
      this.focus.set(null)
    }
  }

  private placeCaret(field: TextField, x: number, y: number): void {
    const index = this.options.measure(() => indexFromPoint(field, x, y))
    field.setSelectionRange(index, index)
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
      pointerType: "mouse",
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

  private pointerDown(x: number, y: number): void {
    const target = this.hitTest(x, y)
    this.updateHover(target, x, y)
    this.captureTarget = null
    this.active.clear()
    for (const element of ancestors(target)) this.active.add(element)

    const init = this.pointerInit(x, y, 1)
    const pointerOk = target.dispatchEvent(this.pointerEvent("pointerdown", init))
    this.press = { target, x, y, moved: false, mouseEvents: pointerOk }
    // Cancelling pointerdown suppresses the compatibility mouse events, and with
    // them the default action of mousedown (focusing).
    if (pointerOk && target.dispatchEvent(this.mouseEvent("mousedown", { ...init, detail: 1 }))) {
      this.focusAt(target, x, y)
    }
  }

  private pointerMove(x: number, y: number): void {
    const target = this.hitTest(x, y)
    this.updateHover(target, x, y)
    const press = this.press
    if (press && Math.hypot(x - press.x, y - press.y) > CLICK_SLOP) press.moved = true

    const destination = this.captureTarget?.isConnected ? this.captureTarget : target
    const init = this.pointerInit(x, y, press ? 1 : 0)
    destination.dispatchEvent(this.pointerEvent("pointermove", init))
    if (!press || press.mouseEvents) destination.dispatchEvent(this.mouseEvent("mousemove", init))
  }

  private pointerUp(x: number, y: number): void {
    const target = this.hitTest(x, y)
    const press = this.press
    const destination = this.captureTarget?.isConnected ? this.captureTarget : target
    const init = this.pointerInit(x, y, 0)
    destination.dispatchEvent(this.pointerEvent("pointerup", init))
    if (!press || press.mouseEvents) destination.dispatchEvent(this.mouseEvent("mouseup", init))
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
    if (!isTextField(target)) {
      // Activate buttons and links from the keyboard.
      if ((input.key === "Enter" || input.key === " ") && target.matches("button, a[href], [role=button]")) {
        target.dispatchEvent(this.mouseEvent("click", { bubbles: true, cancelable: true }))
      }
      return
    }

    const length = target.value.length
    const start = target.selectionStart ?? length
    const end = target.selectionEnd ?? length
    const collapse = (position: number) => target.setSelectionRange(position, position)
    const modifier = input.ctrlKey || input.metaKey

    switch (input.key) {
      case "Backspace":
        if (start !== end) this.editText(target, "", start, end, "deleteContentBackward")
        else if (start > 0) this.editText(target, "", start - 1, start, "deleteContentBackward")
        break
      case "Delete":
        if (start !== end) this.editText(target, "", start, end, "deleteContentForward")
        else if (end < length) this.editText(target, "", start, end + 1, "deleteContentForward")
        break
      case "ArrowLeft":
        collapse(start !== end ? start : Math.max(0, start - 1))
        break
      case "ArrowRight":
        collapse(start !== end ? end : Math.min(length, end + 1))
        break
      case "Home":
        collapse(0)
        break
      case "End":
        collapse(length)
        break
      case "Enter":
        if (target.tagName === "TEXTAREA") this.editText(target, "\n", start, end, "insertLineBreak")
        else target.form?.requestSubmit()
        break
      default:
        if (modifier && input.key.toLowerCase() === "a") target.select()
    }
  }

  private text(text: string): void {
    const target = this.focused
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
    if (data !== null && field.maxLength >= 0) {
      const room = field.maxLength - (field.value.length - (end - start))
      text = text.slice(0, Math.max(0, room))
    }
    field.setRangeText(text, start, end, "end")
    field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType, data }))
  }
}
