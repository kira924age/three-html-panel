// Collects the page's CSS so that it can be embedded in the SVG snapshot.
//
// An SVG loaded as an image is rendered in its own, isolated document, so the
// page's stylesheets do not apply to it. They have to be copied in, with a few
// adjustments:
//
// - Interaction states (:hover, :active, :focus) depend on real input, which
//   the image never receives. The agent marks the elements with attributes
//   instead (interaction-marks.ts), and the selectors are rewritten to match
//   those attributes, as for the live page (live-css.ts, which has rewritten
//   most of them in place already).
// - :root would match the <svg>, not the copied <html>.
// - @media is evaluated again inside the image, against the image's own
//   environment. Only the rules that match in the page right now are kept.
// - Animations restart from 0s every time the image is decoded, so they are
//   stopped here. The snapshot bakes their values into inline styles.

import type { FrameWindow } from "../../types";

export const HOVER_ATTRIBUTE = "data-thp-hover";
export const ACTIVE_ATTRIBUTE = "data-thp-active";
export const FOCUS_ATTRIBUTE = "data-thp-focus";
export const FOCUS_WITHIN_ATTRIBUTE = "data-thp-focus-within";

const INTERACTION_ATTRIBUTE_OF: Record<string, string> = {
  hover: HOVER_ATTRIBUTE,
  active: ACTIVE_ATTRIBUTE,
  "focus-visible": FOCUS_ATTRIBUTE,
  "focus-within": FOCUS_WITHIN_ATTRIBUTE,
  focus: FOCUS_ATTRIBUTE,
};

export const INTERACTION_ATTRIBUTES: ReadonlySet<string> = new Set(
  Object.values(INTERACTION_ATTRIBUTE_OF),
);

// A pseudo-class followed by something other than a name character, so that
// :focus does not also match :focus-visible.
const INTERACTION_PSEUDO_CLASS = /:(hover|active|focus-visible|focus-within|focus)(?![-\w])/g;
const ROOT_PSEUDO_CLASS = /:root(?![-\w])/g;

/**
 * Whether the compound selector that ends at `end` has a pseudo-element in it
 * (`::-webkit-scrollbar-thumb:hover`, `::part(x):hover`). Only a few
 * pseudo-classes may follow one, not an attribute: those are left alone.
 */
function followsPseudoElement(selector: string, end: number): boolean {
  let depth = 0;
  for (let i = end - 1; i >= 0; i--) {
    const char = selector[i]!;
    if (char === ")" || char === "]") depth++;
    else if (char === "(" || char === "[") {
      if (depth === 0) return false;
      depth--;
    } else if (depth === 0) {
      if (char === ":" && selector[i - 1] === ":") return true;
      if (/[\s>+~,]/.test(char)) return false;
    }
  }
  return false;
}

/** Replaces the interaction pseudo-classes, but those that follow a pseudo-element. */
function replaceInteractionPseudoClasses(
  selector: string,
  replace: (match: string, attribute: string) => string,
): string {
  return selector.replace(INTERACTION_PSEUDO_CLASS, (match, name: string, offset: number) =>
    followsPseudoElement(selector, offset)
      ? match
      : replace(match, INTERACTION_ATTRIBUTE_OF[name]!),
  );
}

/**
 * The selector for the live page: each interaction pseudo-class also matches
 * its attribute, `:hover` becoming `:is(:hover,[data-thp-hover])`. The
 * specificity stays the same, and so does the rule's place in the cascade.
 * Null if it has none, or was rewritten already.
 */
export function liveSelector(selector: string): string | null {
  if (selector.includes("[data-thp-")) return null;
  const rewritten = replaceInteractionPseudoClasses(
    selector,
    (match, attribute) => `:is(${match},[${attribute}])`,
  );
  return rewritten === selector ? null : rewritten;
}

/**
 * The selector (or a nested rule's text) for the image: as for the live page
 * (:hover never matches in an image, the attribute does), and :root is html.
 */
export function rewriteSelector(selector: string): string {
  const rooted = selector.replace(ROOT_PSEUDO_CLASS, "html");
  return liveSelector(rooted) ?? rooted;
}

