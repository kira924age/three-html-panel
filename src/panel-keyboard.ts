// Keyboard input for panels, and keeping focus away from the panel iframes.
//
// Keys are never typed into the iframe directly. A hidden <textarea> in the
// host page takes them (including IME composition and paste) and forwards them
// to the panel whose text field has focus. This works the same in every
// browser, and the iframe never needs to hold focus: when focus leaves an
// iframe, browsers blur the field focused inside it, so a field could not stay
// focused while the host keeps focus.
//
// Focus can still end up in an iframe (an element the browser focuses on its
// own, before the panel took over the page's focus handling). Whenever a panel
// iframe has focus, it is put back, so keys keep reaching the host.

export interface KeyboardTarget {
  sendKey(event: KeyboardEvent): void
  sendText(text: string): void
  /** Focus left the panel from the host side (the user clicked elsewhere). */
  blurFromHost(): void
}

/** Keys whose default action the panel reimplements (see input/input.ts); the rest arrive as text. */
const FORWARDED_KEYS = new Set([
  "Backspace",
  "Delete",
  "Enter",
  "Escape",
  "Tab",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown"
])
/** Shortcuts left to the browser so that they act on the hidden field (paste, mostly). */
const BROWSER_SHORTCUTS = new Set(["c", "v", "x", "z"])

export class PanelKeyboard {
  private readonly field = document.createElement("textarea")
  private readonly frames = new Set<HTMLIFrameElement>()
  private target: KeyboardTarget | null = null
  private lastHostFocus: HTMLElement | null = null

  constructor(container: HTMLElement = document.body) {
    const field = this.field
    field.setAttribute("aria-hidden", "true")
    field.tabIndex = -1
    field.autocomplete = "off"
    field.spellcheck = false
    field.setAttribute("autocapitalize", "off")
    Object.assign(field.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
      resize: "none"
    })
    container.appendChild(field)

    field.addEventListener("keydown", this.onKeyDown)
    field.addEventListener("input", event => {
      if (!(event as InputEvent).isComposing) this.flush()
    })
    field.addEventListener("compositionend", () => this.flush())
    field.addEventListener("blur", () => setTimeout(this.checkFocus, 0))

    document.addEventListener(
      "focusin",
      event => {
        const target = event.target
        if (target instanceof HTMLElement && target !== field && !this.frames.has(target as HTMLIFrameElement)) {
          this.lastHostFocus = target
        }
      },
      true
    )
    window.addEventListener("blur", () => setTimeout(this.checkFocus, 0))
  }

  /** Watches a panel iframe so that it never keeps focus. */
  register(frame: HTMLIFrameElement): void {
    this.frames.add(frame)
  }

  unregister(frame: HTMLIFrameElement): void {
    this.frames.delete(frame)
  }

  /** Starts sending keys to `target`. */
  focus(target: KeyboardTarget): void {
    this.target = target
    this.field.value = ""
    if (document.activeElement !== this.field) this.field.focus({ preventScroll: true })
  }

  /** Stops sending keys to `target`, if it is the current one. */
  release(target: KeyboardTarget): void {
    if (this.target !== target) return
    this.target = null
    if (document.activeElement === this.field) this.field.blur()
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.target || event.isComposing || event.keyCode === 229) return
    const shortcut = (event.ctrlKey || event.metaKey) && event.key.length === 1
    if (shortcut && BROWSER_SHORTCUTS.has(event.key.toLowerCase())) return
    if (FORWARDED_KEYS.has(event.key) || shortcut) {
      event.preventDefault()
      this.target.sendKey(event)
    }
  }

  private flush(): void {
    const text = this.field.value
    this.field.value = ""
    if (text && this.target) this.target.sendText(text)
  }

  private readonly checkFocus = () => {
    const active = document.activeElement
    if (active instanceof HTMLIFrameElement && this.frames.has(active)) {
      // A panel took focus: give it back. Never call blur() on the iframe:
      // that also blurs the element focused inside the page, which is how a
      // press on a panel's text field focuses it in the first place.
      if (!this.target && this.lastHostFocus?.isConnected) this.lastHostFocus.focus({ preventScroll: true })
      else this.field.focus({ preventScroll: true })
      return
    }
    if (!this.target || active === this.field) return
    if (!active || active === document.body) {
      // Focus is in transit (a panel iframe in another process takes it
      // asynchronously), or the user clicked something that cannot be focused.
      // Neither ends editing; pressing outside the panels in the scene does.
      if (document.hasFocus()) this.field.focus({ preventScroll: true })
      return
    }
    if (document.hasFocus()) {
      // The user moved focus to something else in the host (a chat box, say).
      const target = this.target
      this.target = null
      target.blurFromHost()
    }
  }
}

let shared: PanelKeyboard | null = null

/** One keyboard is enough for any number of panels. */
export function getSharedKeyboard(): PanelKeyboard {
  return (shared ??= new PanelKeyboard())
}
