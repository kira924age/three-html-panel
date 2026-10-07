// A web page shown as an interactive panel in a three.js scene.
//
// The page is loaded into an iframe, which gives it its own document, URL and
// globals: an existing app (a SPA with its own router and CSS) can be placed in
// 3D without clashing with the host. The page loads the agent (agent/entry.ts),
// which captures it and replays input in it; the host only exchanges messages
// with the agent (panel-connection.ts) and never reads the page's document, so
// the page can be on another origin.
//
// With `sandbox: true`, the iframe is sandboxed without allow-same-origin: the
// page runs on an opaque origin and cannot reach the host's cookies, storage or
// document, nor take the keyboard. It is not trusted; everything it sends is
// checked. Without it, the page runs as an ordinary page of its origin (a page
// on the host's origin with the host's privileges): only show pages you trust,
// from URLs you choose, never from user input or synced room state.

import {
  BackSide,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Camera,
  type Object3DEventMap,
  type Ray,
  type WebGLRenderer
} from "three"
import { FrameRenderer } from "./frame-renderer"
import { PanelConnection } from "./panel-connection"
import { getSharedKeyboard, type KeyboardTarget, type PanelKeyboard } from "./panel-keyboard"
import { MAX_PAGE_LENGTH, type HostMessage } from "./protocol"
import type { Box, Caret, PointerInput, PointerKind } from "./types"

export interface HtmlPanelOptions {
  /** The page to show. It must load the agent with this page's origin as its host origin. */
  url: string | URL
  /**
   * Runs the page in a sandboxed iframe (allow-scripts allow-forms allow-popups,
   * never allow-same-origin), for pages that are not trusted. Default false.
   */
  sandbox?: boolean
  /** The page's layout width in CSS pixels. */
  width?: number
  /** The page's layout height in CSS pixels. */
  height?: number
  /** The length of the panel's longer side in world units (metres). */
  size?: number
  /** Texture pixels per CSS pixel. */
  pixelRatio?: number
  /** Painted under pages that leave their background transparent. */
  background?: string
  /** Where the iframe lives in the host document. */
  container?: HTMLElement
  keyboard?: PanelKeyboard
  /** How long to wait for the page's agent before giving up, in milliseconds. */
  readyTimeout?: number
  /**
   * Opens a link the user followed in the page (or a URL the page passed to
   * window.open()): an http(s) URL, only right after the user pressed the
   * panel or a key in it. By default, in a new tab of the host's browser.
   */
  onLink?: (url: URL, panel: HtmlPanel) => void
  /** Data the page sent with `sendToHost()` (agent/page.ts). Check it before use. */
  onMessage?: (data: unknown) => void
  onError?: (error: Error) => void
}

const CARET_BLINK_MS = 530

/**
 * The sandbox of an untrusted panel. Never allow-same-origin: with it, a page on
 * the host's origin could reach into the host and remove its own sandbox. Nor
 * allow-popups-to-escape-sandbox. Not configurable on purpose.
 */
export const PANEL_SANDBOX = "allow-scripts allow-forms allow-popups"

/**
 * How long after the user acts on a panel (presses it, or a key while it has the
 * keyboard) its page may take the keyboard (sandboxed pages: by focusing a text
 * field, which the agent reports as editing) or open a link.
 */
const USER_ACTION_MS = 1000
/** If the page never answers a tap that took the keyboard (it hangs), the keyboard is let go after this. */
const TAP_ANSWER_TIMEOUT_MS = 5000

/**
 * Texture pixels per CSS pixel. Phones get 1: drawing and uploading a page at
 * 2x costs them about four times as much, and their screens show the panel small.
 */
export function defaultPixelRatio(): number {
  const phone =
    typeof matchMedia === "function" &&
    matchMedia("(pointer: coarse)").matches &&
    Math.min(screen.width, screen.height) < 768
  return phone ? 1 : 2
}

/** Opens a link in a new tab, without giving the new page a way back to the host. */
function openInNewTab(url: URL): void {
  window.open(url.href, "_blank", "noopener,noreferrer")
}

