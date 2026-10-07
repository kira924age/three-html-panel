// A web page shown as an interactive panel in a three.js scene.
//
// The page is loaded into a same-origin iframe, which gives it its own
// document, URL and globals: an existing app (a SPA with its own router and
// CSS) can be placed in 3D without changes and without clashing with the host.
// The host reads the iframe's document directly to capture it, and dispatches
// events into it.
//
// Same-origin means the page runs with the host's privileges. Only show pages
// you trust, from URLs you choose, never from user input or synced room state.

import { BackSide, DoubleSide, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Vector2, Vector3, type Ray } from "three"
import { PageCapture } from "./capture/page-capture"
import { FrameRenderer } from "./frame-renderer"
import { getSharedKeyboard, type KeyboardTarget, type PanelKeyboard } from "./panel-keyboard"
import type { Caret, PanelInput, PointerKind } from "./types"

export interface HtmlPanelOptions {
  /** The page to show. It must be on the host's origin. */
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
  onError?: (error: Error) => void
}

const CARET_BLINK_MS = 530

export class HtmlPanel extends Mesh<PlaneGeometry, MeshBasicMaterial> implements KeyboardTarget {
  readonly iframe = document.createElement("iframe")
  readonly pageWidth: number
  readonly pageHeight: number
  readonly worldWidth: number
  readonly worldHeight: number

  private readonly renderer: FrameRenderer
  private readonly keyboard: PanelKeyboard
  private readonly back: Mesh<PlaneGeometry, MeshBasicMaterial>
  private readonly caret: Mesh<PlaneGeometry, MeshBasicMaterial>
  private readonly caretTimer: number
  private readonly onError: (error: Error) => void
  private capture: PageCapture | null = null
  private editing = false

  constructor(options: HtmlPanelOptions) {
    const url = new URL(options.url, location.href)
    if (url.origin !== location.origin) {
      // A cross-origin document cannot be read, so it could not be captured.
      throw new Error(`HtmlPanel only shows pages on ${location.origin}: ${url.href}`)
    }
    const pageWidth = options.width ?? 800
    const pageHeight = options.height ?? 600
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
    this.caret = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ side: DoubleSide, depthWrite: false }))
    this.caret.raycast = () => {}
    this.caret.visible = false
    this.caret.renderOrder = 1
    this.add(this.caret)
    this.caretTimer = window.setInterval(() => {
      if (this.editing && this.caret.userData.hasCaret) this.caret.visible = !this.caret.visible
    }, CARET_BLINK_MS)

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
    // Every document the iframe loads (the first one, a reload, a navigation)
    // gets its own capture.
    iframe.addEventListener("load", this.onFrameLoad)
    this.keyboard.register(iframe)
    iframe.src = url.href
    container.appendChild(iframe)
  }

  private readonly onFrameLoad = () => {
    this.capture?.dispose()
    this.capture = null
    this.setEditing(false, null)
    const document = this.iframe.contentDocument
    if (!document) {
      // Navigated to another origin: nothing can be read any more.
      this.renderer.clear()
      this.onError(new Error("the panel navigated to a page that cannot be read"))
      return
    }
    this.capture = new PageCapture(document, {
      onFrame: frame => this.renderer.submit(frame),
      onEditing: (editing, caret) => this.setEditing(editing, caret)
    })
  }

  private setEditing(editing: boolean, caret: Caret | null): void {
    if (editing && !this.editing) this.keyboard.focus(this)
    if (!editing && this.editing) this.keyboard.release(this)
    this.editing = editing
    this.updateCaret(caret)
  }

  private updateCaret(caret: Caret | null): void {
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
    this.caret.material.color.setStyle(caret.color)
  }

  private send(input: PanelInput): void {
    this.capture?.handle(input)
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

  pointer(kind: PointerKind, uv: Vector2 | null = null): void {
    const { x, y } = uv ? this.toPage(uv) : { x: 0, y: 0 }
    this.send({ type: "pointer", kind, x, y })
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
    this.iframe.removeEventListener("load", this.onFrameLoad)
    window.clearInterval(this.caretTimer)
    this.capture?.dispose()
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
