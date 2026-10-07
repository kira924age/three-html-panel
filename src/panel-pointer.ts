// Routes the mouse, touch and wheel input of the scene's canvas to panels.
//
// - Hovering a panel sends `move`; leaving it sends `leave`.
// - Pressing a panel captures the pointer until it is released: moves go to
//   that panel even outside its edges, so a drag inside the page keeps working.
// - Presses and wheel events on a panel are stopped before other listeners on
//   the canvas (camera controls), so dragging inside a page does not also
//   orbit the camera.
//
// Whether a press and release make a click is decided in the page (input.ts), from how
// far the pointer moved in the page.
//
// While the pointer is over a panel (or dragging in one), the canvas shows the
// mouse cursor the page asks for there.

import { Raycaster, Vector2, type Camera } from "three"
import type { HtmlPanel } from "./html-panel"

const LINE_HEIGHT_PX = 16

export class PanelPointer {
  private readonly raycaster = new Raycaster()
  private hovered: HtmlPanel | null = null
  private pressed: { panel: HtmlPanel; pointerId: number } | null = null
  /** The panel whose cursor the canvas shows, and the canvas's own cursor to restore. */
  private cursorPanel: HtmlPanel | null = null
  private ownCursor = ""

  constructor(
    private readonly camera: Camera,
    private readonly element: HTMLElement,
    private readonly panels: () => readonly HtmlPanel[]
  ) {
    // Capture phase: runs before camera controls listening on the same element.
    element.addEventListener("pointerdown", this.onPointerDown, true)
    element.addEventListener("pointermove", this.onPointerMove, true)
    element.addEventListener("pointerup", this.onPointerUp, true)
    element.addEventListener("pointercancel", this.onPointerUp, true)
    element.addEventListener("pointerleave", this.onPointerLeave)
    element.addEventListener("wheel", this.onWheel, { capture: true, passive: false })
    // Keep keyboard focus where it is (the panel keyboard) when pressing a panel.
    element.addEventListener("mousedown", this.onMouseDown, true)
  }

  private setRay(event: PointerEvent | WheelEvent | MouseEvent): void {
    const rect = this.element.getBoundingClientRect()
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
  }

  /** The nearest panel under the pointer and the texture coordinate hit. */
  private pick(event: PointerEvent | WheelEvent | MouseEvent): { panel: HtmlPanel; uv: Vector2 } | null {
    this.setRay(event)
    const hit = this.raycaster.intersectObjects(this.panels() as HtmlPanel[], false)[0]
    if (!hit?.uv) return null
    return { panel: hit.object as HtmlPanel, uv: hit.uv }
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.pressed) return
    const hit = this.pick(event)
    // Pressing anything else in the scene ends typing into the panels.
    for (const panel of this.panels()) if (panel !== hit?.panel) panel.blur()
    if (!hit) return
    event.stopImmediatePropagation()
    this.element.setPointerCapture(event.pointerId)
    this.pressed = { panel: hit.panel, pointerId: event.pointerId }
    this.hover(hit.panel)
    hit.panel.pointer("down", hit.uv)
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.pressed) {
      if (event.pointerId !== this.pressed.pointerId) return
      this.setRay(event)
      const uv = this.pressed.panel.uvFromRay(this.raycaster.ray)
      if (uv) this.pressed.panel.pointer("move", uv)
      return
    }
    const hit = this.pick(event)
    this.hover(hit?.panel ?? null)
    if (hit) hit.panel.pointer("move", hit.uv)
  }

  private readonly onPointerUp = (event: PointerEvent) => {
    const pressed = this.pressed
    if (!pressed || event.pointerId !== pressed.pointerId) return
    this.pressed = null
    this.setRay(event)
    const uv = pressed.panel.uvFromRay(this.raycaster.ray) ?? new Vector2(-1, -1)
    pressed.panel.pointer("up", uv)
    // A touch has no hover after it lifts.
    if (event.pointerType === "touch") this.hover(null)
    this.updateCursor()
  }

  private readonly onPointerLeave = () => {
    if (!this.pressed) this.hover(null)
  }

  private readonly onMouseDown = (event: MouseEvent) => {
    if (this.pick(event)) event.preventDefault()
  }

  private readonly onWheel = (event: WheelEvent) => {
    const hit = this.pick(event)
    if (!hit) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT_PX : 1
    hit.panel.wheel(hit.uv, event.deltaX * scale, event.deltaY * scale)
  }

  private hover(panel: HtmlPanel | null): void {
    if (panel === this.hovered) return
    this.hovered?.pointer("leave")
    this.hovered = panel
    this.updateCursor()
  }

  /** Shows the cursor of the panel being dragged in, or else hovered, on the canvas. */
  private updateCursor(): void {
    const panel = this.pressed?.panel ?? this.hovered
    if (panel === this.cursorPanel) return
    if (this.cursorPanel) this.cursorPanel.removeEventListener("cursorchange", this.onCursorChange)
    else if (panel) this.ownCursor = this.element.style.cursor
    this.cursorPanel = panel
    if (panel) {
      panel.addEventListener("cursorchange", this.onCursorChange)
      this.onCursorChange()
    } else {
      this.element.style.cursor = this.ownCursor
    }
  }

  private readonly onCursorChange = () => {
    if (this.cursorPanel) this.element.style.cursor = this.cursorPanel.cursor
  }

  dispose(): void {
    this.hovered = null
    this.pressed = null
    this.updateCursor()
    this.element.removeEventListener("pointerdown", this.onPointerDown, true)
    this.element.removeEventListener("pointermove", this.onPointerMove, true)
    this.element.removeEventListener("pointerup", this.onPointerUp, true)
    this.element.removeEventListener("pointercancel", this.onPointerUp, true)
    this.element.removeEventListener("pointerleave", this.onPointerLeave)
    this.element.removeEventListener("wheel", this.onWheel, true)
    this.element.removeEventListener("mousedown", this.onMouseDown, true)
  }
}
