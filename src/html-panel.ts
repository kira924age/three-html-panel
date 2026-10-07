// A web page shown as an interactive panel in a three.js scene.
//
// The page is loaded into an iframe, which gives it its own document, URL and
// globals: an existing app (a SPA with its own router and CSS) can be placed in
// 3D without clashing with the host. The page loads the agent (agent/entry.ts),
// which captures it and replays input in it; the host only exchanges messages
// with the agent (panel-connection.ts) and never reads the page's document, so
// the page can be on another origin.
//
// The iframe is not sandboxed. Only show pages you trust, from URLs you choose,
// never from user input or synced room state.

import {
  BackSide,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Object3DEventMap,
  type Ray
} from "three"
import { FrameRenderer } from "./frame-renderer"
import { PanelConnection } from "./panel-connection"
import { getSharedKeyboard, type KeyboardTarget, type PanelKeyboard } from "./panel-keyboard"
import { MAX_PAGE_LENGTH, type HostMessage } from "./protocol"
import type { Caret, PointerKind } from "./types"

export interface HtmlPanelOptions {
  /** The page to show. It must load the agent with this page's origin as its host origin. */
  url: string | URL
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
  /** Data the page sent with `sendToHost()` (agent/page.ts). Check it before use. */
  onMessage?: (data: unknown) => void
  onError?: (error: Error) => void
}

const CARET_BLINK_MS = 530

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
      pixelRatio: options.pixelRatio ?? 2,
      background: options.background ?? "#ffffff"
    })
    super(
      new PlaneGeometry(pageWidth * scale, pageHeight * scale),
      new MeshBasicMaterial({ map: renderer.texture, toneMapped: false })
    )
    this.renderer = renderer
    this.origin = url.origin
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
      width: pageWidth,
      height: pageHeight,
      readyTimeout: options.readyTimeout,
      onConnect: () => {
        this.setEditing(false, null)
        this.setCursor("default")
      },
      onFrame: frame => this.renderer.submit(frame),
      onEditing: (editing, caret) => this.setEditing(editing, caret),
      onCursor: cursor => this.setCursor(cursor),
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
    this.keyboard.register(iframe)
    iframe.src = url.href
    container.appendChild(iframe)
  }

  private setCursor(cursor: string): void {
    if (cursor === this.cursor) return
    this.cursor = cursor
    this.dispatchEvent({ type: "cursorchange" })
  }

  private setEditing(editing: boolean, caret: Caret | null): void {
    if (editing && !this.editing) this.keyboard.focus(this)
    if (!editing && this.editing) this.keyboard.release(this)
    this.editing = editing
    this.updateCaret(caret)
  }

  private updateCaret(caret: Caret | null): void {
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

  pointer(kind: PointerKind, uv: Vector2 | null = null, shiftKey = false): void {
    const { x, y } = uv ? this.toPage(uv) : { x: 0, y: 0 }
    this.send({ type: "pointer", kind, x, y, shiftKey })
  }

  wheel(uv: Vector2, deltaX: number, deltaY: number): void {
    this.send({ type: "wheel", ...this.toPage(uv), deltaX, deltaY })
  }

  sendKey(event: KeyboardEvent): void {
    const { key, shiftKey, ctrlKey, altKey, metaKey } = event
    this.send({ type: "key", key, shiftKey, ctrlKey, altKey, metaKey })
  }

  sendText(text: string): void {
    this.send({ type: "text", text })
  }

  blurFromHost(): void {
    this.send({ type: "blur" })
  }

  /** Takes focus away from whatever has it in the page (e.g. the user pressed elsewhere). */
  blur(): void {
    if (!this.editing) return
    this.keyboard.release(this)
    this.send({ type: "blur" })
  }

  dispose(): void {
    window.clearInterval(this.caretTimer)
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
