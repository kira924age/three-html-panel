// Makes the page's own CSS follow the agent's interaction states.
//
// The panel iframe never gets a real pointer or real focus, so :hover,
// :active, :focus and :focus-within never match in the live page. The image
// shows them (css.ts rewrites them to attributes the agent sets, see
// interaction-marks.ts), but hit testing runs on the live page: a button
// shown only while its row is hovered would be drawn, yet a press there would
// land on what is under it. So the page's rules are rewritten too, in place:
// `.row:hover .tools` becomes `.row:is(:hover,[data-thp-hover]) .tools`. Same
// specificity, same place in the cascade, and still matching for real when the
// browser does match (a page opened on its own), without applying twice.
//
// What the page can see: the selectorText of those rules, as it reads it back.
// The rules themselves, their number and order, stay as they were (CSS-in-JS
// libraries address rules by index). The CSSOM methods that change stylesheets
// are wrapped, to know when to look again.
//
// The stylesheets of shadow roots are not rewritten: the agent's hover and
// focus stop at a shadow root anyway.
//
// Rules the page's script cannot read (a cross-origin stylesheet without CORS,
// linked or imported) cannot be edited. Their interaction rules, from the copy
// DocumentCss fetches, go into a sheet of the agent's own (adoptedStyleSheets),
// after the page's: there they win ties with the page's rules of the same
// specificity that come later.
//
// An interaction pseudo-class after a pseudo-element
// (::-webkit-scrollbar-thumb:hover) is left alone, as css.ts does for the image.

import type { FrameWindow } from "../../types";
import {
  absolutizeUrls,
  agentSheets,
  liveSelector,
  pageStylesheets,
  ruleCount,
  stylesheetsSignature,
} from "./css";

/**
 * Calls `onChange` after the page's script changes a stylesheet through the
 * CSSOM (insertRule, replace, disabled, adoptedStyleSheets, ...), which no
 * MutationObserver sees. Returns what puts the originals back.
 */
function watchStylesheets(window: FrameWindow, onChange: () => void): () => void {
  const restores: (() => void)[] = [];
  const wrapMethod = (proto: Record<string, unknown> | undefined, name: string) => {
    const original = proto?.[name];
    if (!proto || typeof original !== "function") return;
    // The page's sheets call these with themselves as `this`: no arrow function.
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const result: unknown = original.apply(this, args);
      onChange();
      // replace() applies the rules later.
      if (result && typeof (result as Promise<unknown>).then === "function")
        (result as Promise<unknown>).then(onChange, () => {});
      return result;
    };
    proto[name] = wrapped;
    restores.push(() => {
      if (proto[name] === wrapped) proto[name] = original;
    });
  };
  const wrapSetter = (proto: object | undefined, name: string) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, name);
    // oxlint-disable-next-line typescript/unbound-method -- called with .call on the page's object
    const set = descriptor?.set;
    if (!proto || !descriptor?.configurable || !set) return;
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(value: unknown) {
        set.call(this, value);
        onChange();
      },
    });
    restores.push(() => Object.defineProperty(proto, name, descriptor));
  };
  const sheet = window.CSSStyleSheet?.prototype as unknown as Record<string, unknown> | undefined;
  for (const name of [
    "insertRule",
    "deleteRule",
    "addRule",
    "removeRule",
    "replace",
    "replaceSync",
  ])
    wrapMethod(sheet, name);
  const grouping = (
    window as unknown as { CSSGroupingRule?: { prototype: Record<string, unknown> } }
  ).CSSGroupingRule?.prototype;
  for (const name of ["insertRule", "deleteRule"]) wrapMethod(grouping, name);
  wrapSetter(window.StyleSheet?.prototype, "disabled");
  wrapSetter(window.Document?.prototype, "adoptedStyleSheets");
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

export class LiveInteractionCss {
  private signature = "";
  /**
   * The stylesheets may have changed since the last sync. Reading them all
   * on every pointer move would be wasted work: the page says when (see
   * invalidate()), or the CSSOM does (watchStylesheets).
   */
  private stale = true;
  /** Set while syncing: the agent's own sheet changing is not the page's. */
  private syncing = false;
  /** The selectors rewritten, as the page wrote them (restored on dispose). */
  private readonly originals = new Map<CSSStyleRule, string>();
  /** Rules whose rewritten selector the browser did not take: not tried again. */
  private readonly rejected = new WeakSet<CSSStyleRule>();
  /** The interaction rules of stylesheets that could not be edited. */
  private adopted: CSSStyleSheet | null = null;
  private readonly window: FrameWindow;
  private readonly unwatch: () => void;

  constructor(
    private readonly document: Document,
    /** The sheet itself if it can be read, or else a readable copy (DocumentCss.readable). */
    private readonly readable: (sheet: CSSStyleSheet) => CSSStyleSheet | null = (sheet) =>
      ruleCount(sheet) >= 0 ? sheet : null,
  ) {
    this.window = document.defaultView as FrameWindow;
    // A rule inserted into an @media block does not change the signature: look at everything again.
    this.unwatch = watchStylesheets(this.window, () => {
      if (!this.syncing) this.reset();
    });
  }

  /**
   * The stylesheets may have changed: the DOM did (a <style> or <link> added,
   * or a framework rendering), or a stylesheet loaded.
   */
  invalidate(): void {
    this.stale = true;
  }

  /** Rewrites everything again on the next sync (a copy of a cross-origin sheet arrived, say). */
  reset(): void {
    this.stale = true;
    this.signature = "";
  }

