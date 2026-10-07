# three-html-panel

A proof of concept for placing **an existing web page, scripts included, as an interactive panel in a three.js scene**, even when the page is on another origin.

- The page is loaded into an `<iframe>`, so it keeps its own document, URL and globals. A SPA with its own router and CSS works unchanged and does not clash with the host.
- A small script in the page, the **agent**, copies the DOM into an SVG `<foreignObject>` and posts it to the host, which decodes it as an image and draws it into a canvas texture.
- The host posts raycasts, wheel and keyboard input to the agent, which replays them in the page as DOM events.
- The host never reads the iframe's document. Any page that loads the agent can be shown, on any origin.

```
 host page (three.js)                                     panel page (any origin)
┌───────────────────────────────────────────┐          ┌────────────────────────────┐
│ PanelPointer  ─ raycast → uv ─┐            │  input   │ agent                      │
│ PanelKeyboard ─ hidden field ─┤            │ ───────▶ │  InputSynthesizer → events │
│                               ▼            │          │                            │
│ HtmlPanel ── PanelConnection (MessagePort) │  frames  │  PageCapture: DOM + CSS    │
│                  │                         │ ◀─────── │  → SVG                     │
│                  ▼                         │          │                            │
│ FrameRenderer: SVG → <img> → CanvasTexture │          │ your page (SPA)            │
└───────────────────────────────────────────┘          └────────────────────────────┘
```

