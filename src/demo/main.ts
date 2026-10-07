import {
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { HtmlPanel, PanelPointer } from "../index"
import { SCENE_CLICK, parseSceneControl, type SceneControl } from "./scene-events"

const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new Scene()
scene.background = new Color(0x1d2129)
const sun = new DirectionalLight(0xffffff, 2.5)
sun.position.set(2, 4, 3)
scene.add(new AmbientLight(0xffffff, 1.2), sun)
scene.add(new GridHelper(20, 20, 0x3a4150, 0x2a303b))

const camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 100)
camera.position.set(0, 1.4, 2.8)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0.15, 1.2, 0)
controls.enableDamping = true
controls.update()

// The panel pages are served from another origin in development (see
// vite.panels.config.ts), and next to the scene in a build.
const panelBase: string = import.meta.env.VITE_PANEL_ORIGIN || location.href
const pageUrl = (path: string) => new URL(path, panelBase)

const notes = new HtmlPanel({ url: pageUrl("panels/notes/"), width: 960, height: 640, size: 1.6 })
notes.position.set(-0.75, 1.45, 0)
notes.rotation.y = 0.3

const sceneControls = new HtmlPanel({
  url: pageUrl("panels/controls/"),
  width: 480,
  height: 640,
  size: 1.0,
  onMessage: data => {
    const control = parseSceneControl(data)
    if (control) applyControl(control)
  }
})
sceneControls.position.set(1.15, 1.4, 0.1)
sceneControls.rotation.y = -0.5

const panels = [notes, sceneControls]
scene.add(...panels)
new PanelPointer(camera, renderer.domElement, () => panels)

// The object the controls panel drives.
const geometries: Record<NonNullable<SceneControl["shape"]>, BufferGeometry> = {
  knot: new TorusKnotGeometry(0.16, 0.05, 160, 24),
  ico: new IcosahedronGeometry(0.22),
  box: new BoxGeometry(0.3, 0.3, 0.3)
}
const object = new Mesh<BufferGeometry, MeshStandardMaterial>(geometries.knot, new MeshStandardMaterial({ color: "#f59e0b", roughness: 0.35 }))
object.position.set(0.3, 0.55, 0.55)
scene.add(object)
let spin = true

const caption = document.querySelector<HTMLElement>("#caption")!

function applyControl(control: SceneControl): void {
  if (control.shape) object.geometry = geometries[control.shape]
  if (control.color) object.material.color.set(control.color)
  if (control.spin !== undefined) spin = control.spin
  if (control.caption !== undefined) caption.textContent = control.caption
}

// Clicking the object tells the controls page.
const raycaster = new Raycaster()
renderer.domElement.addEventListener("click", event => {
  const rect = renderer.domElement.getBoundingClientRect()
  const ndc = new Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  )
  raycaster.setFromCamera(ndc, camera)
  if (raycaster.intersectObject(object).length > 0) {
    sceneControls.postMessage(SCENE_CLICK)
  }
})

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const captionAnchor = new Vector3()
renderer.setAnimationLoop(() => {
  if (spin) object.rotation.y += 0.01
  controls.update()
  renderer.render(scene, camera)
  // Keep the caption under the object.
  captionAnchor.copy(object.position).setY(object.position.y - 0.3).project(camera)
  caption.style.transform = `translate(${((captionAnchor.x + 1) / 2) * innerWidth}px, ${((1 - captionAnchor.y) / 2) * innerHeight}px) translate(-50%, 0)`
})
