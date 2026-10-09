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
/** Focus the browser would show (from keys, or in a text field), not every focus. */
export const FOCUS_VISIBLE_ATTRIBUTE = "data-thp-focus-visible";

const INTERACTION_ATTRIBUTE_OF: Record<string, string> = {
  hover: HOVER_ATTRIBUTE,
  active: ACTIVE_ATTRIBUTE,
  "focus-visible": FOCUS_VISIBLE_ATTRIBUTE,
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

/** Whether the pseudo-class at `start` to `end` is the one in a rewrite already: `:is(:hover,[data-thp-hover])`. */
const isWrapped = (selector: string, start: number, end: number) =>
  /:is\(\s*$/.test(selector.slice(Math.max(0, start - 8), start)) &&
  /^\s*,\s*\[data-thp-/.test(selector.slice(end, end + 16));

/**
 * Where in `selector` the text is not selector syntax: inside an attribute
 * selector (`[title=":hover"]`) or a string, or escaped (Tailwind's
 * `.md\:hover\:underline`). One flag per character.
 */
function quotedText(selector: string): boolean[] {
  const quoted: boolean[] = [];
  let quote = "";
  let brackets = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]!;
    quoted.push(quote !== "" || brackets > 0);
    if (char === "\\") {
      // The character escaped is part of a name (or of the string).
      quoted.push(true);
      i++;
    } else if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[") brackets++;
    else if (char === "]" && brackets > 0) brackets--;
  }
  return quoted;
}

/**
 * Replaces the interaction pseudo-classes, but those inside an attribute
 * selector, a string or an escape (not pseudo-classes), those that follow a
 * pseudo-element, and those rewritten already (a selector the page read back
 * and added to, say).
 */
function replaceInteractionPseudoClasses(
  selector: string,
  replace: (match: string, attribute: string) => string,
): string {
  let quoted: boolean[] | null = null;
  return selector.replace(INTERACTION_PSEUDO_CLASS, (match, name: string, offset: number) => {
    // Only for selectors with a bracket, a quote or an escape at all: most have none.
    if (/["'[\\]/.test(selector)) quoted ??= quotedText(selector);
    return quoted?.[offset] ||
      followsPseudoElement(selector, offset) ||
      isWrapped(selector, offset, offset + match.length)
      ? match
      : replace(match, INTERACTION_ATTRIBUTE_OF[name]!);
  });
}

const LIVE_REWRITE =
  /:is\(\s*(:(?:hover|active|focus-visible|focus-within|focus))\s*,\s*\[data-thp-[\w-]+\]\s*\)/g;

/** The selector as the page wrote it: what liveSelector added taken out. */
export function unwrapLiveSelector(selector: string): string {
  return selector.replace(LIVE_REWRITE, "$1");
}

/**
 * The selector for the live page: each interaction pseudo-class also matches
 * its attribute, `:hover` becoming `:is(:hover,[data-thp-hover])`. The
 * specificity stays the same, and so does the rule's place in the cascade.
 * Null if there is nothing (more) to rewrite.
 */
export function liveSelector(selector: string): string | null {
  const rewritten = replaceInteractionPseudoClasses(
    selector,
    (match, attribute) => `:is(${match},[${attribute}])`,
  );
  return rewritten === selector ? null : rewritten;
}

/**
 * The selector for the image: as for the live page
 * (:hover never matches in an image, the attribute does), and :root is html.
 */
export function rewriteSelector(selector: string): string {
  const rooted = selector.replace(ROOT_PSEUDO_CLASS, "html");
  return liveSelector(rooted) ?? rooted;
}

// Browsers draw a focus ring for text fields from their own user agent
// stylesheet, which is not in document.styleSheets. This stands in for it with
// zero specificity, so any rule the page writes about the outline wins. Only
// where the focus shows (:focus-visible): not a <select> pressed with a mouse.
const DEFAULT_FOCUS_RING_CSS =
  `:where(input[${FOCUS_VISIBLE_ATTRIBUTE}], textarea[${FOCUS_VISIBLE_ATTRIBUTE}], select[${FOCUS_VISIBLE_ATTRIBUTE}])` +
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

/** A stylesheet's own part of the signature: which it is, how many rules it has, whether it is disabled. */
export function sheetSignature(sheet: CSSStyleSheet): string {
  let id = sheetIds.get(sheet);
  if (id === undefined) {
    id = nextSheetId++;
    sheetIds.set(sheet, id);
  }
  return `${id}:${ruleCount(sheet)}${sheet.disabled ? "d" : ""}`;
}

/**
 * The parts of the signature: each stylesheet's own (sheetSignature), each
 * followed by those of the sheets it imports, which load after it ("-" for one
 * not loaded yet). Each sheet has its own part, so that a change to one can be
 * accounted for without hiding what else changed.
 */
export function signatureParts(sheets: CSSStyleSheet[]): [CSSStyleSheet | null, string][] {
  const parts: [CSSStyleSheet | null, string][] = [];
  const add = (sheet: CSSStyleSheet) => {
    parts.push([sheet, sheetSignature(sheet)]);
    const count = ruleCount(sheet);
    // @import comes first in a sheet.
    for (let i = 0; i < count; i++) {
      const rule = sheet.cssRules[i]!;
      if ("styleSheet" in rule) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) add(imported);
        else parts.push([null, "-"]);
      } else if ("cssRules" in rule || !rule.cssText.startsWith("@layer")) {
        // Only @layer statements may come before an @import.
        break;
      }
    }
  };
  for (const sheet of sheets) add(sheet);
  return parts;
}

/**
 * What the page's stylesheets are: which (a <style> whose text is replaced
 * has a new sheet, with as many rules maybe), how many rules each has, whether
 * it is disabled, and the same of the sheets they import.
 */
export function stylesheetsSignature(sheets: CSSStyleSheet[]): string {
  return signatureParts(sheets)
    .map(([, part]) => part)
    .join("|");
}

/**
 * Collects a document's CSS, recollecting only when its stylesheets or the
 * number of rules in them (or in the blocks and imported sheets in them)
 * change (see stylesheetsSignature). Editing an existing rule in place
 * (CSSStyleRule.style) is not noticed; call invalidate() for that.
 */
export class DocumentCss {
  /** Null until collected (a page without stylesheets has the signature ""). */
  #signature: string | null = null;
  #css: readonly string[] = [];
  /**
   * The lists of rules inside the sheets (of blocks, nested rules, imported
   * sheets) as they were collected, with how many rules each had: rules
   * inserted there change no sheet's own count.
   */
  #inner: { rules: CSSRuleList; length: number }[] = [];
  /**
   * Cross-origin stylesheets (a web font service, say) hide their rules from
   * script unless they were loaded with CORS. They are fetched again with CORS
   * and parsed here, keyed by URL.
   */
  readonly #fetched = new Map<string, CSSStyleSheet | "loading" | "failed">();
  readonly #window: FrameWindow;
  readonly #document: Document;
  readonly #resolveUrl: (url: string) => string | null;
  readonly #onChange: () => void;

  constructor(
    document: Document,
    resolveUrl: (url: string) => string | null,
    onChange: () => void = () => {},
  ) {
    this.#document = document;
    this.#resolveUrl = resolveUrl;
    this.#onChange = onChange;
    this.#window = document.defaultView as FrameWindow;
  }

  invalidate(): void {
    this.#signature = null;
  }

  /**
   * The CSS, as sheets: one for each of the page's (an @import'ed one before
   * the sheet importing it), as some rules only count in their own sheet
   * (@namespace, which must come first in it).
   */
  get(): readonly string[] {
    const sheets = pageStylesheets(this.#document);
    const signature = stylesheetsSignature(sheets);
    const changedInside = this.#inner.some(({ rules, length }) => rules.length !== length);
    if (signature !== this.#signature || changedInside) {
      this.#inner = [];
      const out: string[][] = [[DEFAULT_FOCUS_RING_CSS]];
      for (const sheet of sheets) this.#serializeSheet(sheet, out);
      out.push([FREEZE_ANIMATIONS_CSS]);
      // A namespace's url() is a name, not a file to inline.
      this.#css = out
        .filter((rules) => rules.length > 0)
        .map((rules) =>
          [
            ...rules.filter(isNamespace),
            inlineCssUrls(
              rules.filter((rule) => !isNamespace(rule)).join("\n"),
              this.#document.baseURI,
              this.#resolveUrl,
            ),
          ].join("\n"),
        );
      this.#signature = signature;
    }
    return this.#css;
  }

  /**
   * Adds a sheet's rules to `sheets`, as a sheet (after those it imports).
   * `layers` are the cascade layers it was imported into (`@import … layer()`,
   * "" for an anonymous one), outermost first: its rules go in them, as on the
   * page.
   */
  #serializeSheet(
    source: CSSStyleSheet,
    sheets: string[][],
    layers: string[] = [],
    imported = false,
  ): void {
    if (source.disabled) return;
    const sheet = this.readable(source);
    if (!sheet) return;
    // An imported sheet's rules count in no document sheet's (see get()).
    if (imported) this.#watch(sheet.cssRules);
    const all = Array.from(sheet.cssRules);
    // Its @import rules, and the @layer statements among them (which declare
    // layers in turn with the imported ones), come first: each becomes a sheet
    // of its own, before this one, in their order.
    const { CSSImportRule, CSSLayerStatementRule } = this.#window;
    let leading = 0;
    all.forEach((rule, index) => {
      if (rule instanceof CSSImportRule) leading = index + 1;
    });
    const rules: string[] = [];
    for (const rule of all.slice(0, leading)) {
      if (CSSLayerStatementRule && rule instanceof CSSLayerStatementRule)
        sheets.push(inLayers([rule.cssText], layers));
      else this.#serializeRules([rule], rules, sheets, layers);
    }
    this.#serializeRules(all.slice(leading), rules, sheets, layers);
    if (source.href) {
      // A namespace's url() is a name, not a file.
      for (let i = 0; i < rules.length; i++)
        if (!isNamespace(rules[i]!)) rules[i] = absolutizeUrls(rules[i]!, source.href);
    }
    sheets.push(inLayers(rules, layers));
  }

  #serializeRules(
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
    } = this.#window;
    for (const rule of Array.from(rules)) {
      // Rules inserted in a block later are noticed (see get()); not in every
      // style rule (each has a list, empty but for nested rules: too many).
      const block = (rule as Partial<CSSGroupingRule>).cssRules;
      if (block && (block.length > 0 || !(rule instanceof CSSStyleRule))) this.#watch(block);
      if (rule instanceof CSSStyleRule) {
        if (rule.cssRules.length === 0) {
          out.push(`${rewriteSelector(rule.selectorText)}{${rule.style.cssText}}`);
          continue;
        }
        // Nested rules (CSS nesting) are copied as the top level's, inside it.
        const inner: string[] = [];
        this.#serializeRules(rule.cssRules, inner, sheets, layers);
        out.push(
          `${rewriteSelector(rule.selectorText)} {${rule.style.cssText}\n${inner.join("\n")}\n}`,
        );
      } else if (rule instanceof CSSMediaRule) {
        if (this.#window.matchMedia(rule.conditionText).matches)
          this.#serializeRules(rule.cssRules, out, sheets, layers);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText))
          this.#serializeRules(rule.cssRules, out, sheets, layers);
      } else if (rule instanceof CSSImportRule) {
        const sheet = rule.styleSheet;
        // Its conditions: media, and supports() (newer browsers).
        const supports = (rule as { supportsText?: string | null }).supportsText;
        const layer = (rule as { layerName?: string | null }).layerName;
        if (
          sheet &&
          this.#window.matchMedia(rule.media.mediaText || "all").matches &&
          (!supports || CSS.supports(supports))
        )
          this.#serializeSheet(sheet, sheets, layer == null ? layers : [...layers, layer], true);
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
        this.#serializeRules(rule.cssRules, inner, sheets, layers);
        const prelude = rule.cssText.slice(0, rule.cssText.indexOf("{")).trim();
        out.push(`${rewriteSelector(prelude)} {\n${inner.join("\n")}\n}`);
      } else {
        out.push(rule.cssText);
      }
    }
  }

  #watch(rules: CSSRuleList): void {
    this.#inner.push({ rules, length: rules.length });
  }

  /**
   * The sheet itself if its rules can be read, or else a copy fetched with
   * CORS once it has loaded (null until then, or if it cannot be fetched).
   */
  readable(sheet: CSSStyleSheet): CSSStyleSheet | null {
    if (ruleCount(sheet) >= 0) return sheet;
    if (!sheet.href) return null;
    const href = sheet.href;
    const fetched = this.#fetched.get(href);
    if (fetched instanceof this.#window.CSSStyleSheet) return fetched;
    if (!fetched) {
      this.#fetched.set(href, "loading");
      fetch(href, { mode: "cors", credentials: "omit", headers: { Accept: "text/css,*/*;q=0.1" } })
        .then((response) =>
          response.ok ? response.text() : Promise.reject(new Error(String(response.status))),
        )
        .then((text) => {
          // Parse in the page's realm, so the rules pass the type checks above.
          const parsed = new this.#window.CSSStyleSheet();
          // replaceSync ignores @import; enough for this purpose.
          parsed.replaceSync(text);
          this.#fetched.set(href, parsed);
          this.invalidate();
          this.#onChange();
        })
        .catch(() => this.#fetched.set(href, "failed"));
    }
    return null;
  }
}
