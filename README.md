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

## Trust: `sandbox`

A panel is either trusted or not, and `HtmlPanel`'s `sandbox` option says which. Either way, the host checks the shape and size of everything the agent sends, and accepts it only through the `MessagePort` it handed to the panel's iframe.

**`sandbox: false` (the default): only show pages you trust.** The iframe is not sandboxed, so the page runs as an ordinary page of its origin. A page on the host's own origin runs with the host's privileges: it can read the host's cookies and storage and reach into the host's document. This is not forbidden (`pnpm build` could serve the demo from one origin), but choose such URLs in code; never take them from user input or synced state.

**`sandbox: true`: for pages you do not trust.** The iframe gets `sandbox="allow-scripts allow-forms allow-popups"`, before its `src` is set, and never `allow-same-origin` (with it, a page on the host's origin could reach into the host and remove its own sandbox) nor `allow-popups-to-escape-sandbox`; there is no way to add them. The page then runs on an opaque origin (`self.origin` is `"null"`): it cannot read the host's cookies, storage, tokens or document, and its own `document.cookie` and `localStorage` throw `SecurityError`. It also cannot take the keyboard:

- if the page moves real focus into its iframe (`window.focus()`, a label's click, …), the host gives it back at once to where it was, or else blurs the iframe;
- if the page focuses one of its text fields (or its agent claims so), the host only moves the keyboard to the panel within a second of the user pressing, releasing or dragging in that panel (selecting text by dragging can take a while); otherwise it tells the page to let go.

A page that keeps taking focus can still catch a key typed in the instant before focus is back (in our tests, with a page taking focus every 30 ms: about 1 key in 60 lost in Chrome, none in Playwright's Firefox and WebKit builds). The host cannot stop a page from trying.

With a sandbox, the host can only tell which iframe a message comes from, not which page: any document in that iframe, including one the page navigated to on its own, can act as the panel. So send through the port only what any page in that iframe may see (the input the user gives that panel, and app messages meant for it), and treat everything that comes back as untrusted (`onMessage` data included).

### Serving sandboxed pages

- Send the same sandbox with the page: `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups`. The iframe's attribute only holds inside this host; the header also holds when the page is opened directly or embedded elsewhere.
- From a sandboxed page, its own scripts (module scripts are fetched with CORS), CSS, images and API are on another origin, `null`. Answer them with `Access-Control-Allow-Origin` (`*` for public files, or `null`); the agent also needs it to fetch the page's CSS and images again. Anything any sandboxed page may read, any site may read, so keep private data out of such responses.

The demo's panel server does both (`vite.panels.config.ts`).

### Writing pages that run sandboxed

`localStorage`, `sessionStorage`, IndexedDB, cookies and `window.parent` are not available (they throw or are cross-origin). Keep state on the server, and talk to the host with `sendToHost` / `onHostMessage`.

## Run

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts two servers:

- http://localhost:5173: the 3D scene. Open this one.
- http://localhost:5174: the panel pages, on purpose another origin. It adds the agent to every page under `panels/` (`vite.panels.config.ts`).

These origins are the defaults (`originsFor` in `vite.panels.config.ts`). To change them, set `VITE_HOST_ORIGIN` and `VITE_PANEL_ORIGIN` in the environment or in an untracked `.env.development.local` (see `.env.example`); `.env` files are kept out of the repository. The demo shows three pages, all with `sandbox: true`:

- `panels/notes/`: a sticky-note board (drag, double-click, typing, hover, a CSS animation, scrolling). It is an ordinary page with no knowledge of the panel.
- `panels/controls/`: a form that drives the 3D object next to it (shape, color, spin, caption), and counts clicks on the object. Being on another origin, it cannot reach the scene's window; it uses the agent's app messages (see below).
- `panels/reader/`: text to select and copy, drop-down lists (`<select>`, with groups), a contenteditable box, and a video.

`pnpm build` then `pnpm preview` serves the build the same way: the scene on http://localhost:4173, the panel pages on http://localhost:4174 (or `.env.production.local`).

Tested in desktop Chrome. On every pull request, `pnpm e2e` drives the notes and reader pages in Playwright's Chromium, Firefox and WebKit builds (headless): typing, dragging a note, selecting and copying text, the lists, editing, the caret, a video, and Japanese input (Chromium only). The pages run in a host page with one flat panel (`e2e/harness/`). Where the browser has no WebGL (headless Firefox on Linux), the panel is not drawn: the tests still press, type and check the page, and skip only what they would read from the drawn image (`E2E_NO_WEBGL=1 pnpm e2e` runs them that way anywhere). It starts the dev servers itself, or uses those of a running `pnpm dev`; install the browsers once with `pnpm exec playwright install`. See Limitations for WebKit. Touch and VR input were checked in emulation only.

## Use

On the host:

```ts
import { HtmlPanel, PanelPointer, PanelXRKeyboard, PanelXRPointer } from "./src"

const panel = new HtmlPanel({ url: "https://panels.example/notes/", width: 960, height: 640, size: 1.6, sandbox: true })
scene.add(panel)
new PanelPointer(camera, renderer.domElement, () => [panel])

// VR: controllers point at panels; call update() every frame.
renderer.xr.enabled = true
const xrPointer = new PanelXRPointer(renderer, () => [panel])
// A keyboard shows under a panel whose text field has focus (there is no system keyboard in VR).
xrPointer.keyboard = new PanelXRKeyboard()
scene.add(xrPointer.keyboard)
renderer.setAnimationLoop(() => {
  xrPointer.update()
  renderer.render(scene, camera)
})
```

If the page's agent does not connect within 15 seconds (`readyTimeout`), the panel is cleared and `onError` is called.

A panel that has not been drawn facing the camera for a second (out of view, seen from behind, `visible = false`, out of the scene) tells its page to stop capturing: an animation or a video playing in it costs nothing meanwhile, and frames that come anyway are kept, not drawn. The first time it is drawn facing the camera again, the page is captured as it is then; until that frame comes, the panel shows what it showed before. This relies on the scene being rendered in a loop, as above. Where a panel takes input without ever being rendered (no WebGL), pass `pauseWhenHidden: false`.

A panel drawn small (under a quarter of its page's size on screen, along its longer side, by every view that draws it for a quarter of a second: a minimap or a mirror drawing it small does not count while the main view draws it large) asks its page for a frame at most every 200 ms instead of as often as the page manages; drawn over 0.3 of its size by any view, for all of them again at once. A camera of a stereo pair (WebXR) is measured by its own viewport. Input to such a panel is answered at that pace too.

The panel's texture is drawn at its `pixelRatio`, or at a half or a quarter of it while every view draws the panel at no more than 0.8 of that (device pixels per page CSS pixel) for a quarter of a second: fewer pixels for the browser to draw and upload, and still at least as many as the screen shows. Drawn denser by any view, it goes back up at once, the last frame drawn again at the new resolution (it scales the picture meanwhile).

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

### Links

A link the user follows in a panel opens in a new tab of the host's browser, and so does a URL the page passes to `window.open()` (which then returns `null`). Inside the panel, a `target="_blank"` link would be blocked as a popup (the click is synthetic, so there is no user activation), and any other link would replace the page with one that has no agent, leaving the panel blank.

- Links the page cancels (`preventDefault`), links within the page (`#fragment`), `download` links and schemes other than http(s) are left to the page.
- The host opens only http(s) URLs, only within a second of the user pressing the panel or a key in it, and with `noopener,noreferrer`. A page cannot open tabs on its own, sandboxed or not.
- Pass `onLink: (url, panel) => …` to `HtmlPanel` to do something else, such as asking the user first.
- Navigation by script (`location.href = …`) still happens in the panel.

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
2. The host accepts it only if `event.source` is the panel's iframe (`iframe.contentWindow`) and `event.origin` is the panel URL's origin, or `"null"` with `sandbox: true`. It creates a `MessageChannel` and posts `{ type: "connect", version }` with one port to the iframe, addressed to the panel URL's origin, or with `sandbox: true` to `"*"`: an opaque origin cannot be named. Posted to `contentWindow`, it still only reaches the document now in that iframe.
3. From then on, only the port is used: `frame` (seq, width, height, svg), `editing` (whether an element has focus or text is selected, a caret, the selected text, how many presses and releases the agent has handled, and whether the focused element takes text), `editables` (where the text fields and contenteditable elements are), `cursor` (a CSS cursor keyword) and `open` (a link to open) from the page; `pointer` (with `shiftKey`, `ctrlKey`, `metaKey`, and what drives it), `wheel`, `key`, `text`, `composition` (text being composed with an IME, and its caret), `blur` from the host; `app` both ways.
4. After every `load` of the iframe, the host sends `ping` and starts the timeout; the agent answers `pong`. Only the agent of the document now loaded can answer (an unloaded document's port is dead), so this tells whether the new document has an agent. The order of `ready` and `load` cannot tell: `ready` sometimes arrives after `load`.

Every document the iframe loads (a reload, a navigation) says `ready` again and gets a new port; the old one is closed. The host drops frames whose `seq` does not grow, whose size differs from the iframe's or exceeds 4096 px, or whose SVG is over 16 MB, carets that are not finite numbers with a short color string, and cursors that are not plain keywords (a `url()` cursor would have the host load whatever the page names). See `src/protocol.ts`.

## How it works

Paths are under `src/`; the agent's are under `src/agent/`.

| Problem | Approach | Where |
|---|---|---|
| The host cannot read a cross-origin page | An agent in the page captures it and talks to the host over a `MessagePort` | `agent/agent.ts`, `panel-connection.ts`, `protocol.ts` |
| WebGL cannot display HTML | Copy the DOM into SVG `<foreignObject>`, decode it as an image, draw it into a canvas | `agent/capture/snapshot.ts`, `frame-renderer.ts` |
| WebKit (Safari) misplaces `box-shadow` (a focus ring, a card's shadow) when `drawImage` scales an SVG image | Probe it once; where it happens, scale with `createImageBitmap`'s resize instead, which draws them right (not in Chrome, where that taints the canvas, nor in Firefox, where it is slower) | `frame-renderer.ts` |
| The image does not see the page's CSS | Collect all rules; keep only matching `@media`; re-fetch cross-origin stylesheets with CORS (with `Accept: text/css`, or Vite's dev server answers with JS) | `agent/capture/css.ts` |
| `:hover`, `:focus` never match in an image | Mark elements with attributes and rewrite the selectors | `agent/capture/css.ts`, `agent/capture/snapshot.ts` |
| Form state, scroll position are not in the markup | Copy `value`/`checked`, shift children of scrolled boxes | `agent/capture/snapshot.ts` |
| CSS animations restart at 0s on every decode, and stall when the browser holds back the iframe's rendering (up to a second in Chrome) | Stop them in the image; bake animations that end as they will end (a fill-forwards one's last keyframe), and only endless or paused ones as they are now | `agent/capture/snapshot.ts` |
| `requestAnimationFrame` stalls with the iframe's rendering | Replace it with a timer before the page's scripts run | `agent/animation-frames.ts` |
| Images inside the SVG are not loaded | Inline them as data URLs | `agent/capture/images.ts` |
| Synthetic events lack default actions | Hover/enter/leave, pointer capture, click vs drag, dblclick, wheel scroll | `agent/input/input.ts` |
| Synthetic keys do not edit text | Caret moves, Shift selection, words (`Intl.Segmenter`), visual lines for Up/Down, deletion, the platform's bindings (macOS: Option/Cmd and the Emacs keys; elsewhere: Ctrl) | `agent/input/editing.ts` |
| The browser's undo does not see the agent's edits | Keep an undo history per field (typing in a row is one step; dropped if the page changes the value itself) | `agent/input/history.ts` |
| Copy and cut need the clipboard, which only the host's field can reach | The agent reports the selected text (never a password's); on Cmd/Ctrl+C or X the host puts it in its hidden field and lets the browser copy or cut it, then the agent deletes a cut selection | `panel-keyboard.ts`, `agent/input/input.ts` |
| Tab, Space and arrows on controls have no default action | Tab moves focus in tab order (one stop per radio group); Space toggles checkboxes and presses buttons; arrows move through a radio group. Keys go to a panel while any element in it has focus, not only a text field | `agent/input/input.ts` |
| Synthetic presses do not select text | Drag to select; double press selects a word, triple a line; Shift extends. In text fields, by their selection range; elsewhere, by the page's own selection (`getSelection()`), where a triple press selects the paragraph, and not where `user-select` is `none` | `agent/input/input.ts`, `agent/input/selection.ts` |
| The page's selection is not in the image, and its `toString()` gives the source's white space when the page is not painted | Draw it over the copy, per text node, cut to what scrolled boxes show; for copying, build the text as it reads (white space collapsed as CSS does, a line break between blocks). Selected text takes the keys, so the copy shortcut reaches it | `agent/input/selection.ts`, `agent/capture/page-capture.ts` |
| Synthetic keys do not edit a contenteditable element, and rich text is hard to edit by hand | Let the browser edit: `Selection.modify()` moves the caret, `document.execCommand()` types, deletes, starts paragraphs, formats (Cmd/Ctrl+B, I, U) and undoes, at the page's selection, without the iframe having focus. A beforeinput the page can cancel goes first (WebKit's own is held back, so the page sees one); IME text is shown in place in the copy, underlined | `agent/input/contenteditable.ts`, `agent/input/input.ts`, `agent/capture/snapshot.ts` |
| A list box (`<select multiple>`, or with `size`) does not select on a synthetic press | A press selects the option under it, Shift a range from the last one pressed, Ctrl (Cmd on macOS) adds or removes one, a drag selects what it goes over; one change on release. The arrows (Shift extends), Home, End and Ctrl/Cmd+A work while it has focus. WebKit acts on synthetic presses and keys itself: where it changed the selection, the agent leaves it be. The copy is never focused, so the selected options are drawn over it as a focused list box's | `agent/input/list-box.ts`, `agent/input/input.ts`, `agent/capture/snapshot.ts` |
| A `<select>` opens its list outside the page, and not on a synthetic press | The agent keeps its own list: it opens on a press (unless the page cancels mousedown), with Space or Alt+Down; it is drawn over the copy, takes the pointer, the wheel, the arrows, Enter, Escape and typed letters, and sets the option with input and change. Closed, the arrows and typed letters change the option | `agent/input/select-popup.ts`, `agent/input/input.ts`, `agent/capture/snapshot.ts` |
| A `<video>` is not drawn in a foreignObject | Copy its current frame (or its poster before it plays) as an image, at most twice its size on the page, keeping its `object-fit`; capture continuously while it plays | `agent/capture/snapshot.ts`, `agent/capture/page-capture.ts` |
| A text field's selection and own scroll are not in the image | Draw the selection (the page's `::selection` color if set); leave out the text scrolled past and pad the rest into place | `agent/input/caret.ts`, `agent/capture/snapshot.ts` |
| Scrollbars in the image stay at the top and cannot be grabbed | Hide them; draw the agent's own from the scroll position; drag the thumb, page by pressing (and holding) the track | `agent/input/scrollbars.ts`, `agent/input/input.ts` |
| Synthetic touches do not scroll | A finger (or VR controller) drag scrolls what touch-action allows, after an 8px slop, sending the page pointercancel as browsers do; a mouse drag does not | `agent/input/pan.ts`, `agent/input/input.ts` |
| iOS opens the soft keyboard only for focus moved during a touch's handling | The agent reports where its text fields are; on a touchend over one, the host focuses its hidden field right then (and cancels the touchend, so the following mouse events do not take focus back). The field keeps 16px text and its corner, so iOS neither zooms nor scrolls the scene | `panel-pointer.ts`, `html-panel.ts`, `panel-keyboard.ts` |
| Soft keyboards send Backspace and Enter without a key | Take them from beforeinput | `panel-keyboard.ts` |
| Phones are slow to draw pages at 2x | Default to 1x on phones (coarse pointer, small screen) | `html-panel.ts` |
| VR controllers | Ray from each controller: hover, the trigger presses, a drag scrolls, the thumbstick scrolls like a wheel | `panel-xr-pointer.ts` |
| An immersive session shows no system keyboard | A keyboard mesh (letters, digits, symbols, Shift, Backspace, Enter, arrows, Done) shows under the panel whose text field or editable has focus (`HtmlPanel.isTyping`); the controllers press its keys, which go to the panel as text and keys | `panel-xr-keyboard.ts`, `panel-xr-pointer.ts` |
| The host's cursor does not follow the page | The agent reports the cursor under the pointer (the text cursor over text, too); the host sets it on the canvas | `agent/input/input.ts`, `panel-pointer.ts` |
| Focus in an iframe is lost whenever the host takes focus back | Virtual focus: `focus()`, `blur()`, `document.activeElement` are replaced in the page; keys go through a hidden field in the host | `agent/input/input.ts`, `panel-keyboard.ts` |
| No caret is drawn in an image | Measure it with a mirror element; draw a thin plane over the panel | `agent/input/caret.ts`, `html-panel.ts` |
| IME composition happens in the host's hidden field, not in the page | Send the composed text to the agent, which shows it in the image only (never in the page's value), underlined, with the caret in it; move the hidden field to the caret on screen, so the candidate window opens beside it. In a contenteditable element, the caret is placed by laying the composed text out from where it starts, wrapping at the end of the block's line | `panel-keyboard.ts`, `html-panel.ts`, `agent/capture/snapshot.ts`, `agent/input/selection.ts` |
| A selection stays when the window loses focus, greyed | When the host takes the keys back, the page's selection stays, drawn grey, and no longer takes the keys, until the user presses, drags or types in the panel again (hovering and the wheel do not count). A selection the page's script made is drawn grey too | `agent/input/input.ts`, `agent/capture/snapshot.ts` |
| Iframes off screen are throttled, and `requestAnimationFrame` can stall even on screen | Keep the iframe in the viewport, transparent and behind the canvas; schedule captures with timers | `html-panel.ts`, `agent/capture/page-capture.ts` |
| Heavy pages | Space captures so they take about 25% of the time | `agent/capture/pacer.ts` |

