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
//   stopped here. The snapshot bakes their values into inline styles.

import type { FrameWindow } from "../../types";

export const HOVER_ATTRIBUTE = "data-thp-hover";
export const ACTIVE_ATTRIBUTE = "data-thp-active";
export const FOCUS_ATTRIBUTE = "data-thp-focus";
export const FOCUS_WITHIN_ATTRIBUTE = "data-thp-focus-within";

// A pseudo-class followed by something other than a name character, so that
// :focus does not also match :focus-visible.
const pseudoClass = (name: string) => new RegExp(`:${name}(?![-\\w])`, "g");

const SELECTOR_REWRITES: [RegExp, string][] = [
  [pseudoClass("root"), "html"],
  [pseudoClass("hover"), `[${HOVER_ATTRIBUTE}]`],
  [pseudoClass("active"), `[${ACTIVE_ATTRIBUTE}]`],
  [pseudoClass("focus-visible"), `[${FOCUS_ATTRIBUTE}]`],
  [pseudoClass("focus-within"), `[${FOCUS_WITHIN_ATTRIBUTE}]`],
  [pseudoClass("focus"), `[${FOCUS_ATTRIBUTE}]`],
];

export function rewriteSelector(selector: string): string {
  return SELECTOR_REWRITES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    selector,
  );
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
function absolutizeUrls(css: string, sheetUrl: string): string {
  return css.replace(URL_PATTERN, (match, _quote: string, raw: string) => {
    if (raw.startsWith("data:")) return match;
    try {
      return `url("${new URL(raw, sheetUrl).href}")`;
    } catch {
      return "none";
    }
  });
}

const isNamespace = (rule: string) => rule.startsWith("@namespace");

/**
 * A sheet's rules in the cascade layers it was imported into (outermost
 * first, "" for an anonymous one), as on the page: its @namespace rules stay
 * first, outside them (they cannot be in one).
 */
function inLayers(rules: string[], layers: readonly string[]): string[] {
  if (layers.length === 0) return rules;
  let layered = rules.filter((rule) => !isNamespace(rule)).join("\n");
  for (const layer of [...layers].reverse())
    layered = `@layer ${layer ? `${layer} ` : ""}{\n${layered}\n}`;
  return [...rules.filter(isNamespace), layered];
}

function ruleCount(sheet: CSSStyleSheet): number {
  try {
    return sheet.cssRules.length;
  } catch {
    return -1;
  }
}

/**
 * Collects a document's CSS, recollecting only when the set of stylesheets or
 * the number of rules in them (or in the blocks and imported sheets in them)
 * changes. Editing an existing rule in place (CSSStyleRule.style) is not
 * noticed; call invalidate() for that.
 */
export class DocumentCss {
  private signature = "";
  private css: readonly string[] = [];
  /**
   * The lists of rules inside the sheets (of blocks, nested rules, imported
   * sheets) as they were collected, with how many rules each had: rules
   * inserted there change no sheet's own count.
   */
  private inner: { rules: CSSRuleList; length: number }[] = [];
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

  /**
   * The CSS, as sheets: one for each of the page's (an @import'ed one before
   * the sheet importing it), as some rules only count in their own sheet
   * (@namespace, which must come first in it).
   */
  get(): readonly string[] {
    const sheets = Array.from(this.document.styleSheets);
    const signature = sheets
      .map((sheet) => `${sheet.href ?? "inline"}:${ruleCount(sheet)}`)
      .join("|");
    const changedInside = this.inner.some(({ rules, length }) => rules.length !== length);
    if (signature !== this.signature || changedInside) {
      this.inner = [];
      const out: string[][] = [[DEFAULT_FOCUS_RING_CSS]];
      for (const sheet of sheets) this.serializeSheet(sheet, out);
      out.push([FREEZE_ANIMATIONS_CSS]);
      // A namespace's url() is a name, not a file to inline.
      this.css = out
        .filter((rules) => rules.length > 0)
        .map((rules) =>
          [
            ...rules.filter(isNamespace),
            inlineCssUrls(
              rules.filter((rule) => !isNamespace(rule)).join("\n"),
              this.document.baseURI,
              this.resolveUrl,
            ),
          ].join("\n"),
        );
      this.signature = signature;
    }
    return this.css;
  }