  /**
   * Rewrites the rules added since the last call, if the page may have changed
   * its stylesheets: stylesheets added, removed, replaced, disabled or
   * enabled, rules added to or removed from them (or the sheets they import),
   * and whatever the page changes through the CSSOM. Not a selector the page
   * sets itself. Returns whether it rewrote anything (the page may lay out
   * differently).
   */
  sync(): boolean {
    if (!this.stale) return false;
    this.stale = false;
    const sheets = pageStylesheets(this.document);
    const signature = stylesheetsSignature(sheets);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.syncing = true;
    try {
      const copied: string[] = [];
      const visited = new Set<CSSStyleSheet>();
      for (const sheet of sheets) this.syncSheet(sheet, sheet.media.mediaText, copied, visited);
      // Rules of sheets the page removed (or rules it deleted) are not restored.
      for (const rule of this.originals.keys())
        if (!rule.parentStyleSheet || !visited.has(rule.parentStyleSheet))
          this.originals.delete(rule);
      this.adopt(copied.join("\n"));
    } finally {
      this.syncing = false;
    }
    return true;
  }

  /** Puts the page's selectors and the CSSOM back. */
  dispose(): void {
    this.syncing = true;
    for (const [rule, selector] of this.originals) rule.selectorText = selector;
    this.originals.clear();
    this.adopt("");
    this.unwatch();
    this.signature = "";
    this.stale = true;
  }

  /** Rewrites a sheet in place, or, if the page cannot edit it, copies its interaction rules out. */
  private syncSheet(
    source: CSSStyleSheet,
    media: string,
    copied: string[],
    visited: Set<CSSStyleSheet>,
  ): void {
    // A disabled sheet is rewritten as well, for when the page enables it.
    const sheet = this.readable(source);
    if (!sheet) return;
    if (sheet === source) {
      visited.add(sheet);
      this.rewrite(sheet.cssRules, copied, visited);
      return;
    }
    if (source.disabled) return;
    let css = this.interactionRules(sheet.cssRules, false).join("\n");
    if (!css) return;
    // In the agent's sheet, url() would be relative to the document.
    if (source.href) css = absolutizeUrls(css, source.href);
    copied.push(media && media !== "all" ? `@media ${media}{${css}}` : css);
  }

  private rewrite(rules: CSSRuleList, copied: string[], visited: Set<CSSStyleSheet>): void {
    const { CSSStyleRule, CSSImportRule } = this.window;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) this.rewriteRule(rule);
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) this.syncSheet(rule.styleSheet, rule.media.mediaText, copied, visited);
      } else if ("cssRules" in rule) {
        // @media, @supports, @layer, @container blocks, and nested style rules.
        this.rewrite(rule.cssRules as CSSRuleList, copied, visited);
      }
    }
  }

  private rewriteRule(rule: CSSStyleRule): void {
    if (this.rejected.has(rule)) return;
    const original = rule.selectorText;
    const selector = liveSelector(original);
    if (selector === null) return;
    rule.selectorText = selector;
    // An invalid selector is ignored, the rule left as it was.
    if (!rule.selectorText.includes("[data-thp-")) {
      this.rejected.add(rule);
      return;
    }
    if (!this.originals.has(rule)) this.originals.set(rule, original);
  }

  /**
   * The interaction rules of a copy (DocumentCss's, left as it is), rewritten,
   * in the blocks they are in (@media, @layer, ...). Only what the
   * interaction applies to is taken: the copy's other rules are the page's
   * already, and would win ties again from here.
   */
  private interactionRules(rules: CSSRuleList, interactive: boolean): string[] {
    const out: string[] = [];
    for (const rule of Array.from(rules)) {
      const text = this.interactionRule(rule, interactive);
      if (text) out.push(text);
    }
    return out;
  }

  /** A rule, or what of it is an interaction rule (`interactive`: inside one already); null if none. */
  private interactionRule(rule: CSSRule, interactive: boolean): string | null {
    const { CSSStyleRule } = this.window;
    if (rule instanceof CSSStyleRule) {
      const selector = liveSelector(rule.selectorText);
      const inside = interactive || selector !== null;
      // Nested rules (CSS nesting): selectors rewritten one by one, the declarations left as they are.
      const nested = rule.cssRules ? this.interactionRules(rule.cssRules, inside) : [];
      if (!inside && nested.length === 0) return null;
      const declarations = inside ? rule.style.cssText : "";
      return `${selector ?? rule.selectorText}{${declarations}${nested.join("\n")}}`;
    }
    if ("cssRules" in rule) {
      // @media, @supports, @layer, @container, @scope (not @keyframes: none of its rules is a style rule).
      const nested = this.interactionRules(rule.cssRules as CSSRuleList, interactive);
      if (nested.length === 0) return null;
      const prelude = rule.cssText.slice(0, rule.cssText.indexOf("{"));
      return `${prelude}{${nested.join("\n")}}`;
    }
    // Declarations between nested rules (CSSNestedDeclarations).
    if (interactive && "style" in rule) return (rule as CSSStyleRule).style.cssText;
    return null;
  }

  private adopt(css: string): void {
    const document = this.document as Document & { adoptedStyleSheets?: CSSStyleSheet[] };
    if (!document.adoptedStyleSheets) return;
    const current = this.adopted;
    if (!css) {
      if (current)
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          (sheet) => sheet !== current,
        );
      this.adopted = null;
      return;
    }
    const sheet = current ?? new this.window.CSSStyleSheet();
    agentSheets.add(sheet);
    sheet.replaceSync(css);
    this.adopted = sheet;
    // The page may have replaced the list (adoptedStyleSheets = [...]) since.
    if (!document.adoptedStyleSheets.includes(sheet))
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
}
