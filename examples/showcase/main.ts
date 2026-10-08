import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { HtmlPanel, PanelPointer, PanelXRKeyboard, PanelXRPointer } from "../../src/index";
import { SCENE_CLICK, parseSceneControl, type SceneControl } from "./scene-events";

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
// A button to enter VR, only where the browser and a headset can (it would
// otherwise say "VR not supported" over the page).
void navigator.xr?.isSessionSupported("immersive-vr").then((supported) => {
  if (supported) document.body.appendChild(VRButton.createButton(renderer));
});

const scene = new Scene();
scene.background = new Color(0x1d2129);
const sun = new DirectionalLight(0xffffff, 2.5);
sun.position.set(2, 4, 3);
scene.add(new AmbientLight(0xffffff, 1.2), sun);
scene.add(new GridHelper(20, 20, 0x3a4150, 0x2a303b));

const camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 100);
camera.position.set(-0.35, 1.4, 3.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.35, 1.2, 0);
controls.enableDamping = true;
controls.update();

// The panel pages are served from another origin (VITE_PANEL_ORIGIN, see
// vite.config.ts); without one, next to the scene.
const panelBase: string = import.meta.env.VITE_PANEL_ORIGIN || location.href;
const pageUrl = (path: string) => new URL(path, panelBase);

// All pages run sandboxed (their server sends the same sandbox, see
// vite.panels.config.ts): none can reach the scene's cookies, storage or
// document, nor take its keyboard.
const notes = new HtmlPanel({
  url: pageUrl("examples/sites/notes/"),
  width: 960,
  height: 640,
  size: 1.6,
  sandbox: true,
});
notes.position.set(-0.75, 1.45, 0);
notes.rotation.y = 0.3;

const sceneControls = new HtmlPanel({
  url: pageUrl("examples/sites/controls/"),
  sandbox: true,
  width: 480,
  height: 640,
  size: 1.0,
  onMessage: (data) => {
    const control = parseSceneControl(data);
    if (control) applyControl(control);
  },
});
sceneControls.position.set(1.15, 1.4, 0.1);
sceneControls.rotation.y = -0.5;

// A page with text to select, drop-down lists, rich text editing and a video.
const reader = new HtmlPanel({
  url: pageUrl("examples/sites/reader/"),
  width: 720,
  height: 720,
  size: 1.1,
  sandbox: true,
});
reader.position.set(-2.25, 1.45, 0.45);
reader.rotation.y = 0.65;

const panels = [notes, sceneControls, reader];
scene.add(...panels);
new PanelPointer(camera, renderer.domElement, () => panels);

// In VR, each controller points at the panels with a ray; the trigger presses.
const xrPointer = new PanelXRPointer(renderer, () => panels);
// In VR, a keyboard shows under the panel whose text field has focus.
const xrKeyboard = new PanelXRKeyboard();
scene.add(xrKeyboard);
xrPointer.keyboard = xrKeyboard;
for (const index of [0, 1]) {
  const controller = renderer.xr.getController(index);
  const ray = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -5)]);
  controller.add(
    new Line(ray, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })),
  );
  scene.add(controller);
}

// The object the controls panel drives.
const geometries: Record<NonNullable<SceneControl["shape"]>, BufferGeometry> = {
  knot: new TorusKnotGeometry(0.16, 0.05, 160, 24),
  ico: new IcosahedronGeometry(0.22),
  box: new BoxGeometry(0.3, 0.3, 0.3),
};
const object = new Mesh<BufferGeometry, MeshStandardMaterial>(
  geometries.knot,
  new MeshStandardMaterial({ color: "#f59e0b", roughness: 0.35 }),
);
object.position.set(0.3, 0.55, 0.55);
scene.add(object);
let spin = true;

const caption = document.querySelector<HTMLElement>("#caption")!;

function applyControl(control: SceneControl): void {
  if (control.shape) object.geometry = geometries[control.shape];
  if (control.color) object.material.color.set(control.color);
  if (control.spin !== undefined) spin = control.spin;
  if (control.caption !== undefined) caption.textContent = control.caption;
}

// Clicking the object tells the controls page.
const raycaster = new Raycaster();
renderer.domElement.addEventListener("click", (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.intersectObject(object).length > 0) {
    sceneControls.postMessage(SCENE_CLICK);
  }
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const captionAnchor = new Vector3();
renderer.setAnimationLoop(() => {
  xrPointer.update();
  if (spin) object.rotation.y += 0.01;
  controls.update();
  renderer.render(scene, camera);
  // Keep the caption under the object.
  captionAnchor
    .copy(object.position)
    .setY(object.position.y - 0.3)
    .project(camera);
  caption.style.transform = `translate(${((captionAnchor.x + 1) / 2) * innerWidth}px, ${((1 - captionAnchor.y) / 2) * innerHeight}px) translate(-50%, 0)`;
});
