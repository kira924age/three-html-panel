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
// libraries address rules by index).
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
import { absolutizeUrls, liveSelector, ruleCount, stylesheetsSignature } from "./css";

export class LiveInteractionCss {
  private signature = "";
  /**
   * The stylesheets may have changed since the last sync. Reading them all
   * on every pointer move would be wasted work: the page says when (see
   * invalidate()).
   */
  private stale = true;
  /** The selectors rewritten, as the page wrote them (restored on dispose). */
  private readonly originals = new Map<CSSStyleRule, string>();
  /** Rules whose rewritten selector the browser did not take: not tried again. */
  private readonly rejected = new WeakSet<CSSStyleRule>();
  /** The interaction rules of stylesheets that could not be edited. */
  private adopted: CSSStyleSheet | null = null;
  private readonly window: FrameWindow;

  constructor(
    private readonly document: Document,
    /** The sheet itself if it can be read, or else a readable copy (DocumentCss.readable). */
    private readonly readable: (sheet: CSSStyleSheet) => CSSStyleSheet | null = (sheet) =>
      ruleCount(sheet) >= 0 ? sheet : null,
  ) {
    this.window = document.defaultView as FrameWindow;
  }

  /**
   * The stylesheets may have changed: the DOM did (a <style> or <link> added,
   * or a framework rendering, which is when CSS-in-JS inserts its rules).
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
   * Rewrites the rules added since the last call, if the page said they may
   * have changed. As DocumentCss, it notices stylesheets added, removed or
   * replaced, and rules added to or removed from them, not rules added inside
   * an @media block or edited in place.
   */
  sync(): void {
    if (!this.stale) return;
    this.stale = false;
    const sheets = Array.from(this.document.styleSheets);
    const signature = stylesheetsSignature(sheets);
    if (signature === this.signature) return;
    this.signature = signature;
    // Rules the page removed are not restored.
    for (const rule of this.originals.keys())
      if (!rule.parentStyleSheet) this.originals.delete(rule);
    const copied: string[] = [];
    for (const sheet of sheets) this.syncSheet(sheet, sheet.media.mediaText, copied);
    this.adopt(copied.join("\n"));
  }

  /** Puts the page's selectors back. */
  dispose(): void {
    for (const [rule, selector] of this.originals) rule.selectorText = selector;
    this.originals.clear();
    this.adopt("");
    this.signature = "";
    this.stale = true;
  }

  /** Rewrites a sheet in place, or, if the page cannot edit it, copies its interaction rules out. */
  private syncSheet(source: CSSStyleSheet, media: string, copied: string[]): void {
    if (source.disabled) return;
    const sheet = this.readable(source);
    if (!sheet) return;
    if (sheet === source) {
      this.rewrite(sheet.cssRules, copied);
      return;
    }
    let css = this.interactionRules(sheet.cssRules).join("\n");
    if (!css) return;
    // In the agent's sheet, url() would be relative to the document.
    if (source.href) css = absolutizeUrls(css, source.href);
    copied.push(media && media !== "all" ? `@media ${media}{${css}}` : css);
  }

  private rewrite(rules: CSSRuleList, copied: string[]): void {
    const { CSSStyleRule, CSSImportRule } = this.window;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) this.rewriteRule(rule);
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) this.syncSheet(rule.styleSheet, rule.media.mediaText, copied);
      } else if ("cssRules" in rule) {
        // @media, @supports, @layer, @container blocks, and nested style rules.
        this.rewrite(rule.cssRules as CSSRuleList, copied);
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
   * The interaction rules of a copy, rewritten, in their @media and @supports
   * blocks. The copy is DocumentCss's: only its text is taken.
   */
  private interactionRules(rules: CSSRuleList): string[] {
    const { CSSStyleRule, CSSMediaRule, CSSSupportsRule } = this.window;
    const out: string[] = [];
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        // Nested rules (CSS nesting) are in the text, the interaction may be in one of them.
        const text =
          rule.cssRules.length > 0
            ? liveSelector(rule.cssText)
            : liveSelector(rule.selectorText)?.concat(`{${rule.style.cssText}}`);
        if (text) out.push(text);
      } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
        const inner = this.interactionRules(rule.cssRules);
        const keyword = rule instanceof CSSMediaRule ? "@media" : "@supports";
        if (inner.length > 0) out.push(`${keyword} ${rule.conditionText}{${inner.join("\n")}}`);
      }
    }
    return out;
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
    sheet.replaceSync(css);
    this.adopted = sheet;
    // The page may have replaced the list (adoptedStyleSheets = [...]) since.
    if (!document.adoptedStyleSheets.includes(sheet))
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
}