const RGBA = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/

/** A CSS color as an opaque color and an alpha. THREE.Color ignores alpha (with a warning). */
export function splitAlpha(css: string): { rgb: string; alpha: number } {
  if (css === "transparent") return { rgb: "rgb(0, 0, 0)", alpha: 0 }
  const match = RGBA.exec(css)
  if (!match) return { rgb: css, alpha: 1 }
  const [, r, g, b, a, percent] = match
  const alpha = a === undefined ? 1 : Number(a) / (percent ? 100 : 1)
  return { rgb: `rgb(${r}, ${g}, ${b})`, alpha: Math.min(1, Math.max(0, alpha)) }
}

export interface HtmlPanelEventMap extends Object3DEventMap {
  /** `cursor` changed. */
  cursorchange: {}
}

export class HtmlPanel extends Mesh<PlaneGeometry, MeshBasicMaterial, HtmlPanelEventMap> implements KeyboardTarget {
  readonly iframe = document.createElement("iframe")
  /** The origin the page is expected on; messages from anywhere else are ignored. */
  readonly origin: string
  readonly sandboxed: boolean
  readonly pageWidth: number
  readonly pageHeight: number
  readonly worldWidth: number
  readonly worldHeight: number
  /** The mouse cursor the page asks for where the pointer is, as a CSS keyword. */
  cursor = "default"

  private readonly renderer: FrameRenderer
  private readonly keyboard: PanelKeyboard
  private readonly back: Mesh<PlaneGeometry, MeshBasicMaterial>
  private readonly caret: Mesh<PlaneGeometry, MeshBasicMaterial>
  private readonly caretTimer: number
  private readonly onError: (error: Error) => void
  private readonly connection: PanelConnection
  private editing = false
  /** The text selected in the page's field, as the page reported it last. */
  private selected = ""
  /** The caret the page reported last, in its CSS pixels, for placing the IME. */
  private caretBox: Caret | null = null
  /** Where the page's text fields are (CSS px), as it reported last. */
  private editables: Box[] = []
  /** What drove the pointer last: the IME is placed at the caret only for a mouse. */
  private lastInput: PointerInput = "mouse"
  private keyboardTimer = 0
  /**
   * Presses and releases sent to the current document, and the count a tap's
   * answer must have reached. Not moves or leaves: the page answers a release.
   */
  private pointersSent = 0
  private tapAnswerAt: number | null = null
  /** Where the IME was last placed, to place it again only when it moves. */
  private imePlacement = ""
  private readonly scratch = new Vector3()
  /** Until when the page may act on the user's behalf: shortly after the user acted on the panel. */
  private userActionUntil = -Infinity

