// Watches the panel page and turns it into SVG frames whenever it changes.
// Also routes input into the page and reports whether a text field has focus,
// and where its caret is.
//
// This runs inside the page, as part of the agent, and lives as long as the
// document. It installs the page's virtual focus and pointer capture as soon
// as it is created, but only takes snapshots once the agent is connected to
// the host (start()).

import { composedValue, isTextField, measureCaret, measureComposition, measureSelection } from "../input/caret"
import { InputSynthesizer } from "../input/input"
import type { Box, Caret, Frame, FrameWindow, PanelInput } from "../../types"
import { DocumentCss } from "./css"
import { ImageInliner } from "./images"
import { MAX_EDITABLES, MAX_TEXT_LENGTH } from "../../protocol"
import { RenderPacer } from "./pacer"
import { buildFrameSvg, isSampledLive, snapshotDocument } from "./snapshot"

/** Events after which the page may look different. */
const INVALIDATING_EVENTS = [
  "input",
  "change",
  "scroll",
  "load",
  "error",
  "focusin",
  "focusout",
  "transitionrun",
  "transitionend",
  "animationstart",
  "animationend",
  "animationiteration",
  "resize"
]

export interface PageCaptureOptions {
  onFrame: (frame: Frame) => void
  /**
   * Whether an element has focus (keys should come to the page), a text field's
   * caret, its selected text (for the host to copy), and how many pointer inputs
   * have been handled. Also sent after every release, changed or not.
   */
  onEditing: (editing: boolean, caret: Caret | null, selectedText: string, pointers: number) => void
  /** Where the text fields are now (CSS px, in view), when that changed. */
  onEditables: (boxes: Box[]) => void
  /** The mouse cursor changed (a CSS keyword, or "" when the pointer is not over the page). */
  onCursor: (cursor: string) => void
}

export class PageCapture {
  private readonly window: FrameWindow
  private readonly css: DocumentCss
  private readonly images: ImageInliner
  private readonly input: InputSynthesizer
  private readonly mutations: MutationObserver
  private readonly pacer = new RenderPacer()
  private dirty = true
  private timer = 0
  private notBefore = 0
  private lastEditing = ""
  private lastCursor = ""
  private lastEditables = ""
  /** Pointer inputs handled for this document (see onEditing). */
  private pointers = 0
  private started = false
  private disposed = false

  constructor(
    private readonly document: Document,
    private readonly options: PageCaptureOptions
  ) {
    this.window = document.defaultView as FrameWindow
    this.images = new ImageInliner(() => {
      this.css.invalidate()
      this.invalidate()
    })
    this.css = new DocumentCss(document, url => this.images.get(url), () => this.invalidate())
    this.mutations = new this.window.MutationObserver(() => this.invalidate())
    this.input = new InputSynthesizer(document, { measure: this.measure, onChange: () => this.invalidate() })

    this.mutations.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
    for (const type of INVALIDATING_EVENTS) this.window.addEventListener(type, this.invalidate, true)
    void document.fonts?.ready.then(() => {
      this.css.invalidate()
      this.invalidate()
    })
  }

  /**
   * Starts sending frames, or sends everything again: a frame and the editing
   * state, as if seen for the first time (after a new connection).
   */
  start(): void {
    this.started = true
    this.lastEditing = ""
    this.lastCursor = ""
    this.lastEditables = ""
    this.css.invalidate()
    this.invalidate()
  }

  handle(input: PanelInput): void {
    if (this.disposed) return
    this.input.handle(input)
    if (input.type !== "pointer") return
    this.pointers++
    // The host waits for the page's answer to a tap (did it focus a text field?).
    if (input.kind === "up") this.lastEditing = ""
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.input.dispose()
    this.mutations.disconnect()
    for (const type of INVALIDATING_EVENTS) this.window.removeEventListener(type, this.invalidate, true)
  }

  /** Runs a measurement that adds elements to the page, without it counting as a change. */
  private readonly measure = <T>(run: () => T): T => {
    try {
      return run()
    } finally {
      this.mutations.takeRecords()
    }
  }

  private readonly invalidate = () => {
    this.dirty = true
    this.schedule()
  }