**Only show pages you trust.** The iframe is not sandboxed, so the page runs as an ordinary page of its origin (and a same-origin page with the host's privileges). The host does check everything the agent sends: messages are accepted only from the panel's iframe on the panel URL's origin, through a private `MessagePort`, and frames and carets are bounded in size and validated. Choose panel URLs in code; never take them from user input or synced state.

## Run

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts two servers:

- http://localhost:5173: the 3D scene. Open this one.
- http://localhost:5174: the panel pages, on purpose another origin. It adds the agent to every page under `panels/` (`vite.panels.config.ts`).

The ports come from `.env.development`. The demo shows two pages:

- `panels/notes/`: a sticky-note board (drag, double-click, typing, hover, a CSS animation, scrolling). It is an ordinary page with no knowledge of the panel.
- `panels/controls/`: a form that drives the 3D object next to it (shape, color, spin, caption), and counts clicks on the object. Being on another origin, it cannot reach the scene's window; it uses the agent's app messages (see below).

`pnpm build` puts everything on one origin instead (`pnpm preview`, http://localhost:4173); the agent works the same way there.

Tested in desktop Chrome. Other browsers and touch/VR input have not been checked.

## Use

On the host:

```ts
import { HtmlPanel, PanelPointer } from "./src"

const panel = new HtmlPanel({ url: "https://panels.example/notes/", width: 960, height: 640, size: 1.6 })
scene.add(panel)
new PanelPointer(camera, renderer.domElement, () => [panel])
```

If the page's agent does not connect within 15 seconds (`readyTimeout`), the panel is cleared and `onError` is called.

### Adding the agent to a page

The page loads the agent **before its own scripts**, and names the host's origin. The agent posts nothing anywhere else; without a valid `data-host-origin` (an exact origin, not `*`) it does not start.

Written by the page's author:

```html
<head>
  <script type="module" src="https://panels.example/agent.js" data-host-origin="https://host.example"></script>
  ...
</head>
```

Added by the server, which is what the demo does: `injectPanelAgent()` in `vite.panels.config.ts` puts the same tag first in `<head>` of every page it serves. This suits pages that should not change at all (the notes board), or a proxy in front of an existing site. Either way, the agent has to come before the page's scripts, because it replaces `focus()`, `blur()`, `document.activeElement` and pointer capture, and the page should only ever see the replacements. Module scripts run in document order, so first in `<head>` is enough for module pages; a classic `<script>` earlier in the page would still run before it.

`pnpm build` emits the agent as `dist/agent.js`.

### App messages

Pages that know about the host can exchange data with it through the agent. The data must be structured-cloneable, and the host should treat it as untrusted input:

```ts
// In the page
import { onHostMessage, sendToHost } from "./src/agent/page"
sendToHost({ color: "#3b82f6" })
onHostMessage(data => console.log("from the host", data))

// On the host
const panel = new HtmlPanel({ url, onMessage: data => { /* check data, then use it */ } })
panel.postMessage("scene-click")
```

`sendToHost` and `onHostMessage` are plain events on the page's window, so a page using them still runs without the agent. The controls demo used to call into `window.parent` directly; that only works on the same origin, so it now uses these messages, and the scene validates them (`parseSceneControl`).

### Protocol

1. The agent posts `{ type: "ready", version }` to `window.parent`, addressed to the host origin.
2. The host accepts it only if `event.source` is the panel's iframe and `event.origin` is the panel URL's origin, creates a `MessageChannel`, and posts `{ type: "connect", version }` with one port to the iframe, addressed to that origin.
3. From then on, only the port is used: `frame` (seq, width, height, svg) and `editing` (editing, caret) from the page; `pointer`, `wheel`, `key`, `text`, `blur` from the host; `app` both ways.

Every document the iframe loads (a reload, a navigation) says `ready` again and gets a new port; the old one is closed. The host drops frames whose `seq` does not grow, whose size differs from the iframe's or exceeds 4096 px, or whose SVG is over 16 MB, and carets that are not finite numbers with a short color string. See `src/protocol.ts`.

## How it works

Paths are under `src/`; the agent's are under `src/agent/`.

| Problem | Approach | Where |
|---|---|---|
| The host cannot read a cross-origin page | An agent in the page captures it and talks to the host over a `MessagePort` | `agent/agent.ts`, `panel-connection.ts`, `protocol.ts` |
| WebGL cannot display HTML | Copy the DOM into SVG `<foreignObject>`, decode it as an image, draw it into a canvas | `agent/capture/snapshot.ts`, `frame-renderer.ts` |
| The image does not see the page's CSS | Collect all rules; keep only matching `@media`; re-fetch cross-origin stylesheets with CORS (with `Accept: text/css`, or Vite's dev server answers with JS) | `agent/capture/css.ts` |
| `:hover`, `:focus` never match in an image | Mark elements with attributes and rewrite the selectors | `agent/capture/css.ts`, `agent/capture/snapshot.ts` |
| Form state, scroll position are not in the markup | Copy `value`/`checked`, shift children of scrolled boxes | `agent/capture/snapshot.ts` |
| CSS animations restart at 0s on every decode | Stop them in the image and bake the current values into inline styles | `agent/capture/snapshot.ts` |
| Images inside the SVG are not loaded | Inline them as data URLs | `agent/capture/images.ts` |
| Synthetic events lack default actions | Hover/enter/leave, pointer capture, click vs drag, dblclick, wheel scroll, text editing | `agent/input/input.ts` |
| Focus in an iframe is lost whenever the host takes focus back | Virtual focus: `focus()`, `blur()`, `document.activeElement` are replaced in the page; keys go through a hidden field in the host | `agent/input/input.ts`, `panel-keyboard.ts` |
| No caret is drawn in an image | Measure it with a mirror element; draw a thin plane over the panel | `agent/input/caret.ts`, `html-panel.ts` |
| Iframes off screen are throttled, and `requestAnimationFrame` can stall even on screen | Keep the iframe in the viewport, transparent and behind the canvas; schedule captures with timers | `html-panel.ts`, `agent/capture/page-capture.ts` |
| Heavy pages | Space captures so they take about 25% of the time | `agent/capture/pacer.ts` |

## Limitations

- The page has to load the agent; pages you cannot change need a server or proxy that adds it.
- Chrome can still hold back the page's animation clock for up to about a second (the iframe is transparent and behind the canvas), so a CSS animation sometimes starts late. This happened with the same-origin version too.
- Only what CSS and the DOM describe is drawn: no `<video>`, no cross-origin iframes inside the page, no native widgets such as `<select>` popups, and `::before`/`::after` animations stay frozen.
- Text inside a scroll container that is not wrapped in an element does not scroll.
- No IME composition preview: the text appears when composition ends.
- `contenteditable` editing is not implemented.
- Mobile soft keyboards and WebXR controllers are not wired up.
- A same-site page's scripts and the capture share the host's main thread; a cross-site page usually runs in its own process.
- [HTML-in-Canvas](https://github.com/WICG/html-in-canvas) would remove most of the copying once browsers ship it.

## Scripts

```bash
pnpm dev        # demo: scene on :5173, panel pages on :5174
pnpm test       # unit tests (Vitest, jsdom)
pnpm typecheck
pnpm build
```

## License

MIT
