// Watches the panel page and turns it into SVG frames whenever it changes.
// Also routes input into the page and reports whether a text field has focus,
// and where its caret is.
//
// This runs inside the page, as part of the agent, and lives as long as the
// document. It installs the page's virtual focus and pointer capture as soon
// as it is created, but only takes snapshots once the agent is connected to
// the host (start()).

import { isTextField, measureCaret, measureSelection } from "../input/caret"
import { InputSynthesizer } from "../input/input"
import type { Caret, Frame, FrameWindow, PanelInput } from "../../types"
import { DocumentCss } from "./css"
import { ImageInliner } from "./images"
import { RenderPacer } from "./pacer"
import { buildFrameSvg, snapshotDocument } from "./snapshot"

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
  onEditing: (editing: boolean, caret: Caret | null) => void
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
    this.css.invalidate()
    this.invalidate()
  }

  handle(input: PanelInput): void {
    if (!this.disposed) this.input.handle(input)
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

  private hasRunningAnimations(): boolean {
    const { document } = this
    return typeof document.getAnimations === "function" && document.getAnimations().some(a => a.playState === "running")
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
      const selection = isTextField(focused) ? this.measure(() => measureSelection(focused)) : []
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
        scrollbar: this.input.scrollbarState,
        inlineImage: url => this.images.get(url)
      }))
      this.options.onFrame({ svg: buildFrameSvg(xhtml, this.css.get(), width, height), width, height })
      this.reportEditing()
      this.reportCursor()
    } finally {
      this.notBefore = performance.now() + this.pacer.record(performance.now() - started)
    }
    // Keep sampling while something is animating, so the panel shows it moving.
    if (this.dirty || this.hasRunningAnimations()) this.invalidate()
  }

  private reportCursor(): void {
    const cursor = this.input.cursor
    if (cursor === this.lastCursor) return
    this.lastCursor = cursor
    this.options.onCursor(cursor)
  }

  private reportEditing(): void {
    const focused = this.input.focused
    const editing = isTextField(focused)
    const caret = editing ? this.measure(() => measureCaret(focused)) : null
    const key = JSON.stringify([editing, caret])
    if (key === this.lastEditing) return
    this.lastEditing = key
    this.options.onEditing(editing, caret)
  }
}
