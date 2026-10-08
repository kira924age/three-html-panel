// The host page the e2e tests drive: one panel, flat, filling the canvas, so
// that a point of the panel page maps to a point on screen by a scale alone.
//
// ?page=<name under panels/>&width=<px>&height=<px> picks the page and its
// size. The tests read the panel's state through window.harness.

import { PerspectiveCamera, Scene, WebGLRenderer } from "three"
import { HtmlPanel, PanelPointer } from "../../src/index"

/** The canvas is this wide (CSS px); its height follows the page's shape. */
const CANVAS_WIDTH = 800
const FOV = 50

const params = new URLSearchParams(location.search)
const page = params.get("page") ?? "reader"
const width = Number(params.get("width") ?? 720)
const height = Number(params.get("height") ?? 720)

const renderer = new WebGLRenderer({ antialias: false })
renderer.setPixelRatio(1)
renderer.setSize(CANVAS_WIDTH, Math.round((CANVAS_WIDTH * height) / width))
document.body.appendChild(renderer.domElement)

const scene = new Scene()
const camera = new PerspectiveCamera(FOV, width / height, 0.01, 10)
// A panel 1 unit high fills the view from this distance.
camera.position.set(0, 0, 0.5 / Math.tan((FOV * Math.PI) / 360))

const panel = new HtmlPanel({
  url: new URL(`panels/${page}/`, import.meta.env.VITE_PANEL_ORIGIN || location.href),
  width,
  height,
  size: width / height,
  sandbox: true
})
scene.add(panel)
new PanelPointer(camera, renderer.domElement, () => [panel])

// Frames the page has sent (the renderer is private; the tests only count its frames).
let frames = 0
const frameRenderer = (panel as unknown as { renderer: { submit: (frame: unknown) => void } }).renderer
const submit = frameRenderer.submit.bind(frameRenderer)
frameRenderer.submit = frame => {
  frames++
  submit(frame)
}

const gl = renderer.getContext()

const harness = {
  panel,
  /** Screen (CSS px of the canvas) per page CSS px. */
  scale: CANVAS_WIDTH / width,
  get frames() {
    return frames
  },
  /** The color drawn at a point of the page (its CSS px): rendered and read at once. */
  pixel(x: number, y: number): [number, number, number] {
    renderer.render(scene, camera)
    const data = new Uint8Array(4)
    const canvasX = Math.round(x * harness.scale)
    const canvasY = renderer.domElement.height - 1 - Math.round(y * harness.scale)
    gl.readPixels(canvasX, canvasY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
    return [data[0]!, data[1]!, data[2]!]
  }
}
;(window as unknown as { harness: typeof harness }).harness = harness

renderer.setAnimationLoop(() => renderer.render(scene, camera))
