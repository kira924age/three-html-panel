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
// Rules the page's script cannot read (a cross-origin stylesheet without CORS)
// cannot be edited. Their interaction rules, from the copy DocumentCss
// fetches, go into a sheet of the agent's own (adoptedStyleSheets), after the
// page's: there they win ties with the page's rules of the same specificity
// that come later.

import type { FrameWindow } from "../../types";
import { liveSelector } from "./css";

function ruleCount(sheet: CSSStyleSheet): number {
  try {
    return sheet.cssRules.length;
  } catch {
    return -1;
  }
}

export class LiveInteractionCss {
  private signature = "";
  /** Each stylesheet seen, by number: a <style> whose text is replaced has a new sheet, with as many rules maybe. */
  private readonly sheetIds = new WeakMap<CSSStyleSheet, number>();
  private nextSheetId = 0;
  /** The selectors rewritten, as the page wrote them (restored on dispose). */
  private readonly originals = new Map<CSSStyleRule, string>();
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

  /** Rewrites everything again on the next sync (a copy of a cross-origin sheet arrived, say). */
  invalidate(): void {
    this.signature = "";
  }

  /**
   * Rewrites the rules added since the last call. As DocumentCss, it notices
   * stylesheets added or removed and rules added to or removed from them, not
   * rules added inside an @media block or edited in place.
   */
  sync(): void {
    const sheets = Array.from(this.document.styleSheets);
    const signature = sheets.map((sheet) => `${this.sheetId(sheet)}:${ruleCount(sheet)}`).join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    // Rules the page removed are not restored.
    for (const rule of this.originals.keys())
      if (!rule.parentStyleSheet) this.originals.delete(rule);
    const copied: string[] = [];
    for (const sheet of sheets) this.syncSheet(sheet, copied);
    this.adopt(copied.join("\n"));
  }

  /** Puts the page's selectors back. */
  dispose(): void {
    for (const [rule, selector] of this.originals) rule.selectorText = selector;
    this.originals.clear();
    this.adopt("");
    this.signature = "";
  }

  private sheetId(sheet: CSSStyleSheet): number {
    let id = this.sheetIds.get(sheet);
    if (id === undefined) {
      id = this.nextSheetId++;
      this.sheetIds.set(sheet, id);
    }
    return id;
  }

  private syncSheet(source: CSSStyleSheet, copied: string[]): void {
    const sheet = this.readable(source);
    if (!sheet) return;
    if (sheet === source) this.rewrite(sheet.cssRules);
    else copied.push(...this.interactionRules(sheet.cssRules));
  }

  private rewrite(rules: CSSRuleList): void {
    const { CSSStyleRule, CSSImportRule } = this.window;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const selector = liveSelector(rule.selectorText);
        if (selector !== null) {
          if (!this.originals.has(rule)) this.originals.set(rule, rule.selectorText);
          rule.selectorText = selector;
        }
      }
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet && ruleCount(rule.styleSheet) >= 0)
          this.rewrite(rule.styleSheet.cssRules);
      } else if ("cssRules" in rule) {
        // @media, @supports, @layer, @container blocks, and nested style rules.
        this.rewrite(rule.cssRules as CSSRuleList);
      }
    }
  }

  /** The interaction rules of a copy, rewritten, in their @media and @supports blocks. */
  private interactionRules(rules: CSSRuleList): string[] {
    const { CSSStyleRule, CSSMediaRule, CSSSupportsRule } = this.window;
    const out: string[] = [];
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        // The copy is the agent's own: rewrite it there (once), and take its text.
        const selector = liveSelector(rule.selectorText);
        if (selector !== null) rule.selectorText = selector;
        else if (!rule.selectorText.includes("[data-thp-")) continue;
        out.push(rule.cssText);
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