// Browsers draw a focus ring for text fields from their own user agent
// stylesheet, which is not in document.styleSheets. This stands in for it with
// zero specificity, so any rule the page writes about the outline wins.
const DEFAULT_FOCUS_RING_CSS =
  `:where(input[${FOCUS_ATTRIBUTE}], textarea[${FOCUS_ATTRIBUTE}], select[${FOCUS_ATTRIBUTE}])` +
  `{outline:2px solid #3b82f6;outline-offset:1px}`;

export const FREEZE_ANIMATIONS_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important}";

const URL_PATTERN = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/** Replaces url(...) references with what `resolve` returns (e.g. a data URL), or `none`. */
export function inlineCssUrls(
  css: string,
  baseUrl: string,
  resolve: (url: string) => string | null,
): string {
  return css.replace(URL_PATTERN, (_match, _quote: string, raw: string) => {
    if (raw.startsWith("data:")) return `url("${raw}")`;
    let absolute: string;
    try {
      absolute = new URL(raw, baseUrl).href;
    } catch {
      return "none";
    }
    const inlined = resolve(absolute);
    return inlined ? `url("${inlined}")` : "none";
  });
}

/** Makes relative url() in a linked stylesheet absolute (they are relative to the stylesheet). */
export function absolutizeUrls(css: string, sheetUrl: string): string {
  return css.replace(URL_PATTERN, (match, _quote: string, raw: string) => {
    if (raw.startsWith("data:")) return match;
    try {
      return `url("${new URL(raw, sheetUrl).href}")`;
    } catch {
      return "none";
    }
  });
}

/**
 * Stylesheets whose rules the page's script may not read (cross-origin,
 * without CORS). That does not change, and finding out throws: checked once.
 * A sheet still loading throws too (InvalidAccessError), but not for good.
 */
const unreadable = new WeakSet<CSSStyleSheet>();

/** How many rules a stylesheet has, or -1 if they cannot be read. */
export function ruleCount(sheet: CSSStyleSheet): number {
  if (unreadable.has(sheet)) return -1;
  try {
    return sheet.cssRules.length;
  } catch (error) {
    if ((error as Error).name === "SecurityError") unreadable.add(sheet);
    return -1;
  }
}

const sheetIds = new WeakMap<CSSStyleSheet, number>();
let nextSheetId = 0;

/** The agent's own sheets in document.adoptedStyleSheets (live-css.ts): not the page's. */
export const agentSheets = new WeakSet<CSSStyleSheet>();