  constructor(options: HtmlPanelOptions) {
    const url = new URL(options.url, location.href)
    if (url.origin === "null") {
      // data:, blob: and the like have no origin to check messages against.
      throw new Error(`HtmlPanel needs a page with an origin: ${url.href}`)
    }
    const pageWidth = options.width ?? 800
    const pageHeight = options.height ?? 600
    for (const length of [pageWidth, pageHeight]) {
      if (!Number.isInteger(length) || length <= 0 || length > MAX_PAGE_LENGTH) {
        throw new Error(`HtmlPanel page sizes must be whole numbers from 1 to ${MAX_PAGE_LENGTH}`)
      }
    }
    const size = options.size ?? 1
    const scale = size / Math.max(pageWidth, pageHeight)
    const renderer = new FrameRenderer({
      width: pageWidth,
      height: pageHeight,
      pixelRatio: options.pixelRatio ?? defaultPixelRatio(),
      background: options.background ?? "#ffffff"
    })
    super(
      new PlaneGeometry(pageWidth * scale, pageHeight * scale),
      new MeshBasicMaterial({ map: renderer.texture, toneMapped: false })
    )
    this.renderer = renderer
    this.origin = url.origin
    this.sandboxed = options.sandbox === true
    this.pageWidth = pageWidth
    this.pageHeight = pageHeight
    this.worldWidth = pageWidth * scale
    this.worldHeight = pageHeight * scale
    this.keyboard = options.keyboard ?? getSharedKeyboard()
    this.onError = options.onError ?? (error => console.warn("[three-html-panel]", error.message))

    // A plain back, so the page is not seen mirrored from behind.
    this.back = new Mesh(this.geometry, new MeshBasicMaterial({ color: 0x3a3f4b, side: BackSide }))
    this.back.raycast = () => {}
    this.add(this.back)

    // The caret is drawn on top of the texture, so blinking does not re-upload it.
    this.caret = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ side: DoubleSide, depthWrite: false, transparent: true })
    )
    this.caret.raycast = () => {}
    this.caret.visible = false
    this.caret.renderOrder = 1
    this.add(this.caret)
    this.caretTimer = window.setInterval(() => {
      if (this.editing && this.caret.userData.hasCaret) this.caret.visible = !this.caret.visible
    }, CARET_BLINK_MS)

    this.connection = new PanelConnection({
      iframe: this.iframe,
      origin: this.origin,
      sandboxed: this.sandboxed,
      width: pageWidth,
      height: pageHeight,
      readyTimeout: options.readyTimeout,
      onConnect: () => {
        this.editables = []
        this.pointersSent = 0
        this.tapAnswerAt = null
        this.setEditing(false, null)
        this.setCursor("default")
      },
      onFrame: frame => this.renderer.submit(frame),
      onEditing: (editing, caret, selectedText, pointers) => {
        this.selected = editing ? selectedText : ""
        this.answerTap(editing, pointers)
        this.setEditing(editing, caret)
      },
      onCursor: cursor => this.setCursor(cursor),
      onEditables: boxes => (this.editables = boxes),
      onOpen: url => {
        // Not on its own: a page cannot open tabs, sandboxed or not, unless the user just acted on it.
        if (performance.now() > this.userActionUntil) return
        ;(options.onLink ?? openInNewTab)(new URL(url), this)
      },
      onMessage: data => options.onMessage?.(data),
      onError: error => {
        this.renderer.clear()
        this.setEditing(false, null)
        this.onError(error)
      }
    })
    this.openFrame(url, options.container ?? document.body)
  }

  private openFrame(url: URL, container: HTMLElement): void {
    const iframe = this.iframe
    // Before src: a page that starts loading without the sandbox runs without it.
    if (this.sandboxed) iframe.setAttribute("sandbox", PANEL_SANDBOX)
    iframe.tabIndex = -1
    iframe.setAttribute("aria-hidden", "true")
    iframe.title = "panel"
    // The iframe must stay inside the viewport: browsers throttle rendering and
    // timers of iframes that are off screen, which would freeze the panel. It is
    // transparent, ignores the pointer and sits behind everything instead.
    Object.assign(iframe.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: `${this.pageWidth}px`,
      height: `${this.pageHeight}px`,
      border: "0",
      opacity: "0",
      pointerEvents: "none",
      zIndex: "-1",
      colorScheme: "light"
    })
    this.keyboard.register(iframe, { sandboxed: this.sandboxed })
    iframe.src = url.href
    container.appendChild(iframe)
  }

  private setCursor(cursor: string): void {
    if (cursor === this.cursor) return
    this.cursor = cursor
    this.dispatchEvent({ type: "cursorchange" })
  }

  private setEditing(editing: boolean, caret: Caret | null): void {
    if (editing && !this.editing && !this.mayTakeKeyboard()) {
      // A sandboxed page focused a field on its own (or says it did: the page
      // runs the agent and can send anything). It must not take the keys the
      // user is typing elsewhere; undo its focus instead.
      this.send({ type: "blur" })
      editing = false
      caret = null
    }
    if (editing && !this.editing) {
      this.imePlacement = ""
      this.keyboard.focus(this)
    }
    if (!editing && this.editing) this.keyboard.release(this)
    this.editing = editing
    this.updateCaret(caret)
  }

  private updateCaret(caret: Caret | null): void {
    this.caretBox = caret
    const color = caret ? splitAlpha(caret.color) : null
    // A transparent caret (caret-color: transparent) is how a page hides it.
    if (color?.alpha === 0) caret = null
    this.caret.userData.hasCaret = caret !== null
    this.caret.visible = caret !== null
    if (!caret) return
    const unit = this.worldWidth / this.pageWidth
    const width = Math.max(1.5, caret.height / 14) * unit
    this.caret.scale.set(width, caret.height * unit, 1)
    this.caret.position.set(
      (caret.x / this.pageWidth - 0.5) * this.worldWidth + width / 2,
      (0.5 - (caret.y + caret.height / 2) / this.pageHeight) * this.worldHeight,
      0.0005
    )
    this.caret.material.color.setStyle(color!.rgb)
    this.caret.material.opacity = color!.alpha
  }

  private send(message: HostMessage): void {
    this.connection.send(message)
  }

  /**
   * Sends data to the page, which receives it with `onHostMessage()`
   * (agent/page.ts). It must be structured-cloneable. Dropped while no agent
   * is connected.
   */
  postMessage(data: unknown): void {
    this.send({ type: "app", data })
  }

  // --- Input -----------------------------------------------------------------

  /** Converts a texture coordinate into the page's CSS pixels. */
  private toPage(uv: Vector2): { x: number; y: number } {
    return { x: uv.x * this.pageWidth, y: (1 - uv.y) * this.pageHeight }
  }

  /**
   * The texture coordinate where `ray` meets the panel's plane, or null if it
   * runs parallel or points away. Unlike a raycast, this also answers outside
   * the panel, which keeps a drag going when the pointer leaves the edge.
   */
  uvFromRay(ray: Ray): Vector2 | null {
    this.updateWorldMatrix(true, false)
    const normal = new Vector3(0, 0, 1).transformDirection(this.matrixWorld)
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3().setFromMatrixPosition(this.matrixWorld))
    const point = ray.intersectPlane(plane, new Vector3())
    if (!point) return null
    const local = this.worldToLocal(point)
    return new Vector2(local.x / this.worldWidth + 0.5, local.y / this.worldHeight + 0.5)
  }

  /**
   * Whether the page may take the keyboard now. A trusted page always may. A
   * sandboxed one only right after the user pressed the panel (focusing the
   * field pressed, or one a button press opens), or while it has the keyboard.
   */
  private mayTakeKeyboard(): boolean {
    return !this.sandboxed || this.keyboard.isTarget(this) || performance.now() <= this.userActionUntil
  }

  pointer(kind: PointerKind, uv: Vector2 | null = null, shiftKey = false, input: PointerInput = "mouse"): void {
    if (kind === "down") this.lastInput = input
    if (kind === "down" || kind === "up") this.pointersSent++
    // Only presses and releases (the user acting on this panel) open the window, not hovering.
    if (kind === "down" || kind === "up") this.userActionUntil = performance.now() + USER_ACTION_MS
    const { x, y } = uv ? this.toPage(uv) : { x: 0, y: 0 }
    this.send({ type: "pointer", kind, x, y, shiftKey, input })
  }

  wheel(uv: Vector2, deltaX: number, deltaY: number): void {
    this.send({ type: "wheel", ...this.toPage(uv), deltaX, deltaY })
  }

  sendKey(event: KeyboardEvent): void {
    // Enter on a focused link opens it.
    this.userActionUntil = performance.now() + USER_ACTION_MS
    const { key, shiftKey, ctrlKey, altKey, metaKey } = event
    this.send({ type: "key", key, shiftKey, ctrlKey, altKey, metaKey })
  }

  selectedText(): string {
    return this.selected
  }

  cut(): void {
    this.send({ type: "cut" })
  }

  sendComposition(text: string, cursor: number): void {
    this.send({ type: "composition", text, cursor })
  }

  /**
   * Before the panel is drawn, while the keyboard types into it: moves the
   * keyboard's hidden field to where the caret is on screen, so that the IME's
   * candidate window opens next to it.
   */
  override onBeforeRender(renderer: WebGLRenderer, _scene: unknown, camera: Camera): void {
    const caret = this.caretBox
    if (!caret || !this.keyboard.isTarget(this)) return
    // With a soft keyboard, the field stays in its corner: iOS scrolls the page to
    // show a focused field that the keyboard would cover, and the scene with it.
    if (this.lastInput !== "mouse") return
    const top = this.toClient(caret.x, caret.y, renderer.domElement, camera)
    const bottom = this.toClient(caret.x, caret.y + caret.height, renderer.domElement, camera)
    // Behind the camera: leave the field where it was.
    if (!top || !bottom) return
    const placement = { x: Math.round(top.x), y: Math.round(top.y), height: Math.round(Math.abs(bottom.y - top.y)) }
    const key = `${placement.x},${placement.y},${placement.height}`
    if (key === this.imePlacement) return
    this.imePlacement = key
    this.keyboard.placeIme(placement)
  }

  /**
   * For a tap on the panel at `uv`, while the touch is still being handled: if it
   * lands on a text field, takes the keyboard now. iOS shows the soft keyboard
   * only for focus moved during a touch's own handling, which is long over when
   * the page hears of the tap. True if it did. If the page's answer to the tap
   * shows no focus (the tap was on something over the field, say), the keyboard
   * is let go then, however long the page took to answer.
   */
  focusForTyping(uv: Vector2): boolean {
    const { x, y } = this.toPage(uv)
    if (!this.editables.some(box => x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height)) {
      return false
    }
    this.userActionUntil = performance.now() + USER_ACTION_MS
    this.keyboard.focus(this)
    // The tap's release went out before this touchend: its answer has counted it.
    this.tapAnswerAt = this.pointersSent
    window.clearTimeout(this.keyboardTimer)
    this.keyboardTimer = window.setTimeout(() => {
      if (this.tapAnswerAt === null) return
      this.tapAnswerAt = null
      if (!this.editing) this.keyboard.release(this)
    }, TAP_ANSWER_TIMEOUT_MS)
    return true
  }

  /** An editing report: if it answers the tap that took the keyboard, keep the keyboard only if a field has focus. */
  private answerTap(editing: boolean, pointers: number): void {
    if (this.tapAnswerAt === null || pointers < this.tapAnswerAt) return
    this.tapAnswerAt = null
    window.clearTimeout(this.keyboardTimer)
    if (!editing && !this.editing) this.keyboard.release(this)
  }

  /** A point of the page (CSS pixels) on screen (client pixels of the canvas's page), or null behind the camera. */
  private toClient(x: number, y: number, canvas: HTMLCanvasElement, camera: Camera): { x: number; y: number } | null {
    const point = this.scratch.set((x / this.pageWidth - 0.5) * this.worldWidth, (0.5 - y / this.pageHeight) * this.worldHeight, 0)
    this.localToWorld(point).project(camera)
    if (point.z < -1 || point.z > 1) return null
    const rect = canvas.getBoundingClientRect()
    return { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height }
  }

  sendText(text: string): void {
    this.send({ type: "text", text })
  }

  blurFromHost(): void {
    // The host decides: editing ends now, whatever the page reports later.
    this.editing = false
    this.updateCaret(null)
    this.send({ type: "blur" })
  }

  /** Takes focus away from whatever has it in the page (e.g. the user pressed elsewhere). */
  blur(): void {
    if (!this.editing) return
    this.keyboard.release(this)
    this.editing = false
    this.updateCaret(null)
    this.send({ type: "blur" })
  }

  dispose(): void {
    window.clearInterval(this.caretTimer)
    window.clearTimeout(this.keyboardTimer)
    this.connection.dispose()
    this.keyboard.release(this)
    this.keyboard.unregister(this.iframe)
    this.iframe.remove()
    this.renderer.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.back.material.dispose()
    this.caret.geometry.dispose()
    this.caret.material.dispose()
  }
}
