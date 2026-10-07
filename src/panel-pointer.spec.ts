// @vitest-environment jsdom
import { Mesh, PerspectiveCamera, PlaneGeometry, Vector2 } from "three"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HtmlPanel } from "./html-panel"
import { PanelPointer } from "./panel-pointer"

let canvas: HTMLCanvasElement
let panel: HtmlPanel & { focusForTyping: ReturnType<typeof vi.fn>; pointer: ReturnType<typeof vi.fn> }

beforeEach(() => {
  canvas = document.createElement("canvas")
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  canvas.setPointerCapture = () => {}
  // A 1x1 panel filling the middle of the view of a camera 1 unit away.
  const mesh = new Mesh(new PlaneGeometry(1, 1))
  mesh.updateMatrixWorld()
  panel = Object.assign(mesh, {
    pointer: vi.fn(),
    blur: vi.fn(),
    focusForTyping: vi.fn(() => true),
    uvFromRay: () => new Vector2(0.5, 0.5),
    cursor: "default",
    addEventListener: () => {},
    removeEventListener: () => {}
  }) as never
  const camera = new PerspectiveCamera(60, 800 / 600, 0.01, 10)
  camera.position.set(0, 0, 1)
  camera.updateMatrixWorld()
  new PanelPointer(camera, canvas, () => [panel])
})

const at = (type: string, pointerType: string) =>
  new PointerEvent(type, { clientX: 400, clientY: 300, button: 0, pointerId: 1, pointerType, bubbles: true, cancelable: true })

/** A touchend at the middle of the canvas. */
function touchEnd(): Event {
  const event = new Event("touchend", { cancelable: true })
  Object.defineProperty(event, "changedTouches", { value: [{ clientX: 400, clientY: 300 }] })
  Object.defineProperty(event, "touches", { value: [] })
  canvas.dispatchEvent(event)
  return event
}

describe("PanelPointer", () => {
  it("tells the panel what drives the pointer", () => {
    canvas.dispatchEvent(at("pointerdown", "touch"))
    canvas.dispatchEvent(at("pointerup", "touch"))
    canvas.dispatchEvent(at("pointerdown", "mouse"))
    const inputs = panel.pointer.mock.calls.filter(call => call[0] !== "leave").map(call => [call[0], call[3]])
    expect(inputs).toEqual([
      ["down", "touch"],
      ["up", "touch"],
      ["down", "mouse"]
    ])
  })

  it("takes the keyboard during a touchend on a text field, and stops the mouse events after it", () => {
    expect(touchEnd().defaultPrevented).toBe(true)
    expect(panel.focusForTyping).toHaveBeenCalledTimes(1)
    panel.focusForTyping.mockReturnValue(false)
    expect(touchEnd().defaultPrevented).toBe(false)
  })
})
