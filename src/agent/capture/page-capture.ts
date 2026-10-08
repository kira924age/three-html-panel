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
import { isListBox } from "../input/list-box"
import { caretAtPoint, clipCaret, editingHostOf, fontOf, intersect, selectedRange, selectionBoxes, selectionColorAt, visibleBoxOf } from "../input/selection"
import type { Box, Caret, Frame, FrameWindow, PanelInput } from "../../types"
import { DocumentCss } from "./css"
import { ImageInliner } from "./images"
import { MAX_EDITABLES, MAX_TEXT_LENGTH } from "../../protocol"
import { RenderPacer } from "./pacer"
import { buildFrameSvg, isSampledLive, snapshotDocument, type ListBoxRow } from "./snapshot"

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
  "resize",
  // The page's selection (dragging, an editable's caret, or the page's own code).
  "selectionchange",
  // A video shows another frame (while it plays, frames keep coming, see render()).
  "loadeddata",
  "play",
  "pause",
  "seeked",
  "ended"
]

export interface PageCaptureOptions {
  onFrame: (frame: Frame) => void
  /**
   * Whether an element has focus (keys should come to the page), a text field's
   * caret, its selected text (for the host to copy), and how many presses and
   * releases have been handled. Also sent after every release, changed or not.
   */
  onEditing: (editing: boolean, caret: Caret | null, selectedText: string, pointers: number, typing: boolean) => void
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
  /** Presses and releases handled for this document (see onEditing). */
  private pointers = 0
  /**
   * Bumped when the page may look different (its layout), and when its text
   * changes: the page's selection is measured again only then, not on every
   * frame an animation or a video asks for.
   */
  private layoutVersion = 0
  private textVersion = 0
  private selectionBoxesCache: { key: SelectionKey; boxes: Box[] } | null = null
  private selectionTextCache: { key: SelectionKey; text: string } | null = null
  private started = false
  private disposed = false

