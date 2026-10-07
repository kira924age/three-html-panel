// Collects the page's CSS so that it can be embedded in the SVG snapshot.
//
// An SVG loaded as an image is rendered in its own, isolated document, so the
// page's stylesheets do not apply to it. They have to be copied in, with a few
// adjustments:
//
// - Interaction states (:hover, :active, :focus) depend on real input, which
//   the image never receives. The snapshot marks the elements with attributes
//   instead, and the selectors are rewritten to match those attributes.
// - :root would match the <svg>, not the copied <html>.
// - @media is evaluated again inside the image, against the image's own
//   environment. Only the rules that match in the page right now are kept.
// - Animations restart from 0s every time the image is decoded, so they are
//   stopped here. The snapshot bakes their current values into inline styles.

import type { FrameWindow } from "../../types"

export const HOVER_ATTRIBUTE = "data-thp-hover"
export const ACTIVE_ATTRIBUTE = "data-thp-active"
export const FOCUS_ATTRIBUTE = "data-thp-focus"
export const FOCUS_WITHIN_ATTRIBUTE = "data-thp-focus-within"

// A pseudo-class followed by something other than a name character, so that
// :focus does not also match :focus-visible.
const pseudoClass = (name: string) => new RegExp(`:${name}(?![-\\w])`, "g")

const SELECTOR_REWRITES: [RegExp, string][] = [
  [pseudoClass("root"), "html"],
  [pseudoClass("hover"), `[${HOVER_ATTRIBUTE}]`],
  [pseudoClass("active"), `[${ACTIVE_ATTRIBUTE}]`],
  [pseudoClass("focus-visible"), `[${FOCUS_ATTRIBUTE}]`],
  [pseudoClass("focus-within"), `[${FOCUS_WITHIN_ATTRIBUTE}]`],
  [pseudoClass("focus"), `[${FOCUS_ATTRIBUTE}]`]
]

export function rewriteSelector(selector: string): string {
  return SELECTOR_REWRITES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), selector)
}

// Browsers draw a focus ring for text fields from their own user agent
// stylesheet, which is not in document.styleSheets. This stands in for it with
// zero specificity, so any rule the page writes about the outline wins.
const DEFAULT_FOCUS_RING_CSS =
  `:where(input[${FOCUS_ATTRIBUTE}], textarea[${FOCUS_ATTRIBUTE}], select[${FOCUS_ATTRIBUTE}])` +
  `{outline:2px solid #3b82f6;outline-offset:1px}`

export const FREEZE_ANIMATIONS_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important}"

const URL_PATTERN = /url\(\s*(["']?)([^"')]+)\1\s*\)/g

/** Replaces url(...) references with what `resolve` returns (e.g. a data URL), or `none`. */
export function inlineCssUrls(css: string, baseUrl: string, resolve: (url: string) => string | null): string {
  return css.replace(URL_PATTERN, (_match, _quote: string, raw: string) => {
    if (raw.startsWith("data:")) return `url("${raw}")`
    let absolute: string
    try {
      absolute = new URL(raw, baseUrl).href
    } catch {
      return "none"
    }
    const inlined = resolve(absolute)
    return inlined ? `url("${inlined}")` : "none"
  })
}

/** Makes relative url() in a linked stylesheet absolute (they are relative to the stylesheet). */
function absolutizeUrls(css: string, sheetUrl: string): string {
  return css.replace(URL_PATTERN, (match, _quote: string, raw: string) => {
    if (raw.startsWith("data:")) return match
    try {
      return `url("${new URL(raw, sheetUrl).href}")`
    } catch {
      return "none"
    }
  })
}

function ruleCount(sheet: CSSStyleSheet): number {
  try {
    return sheet.cssRules.length
  } catch {
    return -1
  }
}

/**
 * Collects a document's CSS, recollecting only when the set of stylesheets or
 * the number of rules in them changes. Editing an existing rule in place
 * (CSSStyleRule.style) is not noticed; call invalidate() for that.
 */
export class DocumentCss {
  private signature = ""
  private css = ""
  /**
   * Cross-origin stylesheets (a web font service, say) hide their rules from
   * script unless they were loaded with CORS. They are fetched again with CORS
   * and parsed here, keyed by URL.
   */
  private readonly fetched = new Map<string, CSSStyleSheet | "loading" | "failed">()
  private readonly window: FrameWindow

  constructor(
    private readonly document: Document,
    private readonly resolveUrl: (url: string) => string | null,
    private readonly onChange: () => void = () => {}
  ) {
    this.window = document.defaultView as FrameWindow
  }

  invalidate(): void {
    this.signature = ""
  }

  get(): string {
    const sheets = Array.from(this.document.styleSheets)
    const signature = sheets.map(sheet => `${sheet.href ?? "inline"}:${ruleCount(sheet)}`).join("|")
    if (signature !== this.signature) {
      const parts: string[] = [DEFAULT_FOCUS_RING_CSS]
      for (const sheet of sheets) this.serializeSheet(sheet, parts)
      parts.push(FREEZE_ANIMATIONS_CSS)
      this.css = inlineCssUrls(parts.join("\n"), this.document.baseURI, this.resolveUrl)
      this.signature = signature
    }
    return this.css
  }

  private serializeSheet(source: CSSStyleSheet, out: string[]): void {
    if (source.disabled) return
    const sheet = this.readable(source)
    if (!sheet) return
    const start = out.length
    this.serializeRules(sheet.cssRules, out)
    if (source.href) {
      for (let i = start; i < out.length; i++) out[i] = absolutizeUrls(out[i]!, source.href)
    }
  }

  private serializeRules(rules: CSSRuleList, out: string[]): void {
    const { CSSStyleRule, CSSMediaRule, CSSSupportsRule, CSSImportRule, CSSKeyframesRule, CSS, matchMedia } =
      this.window
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        // Nested rules (CSS nesting) are serialized with the parent; rewrite the whole text then.
        out.push(
          rule.cssRules.length > 0
            ? rewriteSelector(rule.cssText)
            : `${rewriteSelector(rule.selectorText)}{${rule.style.cssText}}`
        )
      } else if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.conditionText).matches) this.serializeRules(rule.cssRules, out)
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) this.serializeRules(rule.cssRules, out)
      } else if (rule instanceof CSSImportRule) {
        const sheet = rule.styleSheet
        if (sheet && matchMedia(rule.media.mediaText || "all").matches) this.serializeSheet(sheet, out)
      } else if (rule instanceof CSSKeyframesRule) {
        // Animations are frozen, so keyframes are never used.
      } else {
        out.push(rule.cssText)
      }
    }
  }

  private readable(sheet: CSSStyleSheet): CSSStyleSheet | null {
    try {
      void sheet.cssRules
      return sheet
    } catch {
      if (!sheet.href) return null
    }
    const href = sheet.href
    const fetched = this.fetched.get(href)
    if (fetched instanceof this.window.CSSStyleSheet) return fetched
    if (!fetched) {
      this.fetched.set(href, "loading")
      fetch(href, { mode: "cors", credentials: "omit", headers: { Accept: "text/css,*/*;q=0.1" } })
        .then(response => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
        .then(text => {
          // Parse in the page's realm, so the rules pass the type checks above.
          const parsed = new this.window.CSSStyleSheet()
          // replaceSync ignores @import; enough for this purpose.
          parsed.replaceSync(text)
          this.fetched.set(href, parsed)
          this.invalidate()
          this.onChange()
        })
        .catch(() => this.fetched.set(href, "failed"))
    }
    return null
  }
}