/** The page's stylesheets, in cascade order: its <style> and <link> sheets, then those it adopted. */
export function pageStylesheets(document: Document): CSSStyleSheet[] {
  const adopted = (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets;
  const sheets = Array.from(document.styleSheets);
  return adopted ? [...sheets, ...adopted.filter((sheet) => !agentSheets.has(sheet))] : sheets;
}

function sheetSignature(sheet: CSSStyleSheet): string {
  let id = sheetIds.get(sheet);
  if (id === undefined) {
    id = nextSheetId++;
    sheetIds.set(sheet, id);
  }
  const count = ruleCount(sheet);
  let signature = `${id}:${count}${sheet.disabled ? "d" : ""}`;
  // The sheets it imports, which load after it. @import comes first in a sheet.
  for (let i = 0; i < count; i++) {
    const rule = sheet.cssRules[i]!;
    if ("styleSheet" in rule) {
      const imported = (rule as CSSImportRule).styleSheet;
      signature += `[${imported ? sheetSignature(imported) : "-"}]`;
    } else if ("cssRules" in rule || !rule.cssText.startsWith("@layer")) {
      // Only @layer statements may come before an @import.
      break;
    }
  }
  return signature;
}

/**
 * What the page's stylesheets are: which (a <style> whose text is replaced
 * has a new sheet, with as many rules maybe), how many rules each has, whether
 * it is disabled, and the same of the sheets they import.
 */
export function stylesheetsSignature(sheets: CSSStyleSheet[]): string {
  return sheets.map(sheetSignature).join("|");
}

/**
 * Collects a document's CSS, recollecting only when its stylesheets or the
 * number of rules in them change (see stylesheetsSignature). Editing an
 * existing rule in place (CSSStyleRule.style) is not noticed; call
 * invalidate() for that.
 */
export class DocumentCss {
  private signature = "";
  private css = "";
  /**
   * Cross-origin stylesheets (a web font service, say) hide their rules from
   * script unless they were loaded with CORS. They are fetched again with CORS
   * and parsed here, keyed by URL.
   */
  private readonly fetched = new Map<string, CSSStyleSheet | "loading" | "failed">();
  private readonly window: FrameWindow;

  constructor(
    private readonly document: Document,
    private readonly resolveUrl: (url: string) => string | null,
    private readonly onChange: () => void = () => {},
  ) {
    this.window = document.defaultView as FrameWindow;
  }

  invalidate(): void {
    this.signature = "";
  }

  get(): string {
    const sheets = pageStylesheets(this.document);
    const signature = stylesheetsSignature(sheets);
    if (signature !== this.signature) {
      const parts: string[] = [DEFAULT_FOCUS_RING_CSS];
      for (const sheet of sheets) this.serializeSheet(sheet, parts);
      parts.push(FREEZE_ANIMATIONS_CSS);
      this.css = inlineCssUrls(parts.join("\n"), this.document.baseURI, this.resolveUrl);
      this.signature = signature;
    }
    return this.css;
  }

  private serializeSheet(source: CSSStyleSheet, out: string[]): void {
    if (source.disabled) return;
    const sheet = this.readable(source);
    if (!sheet) return;
    const start = out.length;
    this.serializeRules(sheet.cssRules, out);
    if (source.href) {
      for (let i = start; i < out.length; i++) out[i] = absolutizeUrls(out[i]!, source.href);
    }
  }

  private serializeRules(rules: CSSRuleList, out: string[]): void {
    const { CSSStyleRule, CSSMediaRule, CSSSupportsRule, CSSImportRule, CSSKeyframesRule, CSS } =
      this.window;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        // Nested rules (CSS nesting) are serialized with the parent; rewrite the whole text then.
        out.push(
          rule.cssRules.length > 0
            ? rewriteSelector(rule.cssText)
            : `${rewriteSelector(rule.selectorText)}{${rule.style.cssText}}`,
        );
      } else if (rule instanceof CSSMediaRule) {
        if (this.window.matchMedia(rule.conditionText).matches)
          this.serializeRules(rule.cssRules, out);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) this.serializeRules(rule.cssRules, out);
      } else if (rule instanceof CSSImportRule) {
        const sheet = rule.styleSheet;
        if (sheet && this.window.matchMedia(rule.media.mediaText || "all").matches)
          this.serializeSheet(sheet, out);
      } else if (rule instanceof CSSKeyframesRule) {
        // Animations are frozen, so keyframes are never used.
      } else {
        out.push(rule.cssText);
      }
    }
  }

  /**
   * The sheet itself if its rules can be read, or else a copy fetched with
   * CORS once it has loaded (null until then, or if it cannot be fetched).
   */
  readable(sheet: CSSStyleSheet): CSSStyleSheet | null {
    if (ruleCount(sheet) >= 0) return sheet;
    if (!sheet.href) return null;
    const href = sheet.href;
    const fetched = this.fetched.get(href);
    if (fetched instanceof this.window.CSSStyleSheet) return fetched;
    if (!fetched) {
      this.fetched.set(href, "loading");
      fetch(href, { mode: "cors", credentials: "omit", headers: { Accept: "text/css,*/*;q=0.1" } })
        .then((response) =>
          response.ok ? response.text() : Promise.reject(new Error(String(response.status))),
        )
        .then((text) => {
          // Parse in the page's realm, so the rules pass the type checks above.
          const parsed = new this.window.CSSStyleSheet();
          // replaceSync ignores @import; enough for this purpose.
          parsed.replaceSync(text);
          this.fetched.set(href, parsed);
          this.invalidate();
          this.onChange();
        })
        .catch(() => this.fetched.set(href, "failed"));
    }
    return null;
  }
}