  // A plain timer, not requestAnimationFrame: browsers may hold back rAF in an
  // iframe they consider not on screen (this one is transparent and behind the
  // host's canvas). Taking the snapshot forces style and layout anyway.
  private schedule(): void {
    if (!this.started || this.disposed || this.timer) return
    const wait = Math.max(0, this.notBefore - performance.now())
    this.timer = window.setTimeout(() => {
      this.timer = 0
      this.render()
    }, wait)
  }

  /** Animations copied as they are now (see collectAnimatedValues in snapshot.ts); the others end on a fixed value. */
  private hasLiveAnimations(): boolean {
    const { document } = this
    return (
      typeof document.getAnimations === "function" &&
      document.getAnimations().some(animation => animation.playState === "running" && isSampledLive(animation))
    )
  }

  private render(): void {
    if (this.disposed || !this.dirty) return
    this.dirty = false
    const started = performance.now()
    try {
      // The viewport, including any scrollbar: exactly the iframe's size.
      const width = this.window.innerWidth
      const height = this.window.innerHeight
      const focused = this.input.focused
      const composing = this.input.composition
      // While composing, the selection is what the composition replaces: not drawn.
      const selection = isTextField(focused) && !composing ? this.measure(() => measureSelection(focused)) : []
      const composition =
        isTextField(focused) && composing
          ? {
              field: focused,
              value: composedValue(focused, composing).value,
              boxes: this.measure(() => measureComposition(focused, composing)),
              color: this.window.getComputedStyle(focused).color
            }
          : null
      // The page's ::selection color, if it sets one.
      const selectionColor = isTextField(focused)
        ? this.window.getComputedStyle(focused, "::selection").backgroundColor
        : undefined
      // The snapshot measures scrolled text fields with a mirror (caret.ts).
      const xhtml = this.measure(() => snapshotDocument(this.document, {
        hovered: this.input.hovered,
        active: this.input.active,
        focused,
        selection,
        selectionColor,
        composition,
        scrollbar: this.input.scrollbarState,
        inlineImage: url => this.images.get(url)
      }))
      this.options.onFrame({ svg: buildFrameSvg(xhtml, this.css.get(), width, height), width, height })
      this.reportEditing()
      this.reportEditables(width, height)
      this.reportCursor()
    } finally {
      this.notBefore = performance.now() + this.pacer.record(performance.now() - started)
    }
    // Keep sampling while something is animating, so the panel shows it moving.
    if (this.dirty || this.hasLiveAnimations()) this.invalidate()
  }

  /** The text fields in view, for the host to open a soft keyboard on a tap right away. */
  private reportEditables(width: number, height: number): void {
    const boxes: Box[] = []
    for (const field of Array.from(this.document.querySelectorAll("input, textarea"))) {
      if (boxes.length === MAX_EDITABLES) break
      if (!isTextField(field)) continue
      const rect = field.getBoundingClientRect()
      const left = Math.max(0, rect.left)
      const top = Math.max(0, rect.top)
      const right = Math.min(width, rect.right)
      const bottom = Math.min(height, rect.bottom)
      if (right > left && bottom > top) boxes.push({ left, top, width: right - left, height: bottom - top })
    }
    const key = JSON.stringify(boxes)
    if (key === this.lastEditables) return
    this.lastEditables = key
    this.options.onEditables(boxes)
  }

  private reportCursor(): void {
    const cursor = this.input.cursor
    if (cursor === this.lastCursor) return
    this.lastCursor = cursor
    this.options.onCursor(cursor)
  }

  private reportEditing(): void {
    const focused = this.input.focused
    // Any focused element takes keys: Enter and Space on a button, Tab anywhere.
    const editing = focused !== null
    const caret = isTextField(focused) ? this.measure(() => measureCaret(focused, this.input.composition)) : null
    // A selection too long to send is not offered for copying at all, rather than cut short.
    const selected = this.input.selectedText
    const selectedText = selected.length <= MAX_TEXT_LENGTH ? selected : ""
    const key = JSON.stringify([editing, caret, selectedText])
    if (key === this.lastEditing) return
    this.lastEditing = key
    this.options.onEditing(editing, caret, selectedText, this.pointers)
  }
}