  constructor(
    private readonly document: Document,
    private readonly options: PageCaptureOptions
  ) {
    this.window = document.defaultView as FrameWindow
    this.images = new ImageInliner(() => {
      this.css.invalidate()
      this.changed()
    })
    this.css = new DocumentCss(document, url => this.images.get(url), () => this.changed())
    this.mutations = new this.window.MutationObserver(records => {
      if (records.some(record => record.type !== "attributes")) this.textVersion++
      this.changed()
    })
    this.input = new InputSynthesizer(document, { measure: this.measure, onChange: () => this.changed() })

    this.mutations.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
    for (const type of INVALIDATING_EVENTS) this.window.addEventListener(type, this.changed, true)
    void document.fonts?.ready.then(() => {
      this.css.invalidate()
      this.changed()
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
    if (input.type !== "pointer" || (input.kind !== "down" && input.kind !== "up")) return
    this.pointers++
    // The host waits for the page's answer to a tap (did it focus a text field?).
    // Moves and leaves after it are not counted: they could come before the answer.
    if (input.kind === "up") this.lastEditing = ""
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.input.dispose()
    this.mutations.disconnect()
    for (const type of INVALIDATING_EVENTS) this.window.removeEventListener(type, this.changed, true)
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

  /** The page may look different: capture it again, and measure its selection again. */
  private readonly changed = () => {
    this.layoutVersion++
    this.invalidate()
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
      const host = focused && editingHostOf(focused) === focused ? focused : null
      // While composing, the selection is what the composition replaces: not drawn.
      // Outside text fields, the page's own selection is drawn (its text, or an editable's).
      const range = isTextField(focused) || (host && composing) ? null : selectedRange(this.window)
      const selection = isTextField(focused)
        ? composing
          ? []
          : this.measure(() => measureSelection(focused))
        : range
          ? this.selectionBoxes(range)
          : []
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
        : range
          ? selectionColorAt(this.window, range)
          : undefined
      // The snapshot measures scrolled text fields with a mirror (caret.ts).
      const xhtml = this.measure(() => snapshotDocument(this.document, {
        hovered: this.input.hovered,
        active: this.input.active,
        focused,
        selection,
        selectionColor,
        // The page's selection, when the keys do not go to it (the host took them, or the page made it).
        selectionInactive: range !== null && !this.input.hasSelection && !(host && host.contains(range.startContainer)),
        composition,
        inlineComposition: host && composing ? this.inlineComposition(composing.text) : null,
        scrollbar: this.input.scrollbarState,
        selectPopup: this.input.popupView,
        listBoxSelection: isListBox(focused) ? this.listBoxRows(focused) : [],
        inlineImage: url => this.images.get(url)
      }))
      this.options.onFrame({ svg: buildFrameSvg(xhtml, this.css.get(), width, height), width, height })
      this.reportEditing()
      this.reportEditables(width, height)
      this.reportCursor()
    } finally {
      this.notBefore = performance.now() + this.pacer.record(performance.now() - started)
    }
    // Keep sampling while something is animating or a video plays, so the panel shows it moving.
    if (this.dirty || this.hasLiveAnimations() || this.hasPlayingVideo()) this.invalidate()
  }

  /** The boxes of the page's selection, measured again only when it or the page changed. */
  private selectionBoxes(range: Range): Box[] {
    const key = selectionKey(range, this.layoutVersion)
    const cached = this.selectionBoxesCache
    if (cached && sameKey(cached.key, key)) return cached.boxes
    const boxes = selectionBoxes(this.window, range)
    this.selectionBoxesCache = { key, boxes }
    return boxes
  }

  /** The text to copy: a text field's, or the page's selection (built again only when it or the text changed). */
  private selectedText(): string {
    if (isTextField(this.input.focused)) return this.input.selectedText
    const range = selectedRange(this.window)
    if (!range) return ""
    const key = selectionKey(range, this.textVersion)
    const cached = this.selectionTextCache
    if (cached && sameKey(cached.key, key)) return cached.text
    const text = this.input.selectedText
    this.selectionTextCache = { key, text }
    return text
  }

  /** The selected options of the focused list box, where they show. */
  private listBoxRows(select: HTMLSelectElement): ListBoxRow[] {
    const visible = visibleBoxOf(select)
    const rows: ListBoxRow[] = []
    for (const option of Array.from(select.selectedOptions)) {
      const rect = option.getBoundingClientRect()
      const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      const shown = intersect(box, visible)
      if (shown.width <= 0 || shown.height <= 0) continue
      const paddingLeft = parseFloat(this.window.getComputedStyle(option).paddingLeft) || 0
      rows.push({ shown, box, label: option.label || option.text, font: fontOf(option), paddingLeft })
    }
    return rows
  }

  private hasPlayingVideo(): boolean {
    return Array.from(this.document.querySelectorAll("video")).some(
      video => !video.paused && !video.ended && video.readyState >= 2
    )
  }

  /** Where text composed in an editable shows: where the selection starts, in place of what is selected in that node. */
  private inlineComposition(text: string): { node: Node; offset: number; endOffset: number; text: string } | null {
    const selection = this.window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    const sameText = range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE
    return { node: range.startContainer, offset: range.startOffset, endOffset: sameText ? range.endOffset : range.startOffset, text }
  }

  /** The caret of a focused editable (its collapsed selection), or null while text is selected or it is elsewhere. */
  private editableCaret(host: HTMLElement): Caret | null {
    const selection = this.window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const composing = this.input.composition
    if (!selection.isCollapsed && !composing) return null
    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer)) return null
    const caret = caretAtPoint(
      { node: range.startContainer, offset: range.startOffset },
      composing ? composing.text.slice(0, composing.cursor) : ""
    )
    // Cut to what shows of the editable.
    const shown = caret && clipCaret(caret, visibleBoxOf(host))
    if (!shown) return null
    const computed = this.window.getComputedStyle(host)
    const color = computed.caretColor === "auto" ? computed.color : computed.caretColor
    return { ...shown, color }
  }

  /** The text fields and editables in view, for the host to open a soft keyboard on a tap right away. */
  private reportEditables(width: number, height: number): void {
    const boxes: Box[] = []
    for (const field of Array.from(this.document.querySelectorAll("input, textarea, [contenteditable]"))) {
      if (boxes.length === MAX_EDITABLES) break
      if (!isTextField(field) && editingHostOf(field) !== field) continue
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
    // So does selected text, to be copied.
    const editing = focused !== null || this.input.hasSelection
    const host = focused ? editingHostOf(focused) : null
    const caret = isTextField(focused)
      ? this.measure(() => measureCaret(focused, this.input.composition))
      : host && host === focused
        ? this.editableCaret(host)
        : null
    // A selection too long to send is not offered for copying at all, rather than cut short.
    const selected = this.selectedText()
    const selectedText = selected.length <= MAX_TEXT_LENGTH ? selected : ""
    // Text typed now goes in: a text field or an editable has focus (with or without a caret).
    const typing = isTextField(focused) || (host !== null && host === focused)
    const key = JSON.stringify([editing, caret, selectedText, typing])
    if (key === this.lastEditing) return
    this.lastEditing = key
    this.options.onEditing(editing, caret, selectedText, this.pointers, typing)
  }
}

/** A selection's ends and the page's version, to tell whether what was measured of it still holds. */
interface SelectionKey {
  start: Node
  startOffset: number
  end: Node
  endOffset: number
  version: number
}

const selectionKey = (range: Range, version: number): SelectionKey => ({
  start: range.startContainer,
  startOffset: range.startOffset,
  end: range.endContainer,
  endOffset: range.endOffset,
  version
})

const sameKey = (a: SelectionKey, b: SelectionKey) =>
  a.start === b.start && a.startOffset === b.startOffset && a.end === b.end && a.endOffset === b.endOffset && a.version === b.version