## Limitations

- The page has to load the agent; pages you cannot change need a server or proxy that adds it.
- A CSS animation or transition that ends is shown at its end right away, without its motion: the iframe's animation clock can stall for up to a second in Chrome, and showing its progress would keep a fade-in transparent that long. Endless animations are shown as the clock has them.
- Only what CSS and the DOM describe is drawn: no cross-origin iframes inside the page, no native widgets other than the drop-down list of `<select>` (no date pickers, no video controls: a page needs its own buttons for a video), and `::before`/`::after` animations stay frozen.
- A video from another origin without CORS cannot be read: only its poster is shown. Each frame of a playing video is a JPEG in the SVG, so large videos are slow.
- Editing a contenteditable element relies on the browser's `execCommand()`. Rich text editors that handle beforeinput themselves (cancelling it) work through it; those that read the browser's native editing in other ways may not. Dragging text, and selecting by dragging past a scrolled box's edge (autoscroll), are not implemented.
- A scrolled list box is drawn from its first row in view; in WebKit, which does not move options, a row scrolled partly out still shows whole (up to a row lower than it is). An `<optgroup>`'s label stays drawn when it is scrolled out with its first options.
- While composing in a contenteditable element, the caret (and so the IME's candidate window) is placed by wrapping the composed text between any two characters, as Japanese wraps; Latin words, which wrap whole, may leave it a little off.
- Text inside a scroll container that is not wrapped in an element does not scroll.
- A text field scrolled by part of a line leaves that line out of the image until it is scrolled fully into view.
- Phones, tablets and VR were tried in Chrome's and WebKit's touch emulation and in unit tests only, not on real devices or headsets. In particular, whether iOS opens its keyboard on a tap, and how controllers feel in a headset, are untested.
- The VR keyboard types letters, digits and common symbols: no IME (no Japanese input in VR), no copy and paste.
- A tap on a text field covered by another element of the page opens the soft keyboard for a moment: the host only knows where the fields are, and lets the keyboard go when the page answers that nothing took focus.
- A same-site page's scripts and the capture share the host's main thread; a cross-site page usually runs in its own process.
- [HTML-in-Canvas](https://github.com/WICG/html-in-canvas) would remove most of the copying once browsers ship it.

## Scripts

```bash
pnpm dev        # demo: scene on :5173, panel pages on :5174
pnpm test       # unit tests (Vitest, jsdom)
pnpm e2e        # end-to-end tests: the panel pages in Chromium, Firefox and WebKit (Playwright)
pnpm typecheck
pnpm build
```

## License

MIT