  /**
   * Adds a sheet's rules to `sheets`, as a sheet (after those it imports).
   * `layers` are the cascade layers it was imported into (`@import … layer()`,
   * "" for an anonymous one), outermost first: its rules go in them, as on the
   * page.
   */
  private serializeSheet(source: CSSStyleSheet, sheets: string[][], layers: string[] = []): void {
    if (source.disabled) return;
    const sheet = this.readable(source);
    if (!sheet) return;
    const all = Array.from(sheet.cssRules);
    // Its @import rules, and the @layer statements among them (which declare
    // layers in turn with the imported ones), come first: each becomes a sheet
    // of its own, before this one, in their order.
    const { CSSImportRule, CSSLayerStatementRule } = this.window;
    let leading = 0;
    all.forEach((rule, index) => {
      if (rule instanceof CSSImportRule) leading = index + 1;
    });
    const rules: string[] = [];
    for (const rule of all.slice(0, leading)) {
      if (CSSLayerStatementRule && rule instanceof CSSLayerStatementRule)
        sheets.push(inLayers([rule.cssText], layers));
      else this.serializeRules([rule], rules, sheets, layers);
    }
    this.serializeRules(all.slice(leading), rules, sheets, layers);
    if (source.href) {
      // A namespace's url() is a name, not a file.
      for (let i = 0; i < rules.length; i++)
        if (!isNamespace(rules[i]!)) rules[i] = absolutizeUrls(rules[i]!, source.href);
    }
    sheets.push(inLayers(rules, layers));
  }

  private serializeRules(
    rules: ArrayLike<CSSRule>,
    out: string[],
    sheets: string[][],
    layers: string[],
  ): void {
    const {
      CSSStyleRule,
      CSSMediaRule,
      CSSSupportsRule,
      CSSImportRule,
      CSSKeyframesRule,
      CSSGroupingRule,
      CSSPageRule,
      CSS,
    } = this.window;
    for (const rule of Array.from(rules)) {
      // Rules inserted in a block later are noticed (see get()); not in every
      // style rule (each has a list, empty but for nested rules: too many).
      const block = (rule as Partial<CSSGroupingRule>).cssRules;
      if (block && (block.length > 0 || !(rule instanceof CSSStyleRule))) this.watch(block);
      if (rule instanceof CSSStyleRule) {
        if (rule.cssRules.length === 0) {
          out.push(`${rewriteSelector(rule.selectorText)}{${rule.style.cssText}}`);
          continue;
        }
        // Nested rules (CSS nesting) are copied as the top level's, inside it.
        const inner: string[] = [];
        this.serializeRules(rule.cssRules, inner, sheets, layers);
        out.push(
          `${rewriteSelector(rule.selectorText)} {${rule.style.cssText}\n${inner.join("\n")}\n}`,
        );
      } else if (rule instanceof CSSMediaRule) {
        if (this.window.matchMedia(rule.conditionText).matches)
          this.serializeRules(rule.cssRules, out, sheets, layers);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText))
          this.serializeRules(rule.cssRules, out, sheets, layers);
      } else if (rule instanceof CSSImportRule) {
        const sheet = rule.styleSheet;
        // Its conditions: media, and supports() (newer browsers).
        const supports = (rule as { supportsText?: string | null }).supportsText;
        const layer = (rule as { layerName?: string | null }).layerName;
        if (sheet) {
          const readable = this.readable(sheet);
          if (readable) this.watch(readable.cssRules);
        }
        if (
          sheet &&
          this.window.matchMedia(rule.media.mediaText || "all").matches &&
          (!supports || CSS.supports(supports))
        )
          this.serializeSheet(sheet, sheets, layer == null ? layers : [...layers, layer]);
      } else if (rule instanceof CSSKeyframesRule) {
        // Animations are frozen, so keyframes are never used.
      } else if (
        CSSGroupingRule &&
        rule instanceof CSSGroupingRule &&
        // @page has declarations of its own (and no effect on screen).
        !(CSSPageRule && rule instanceof CSSPageRule)
      ) {
        // Other blocks of rules (@layer, @container, @scope…): their rules as
        // the top level's (interaction states, @media checked here), in them.
        const inner: string[] = [];
        this.serializeRules(rule.cssRules, inner, sheets, layers);
        const prelude = rule.cssText.slice(0, rule.cssText.indexOf("{")).trim();
        out.push(`${rewriteSelector(prelude)} {\n${inner.join("\n")}\n}`);
      } else {
        out.push(rule.cssText);
      }
    }
  }

  private watch(rules: CSSRuleList): void {
    this.inner.push({ rules, length: rules.length });
  }

  private readable(sheet: CSSStyleSheet): CSSStyleSheet | null {
    try {
      void sheet.cssRules;
      return sheet;
    } catch {
      if (!sheet.href) return null;
    }
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
