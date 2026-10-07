# three-html-panel

A proof of concept for placing **an existing web page, scripts included, as an interactive panel in a three.js scene**.

- The page is loaded into a same-origin `<iframe>`, so it keeps its own document, URL and globals. A SPA with its own router and CSS works unchanged and does not clash with the host.
- The host reads the iframe's document directly, copies it into an SVG `<foreignObject>`, decodes that as an image and draws it into a canvas texture.
- Raycasts, wheel and keyboard input are replayed in the page as DOM events.

```
 host page (three.js)                                   same-origin iframe
┌──────────────────────────────────────────┐          ┌──────────────────────┐
│ PanelPointer  ─ raycast → uv ─┐           │          │                      │
│ PanelKeyboard ─ hidden field ─┤           │  events  │   your page (SPA)    │
│                               ▼           │ ───────▶ │                      │
│ HtmlPanel ── PageCapture ── InputSynthesizer          │                      │
│                  │   snapshot DOM + CSS ◀─┼──────────┤  contentDocument     │
│                  ▼                        │          │                      │
│ FrameRenderer: SVG → <img> → CanvasTexture│          └──────────────────────┘
└──────────────────────────────────────────┘
```

**Only show pages you trust.** A same-origin page runs with the host's privileges: it can read the host's cookies and storage and call into the host (the controls demo does exactly that, on purpose). Choose panel URLs in code; never take them from user input or synced state.

## Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The demo shows two pages:

- `panels/notes/`: a sticky-note board (drag, double-click, typing, hover, a CSS animation, scrolling). It is an ordinary page with no knowledge of the panel.
- `panels/controls/`: a form that drives the 3D object next to it (shape, color, spin, caption), and counts clicks on the object. It talks to the scene through events on `window.parent`, which only works because it is trusted and same-origin.

Tested in desktop Chrome. Other browsers and touch/VR input have not been checked.

## Use

```ts
import { HtmlPanel, PanelPointer } from "./src"

const panel = new HtmlPanel({ url: "/panels/notes/", width: 960, height: 640, size: 1.6 })
scene.add(panel)
new PanelPointer(camera, renderer.domElement, () => [panel])
```

The URL must be on the host's origin; a cross-origin document cannot be read.

## How it works

| Problem | Approach | Where |
|---|---|---|
| WebGL cannot display HTML | Copy the DOM into SVG `<foreignObject>`, decode it as an image, draw it into a canvas | `capture/snapshot.ts`, `frame-renderer.ts` |
| The image does not see the page's CSS | Collect all rules; keep only matching `@media`; re-fetch cross-origin stylesheets with CORS | `capture/css.ts` |
| `:hover`, `:focus` never match in an image | Mark elements with attributes and rewrite the selectors | `capture/css.ts`, `capture/snapshot.ts` |
| Form state, scroll position are not in the markup | Copy `value`/`checked`, shift children of scrolled boxes | `capture/snapshot.ts` |
| CSS animations restart at 0s on every decode | Stop them in the image and bake the current values into inline styles | `capture/snapshot.ts` |
| Images inside the SVG are not loaded | Inline them as data URLs | `capture/images.ts` |
| The iframe is another realm | Type checks and event constructors come from the iframe's `window` | throughout |
| Synthetic events lack default actions | Hover/enter/leave, pointer capture, click vs drag, dblclick, wheel scroll, text editing | `input/input.ts` |
| Focus in an iframe is lost whenever the host takes focus back | Virtual focus: `focus()`, `blur()`, `document.activeElement` are replaced in the page; keys go through a hidden field in the host | `input/input.ts`, `panel-keyboard.ts` |
| No caret is drawn in an image | Measure it with a mirror element; draw a thin plane over the panel | `input/caret.ts`, `html-panel.ts` |
| Iframes off screen are throttled, and `requestAnimationFrame` can stall even on screen | Keep the iframe in the viewport, transparent and behind the canvas; schedule captures with timers | `html-panel.ts`, `capture/page-capture.ts` |
| Heavy pages | Space captures so they take about 25% of the time | `capture/pacer.ts` |

## Limitations

- Only what CSS and the DOM describe is drawn: no `<video>`, no cross-origin iframes inside the page, no native widgets such as `<select>` popups, and `::before`/`::after` animations stay frozen.
- Text inside a scroll container that is not wrapped in an element does not scroll.
- No IME composition preview: the text appears when composition ends.
- `contenteditable` editing is not implemented.
- Mobile soft keyboards and WebXR controllers are not wired up.
- The page's scripts and the capture run on the host's main thread.
- [HTML-in-Canvas](https://github.com/WICG/html-in-canvas) would remove most of the copying once browsers ship it.

## Scripts

```bash
pnpm dev        # demo
pnpm test       # unit tests (Vitest, jsdom)
pnpm typecheck
pnpm build
```

## License

MIT
