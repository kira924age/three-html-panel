// Routes WebXR controllers to panels, like PanelPointer does the mouse.
//
// - A controller's ray hovers a panel; the trigger (select) presses it.
// - While pressed, moves go to that panel even off its edges, and a drag
//   scrolls it like a finger does (the page gets input "xr", see
//   agent/input/pan.ts).
// - The thumbstick scrolls the panel under the controller, like a wheel.
// - Pressing anything but a panel ends typing into the panels.
//
// Call update() once per frame, in the animation loop. Text input in VR is
// not handled: an immersive session shows no system keyboard for the host's
// hidden field.

import { Raycaster, Vector2, type WebGLRenderer, type XRTargetRaySpace } from "three"
import type { HtmlPanel } from "./html-panel"

/** Thumbstick deflection below this is ignored (sticks rarely rest exactly at 0). */
const STICK_DEAD_ZONE = 0.15
/** CSS pixels per second at full deflection. */
const STICK_SCROLL_SPEED = 900

interface Controller {
  space: XRTargetRaySpace
  source: XRInputSource | null
}

export class PanelXRPointer {
  private readonly raycaster = new Raycaster()
  private readonly controllers: Controller[]
  private hovered: { panel: HtmlPanel; controller: Controller } | null = null
  private pressed: { panel: HtmlPanel; controller: Controller } | null = null
  private lastUpdate = 0
  private readonly cleanups: (() => void)[] = []

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly panels: () => readonly HtmlPanel[],
    controllerCount = 2
  ) {
    this.controllers = Array.from({ length: controllerCount }, (_, index) => ({
      space: renderer.xr.getController(index),
      source: null
    }))
    for (const controller of this.controllers) {
      const { space } = controller
      const onConnected = (event: { data: XRInputSource }) => (controller.source = event.data)
      const onDisconnected = () => {
        controller.source = null
        this.release(controller)
      }
      const onSelectStart = () => this.press(controller)
      const onSelectEnd = () => this.release(controller)
      space.addEventListener("connected", onConnected)
      space.addEventListener("disconnected", onDisconnected)
      space.addEventListener("selectstart", onSelectStart)
      space.addEventListener("selectend", onSelectEnd)
      this.cleanups.push(() => {
        space.removeEventListener("connected", onConnected)
        space.removeEventListener("disconnected", onDisconnected)
        space.removeEventListener("selectstart", onSelectStart)
        space.removeEventListener("selectend", onSelectEnd)
      })
    }
    const onSessionEnd = () => {
      this.pressed = null
      this.hover(null)
    }
    renderer.xr.addEventListener("sessionend", onSessionEnd)
    this.cleanups.push(() => renderer.xr.removeEventListener("sessionend", onSessionEnd))
  }

  /** Sends hover and drag moves, and thumbstick scrolling, for this frame. */
  update(now = performance.now()): void {
    const seconds = this.lastUpdate ? Math.min(0.1, (now - this.lastUpdate) / 1000) : 0
    this.lastUpdate = now
    if (!this.renderer.xr.isPresenting) return

    const pressed = this.pressed
    if (pressed) {
      this.raycaster.setFromXRController(pressed.controller.space)
      const uv = pressed.panel.uvFromRay(this.raycaster.ray)
      if (uv) pressed.panel.pointer("move", uv, false, "xr")
      return
    }
    // The first controller that points at a panel hovers it.
    let hit: { panel: HtmlPanel; uv: Vector2; controller: Controller } | null = null
    for (const controller of this.controllers) {
      if (!controller.source) continue
      const found = this.pick(controller)
      if (found) {
        hit = { ...found, controller }
        break
      }
    }
    this.hover(hit && { panel: hit.panel, controller: hit.controller })
    if (!hit) return
    hit.panel.pointer("move", hit.uv, false, "xr")
    const axes = hit.controller.source?.gamepad?.axes
    // xr-standard gamepads put the thumbstick on axes 2 (x) and 3 (y).
    const dx = deadZone(axes?.[2] ?? 0)
    const dy = deadZone(axes?.[3] ?? 0)
    if ((dx || dy) && seconds > 0) {
      hit.panel.wheel(hit.uv, dx * STICK_SCROLL_SPEED * seconds, dy * STICK_SCROLL_SPEED * seconds)
    }
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.pressed = null
    this.hover(null)
  }

  private pick(controller: Controller): { panel: HtmlPanel; uv: Vector2 } | null {
    this.raycaster.setFromXRController(controller.space)
    const hit = this.raycaster.intersectObjects(this.panels() as HtmlPanel[], false)[0]
    if (!hit?.uv) return null
    return { panel: hit.object as HtmlPanel, uv: hit.uv }
  }

  private press(controller: Controller): void {
    if (this.pressed) return
    const hit = this.pick(controller)
    // Pressing anything else ends typing into the panels.
    for (const panel of this.panels()) if (panel !== hit?.panel) panel.blur()
    if (!hit) return
    this.pressed = { panel: hit.panel, controller }
    this.hover({ panel: hit.panel, controller })
    hit.panel.pointer("down", hit.uv, false, "xr")
  }

  private release(controller: Controller): void {
    const pressed = this.pressed
    if (!pressed || pressed.controller !== controller) return
    this.pressed = null
    this.raycaster.setFromXRController(controller.space)
    // Off the panel's plane (pointing away): released outside the page.
    const uv = pressed.panel.uvFromRay(this.raycaster.ray) ?? new Vector2(-1, -1)
    pressed.panel.pointer("up", uv, false, "xr")
  }

  private hover(next: { panel: HtmlPanel; controller: Controller } | null): void {
    if (next?.panel === this.hovered?.panel) {
      this.hovered = next
      return
    }
    this.hovered?.panel.pointer("leave")
    this.hovered = next
  }
}

const deadZone = (value: number) => (Math.abs(value) < STICK_DEAD_ZONE ? 0 : value)
