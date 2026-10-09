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
  sheetSignature,
  signatureParts,
} from "./css";

/** What the page changed through the CSSOM (see watchStylesheets). */
export type CssomChange =
  /** A rule inserted into a stylesheet or a block (@media, ...), at `index`. */
  | { kind: "insert"; parent: CSSStyleSheet | CSSGroupingRule; index: number }
  /** A rule deleted: nothing to rewrite, but the stylesheets are not what they were. */
  | { kind: "delete"; parent: CSSStyleSheet | CSSGroupingRule }
  /** A stylesheet replaced, disabled or enabled, or rules added the old way (addRule). */
  | { kind: "sheet"; sheet: CSSStyleSheet }
  /** A <style> element disabled or enabled, or a document's adoptedStyleSheets set. */
  | { kind: "owner"; owner: Element | Document };

type CssomListener = (change: CssomChange) => void;

/** Per window: who listens, and what puts the originals back. Wrapped once, however many listen. */
const watchers = new WeakMap<object, { listeners: Set<CssomListener>; unwrap: () => void }>();

/**
 * Calls `listener` after the page's script changes a stylesheet through the
 * CSSOM (insertRule, replace, disabled, adoptedStyleSheets, ...), which no
 * MutationObserver sees. The methods and setters are replaced in the page's
 * realm, once; the originals come back when the last listener stops. Returns
 * what stops it.
 */
function watchStylesheets(window: FrameWindow, listener: CssomListener): () => void {
  let watcher = watchers.get(window);
  if (!watcher) {
    const listeners = new Set<CssomListener>();
    const unwrap = wrapCssom(window, (change) => {
      for (const each of Array.from(listeners)) each(change);
    });
    watcher = { listeners, unwrap };
    watchers.set(window, watcher);
  }
  const { listeners, unwrap } = watcher;
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    unwrap();
    watchers.delete(window);
  };
}

/** Wraps the CSSOM's methods and setters that change stylesheets; returns what puts them back. */
function wrapCssom(window: FrameWindow, onChange: CssomListener): () => void {
  const restores: (() => void)[] = [];
  const wrapMethod = (
    proto: Record<string, unknown> | undefined,
    name: string,
    change: (target: never, result: unknown) => CssomChange,
  ) => {
    const original = proto?.[name];
    if (!proto || typeof original !== "function") return;
    // The page's sheets call these with themselves as `this`: no arrow function.
    const wrapped = function (this: never, ...args: unknown[]) {
      // Throws (a cross-origin sheet, an invalid rule) before anything changed.
      const result: unknown = original.apply(this, args);
      onChange(change(this, result));
      // replace() applies the rules later.
      if (result && typeof (result as Promise<unknown>).then === "function")
        (result as Promise<unknown>).then(
          () => onChange(change(this, result)),
          () => {},
        );
      return result;
    };
    proto[name] = wrapped;
    restores.push(() => {
      if (proto[name] === wrapped) proto[name] = original;
    });
  };
  const wrapSetter = (
    proto: object | undefined,
    name: string,
    change: (target: never) => CssomChange,
  ) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, name);
    // oxlint-disable-next-line typescript/unbound-method -- called with .call on the page's object
    const set = descriptor?.set;
    if (!proto || !descriptor?.configurable || !set) return;
    const wrapped = function (this: never, value: unknown) {
      set.call(this, value);
      onChange(change(this));
    };
    Object.defineProperty(proto, name, { ...descriptor, set: wrapped });
    restores.push(() => {
      // Not over a wrapper the page (or a polyfill) put there since.
      if (Object.getOwnPropertyDescriptor(proto, name)?.set === wrapped)
        Object.defineProperty(proto, name, descriptor);
    });
  };
  type Parent = CSSStyleSheet | CSSGroupingRule;
  const insert = (parent: Parent, index: unknown): CssomChange => ({
    kind: "insert",
    parent,
    index: index as number,
  });
  const remove = (parent: Parent): CssomChange => ({ kind: "delete", parent });
  const sheetChange = (sheet: CSSStyleSheet): CssomChange => ({ kind: "sheet", sheet });
  const sheet = window.CSSStyleSheet?.prototype as unknown as Record<string, unknown> | undefined;
  wrapMethod(sheet, "insertRule", insert);
  wrapMethod(sheet, "deleteRule", remove);
  wrapMethod(sheet, "removeRule", remove);
  for (const name of ["addRule", "replace", "replaceSync"]) wrapMethod(sheet, name, sheetChange);
  const grouping = (
    window as unknown as { CSSGroupingRule?: { prototype: Record<string, unknown> } }
  ).CSSGroupingRule?.prototype;
  wrapMethod(grouping, "insertRule", insert);
  wrapMethod(grouping, "deleteRule", remove);
  wrapSetter(window.StyleSheet?.prototype, "disabled", sheetChange);
  // Not reflected in an attribute: no MutationObserver sees it.
  const owner = (element: Element | Document): CssomChange => ({ kind: "owner", owner: element });
  wrapSetter(window.HTMLStyleElement?.prototype, "disabled", owner);
  wrapSetter(window.Document?.prototype, "adoptedStyleSheets", owner);
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

export class LiveInteractionCss {
  /**
   * The parts of the signature as last synced (see signatureParts), and where
   * each stylesheet's is. A sheet changed through the CSSOM and taken care of
   * right away has its own part brought up to date, and only that: what else
   * changed meanwhile (a sheet added, an @import loaded) still shows on the
   * next sync.
   */
  private parts: [CSSStyleSheet | null, string][] = [];
  private readonly partIndex = new Map<CSSStyleSheet, number>();
  private signature = "";
  /**
   * The stylesheets may have changed since the last sync. Reading them all
   * on every pointer move would be wasted work: the page says when (see
   * invalidate()), or the CSSOM does (watchStylesheets: a rule inserted is
   * rewritten right away, other changes are looked at on the next sync).
   */
  private stale = true;
  /** Set while syncing: the agent's own sheet changing is not the page's. */
  private syncing = false;
  /**
   * The page's adoptedStyleSheets when last synced. The list can be changed
   * in place (push, splice), which no setter sees: compared on every sync.
   */
  private adoptedList: readonly CSSStyleSheet[] = [];
  /** The text of the agent's own sheet, not replaced again when the same. */
  private adoptedCss = "";
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
    /** The page changed its stylesheets through the CSSOM: it may look different. */
    private readonly onChange: () => void = () => {},
  ) {
    this.window = document.defaultView as FrameWindow;
    this.unwatch = watchStylesheets(this.window, (change) => this.cssomChanged(change));
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
    this.parts = [];
    this.partIndex.clear();
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
    if (!this.stale && !this.adoptedListChanged()) return false;
    this.stale = false;
    this.adoptedList = this.pageAdoptedList();
    const sheets = pageStylesheets(this.document);
    const parts = signatureParts(sheets);
    const signature = parts.map(([, part]) => part).join("|");
    if (signature === this.signature) return false;
    this.parts = parts;
    this.partIndex.clear();
    parts.forEach(([sheet], i) => sheet && this.partIndex.set(sheet, i));
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

  /** What the page changed through the CSSOM, if it is in the document's stylesheets. */
  private cssomChanged(change: CssomChange): void {
    if (this.syncing) return;
    switch (change.kind) {
      case "insert": {
        const sheet = this.pageSheetOf(change.parent);
        if (!sheet) return;
        const rule = change.parent.cssRules[change.index];
        // Only the rule inserted is rewritten, not all the page's (CSS-in-JS inserts rules all the time).
        // It could be inserted: the sheet is readable.
        if (rule && !(rule instanceof this.window.CSSImportRule)) {
          this.syncing = true;
          try {
            this.rewrite([rule], [], new Set());
          } finally {
            this.syncing = false;
          }
          this.sheetChanged(sheet);
        } else {
          this.reset();
        }
        break;
      }
      case "delete": {
        const sheet = this.pageSheetOf(change.parent);
        if (!sheet) return;
        // Nothing to rewrite.
        this.sheetChanged(sheet);
        break;
      }
      case "sheet":
        if (!this.pageSheetOf(change.sheet)) return;
        this.reset();
        break;
      case "owner":
        if (change.owner !== this.document && change.owner.ownerDocument !== this.document) return;
        this.invalidate();
        break;
    }
    this.onChange();
  }

  /**
   * A sheet changed only in what was taken care of already: its part of the
   * signature is brought up to date, so that the next sync does not look at
   * everything again. A sheet not synced yet is left for the next sync.
   */
  private sheetChanged(sheet: CSSStyleSheet): void {
    const index = this.partIndex.get(sheet);
    if (index === undefined) return;
    this.parts[index] = [sheet, sheetSignature(sheet)];
    this.signature = this.parts.map(([, part]) => part).join("|");
  }

  /**
   * The stylesheet `parent` is (or is in), if it is one of the page's, or
   * one they import; null if not (a shadow root's, say).
   */
  private pageSheetOf(parent: CSSStyleSheet | CSSRule): CSSStyleSheet | null {
    const own = parent instanceof this.window.CSSStyleSheet ? parent : parent.parentStyleSheet;
    if (!own) return null;
    // The sheets synced last, without listing the page's again (CSS-in-JS inserts rules all the time).
    if (this.partIndex.has(own)) return own;
    let top = own;
    while (top.ownerRule?.parentStyleSheet) top = top.ownerRule.parentStyleSheet;
    return pageStylesheets(this.document).includes(top) ? own : null;
  }

  private pageAdoptedList(): readonly CSSStyleSheet[] {
    const adopted = (this.document as Document & { adoptedStyleSheets?: CSSStyleSheet[] })
      .adoptedStyleSheets;
    return adopted ? adopted.filter((sheet) => !agentSheets.has(sheet)) : [];
  }

  private adoptedListChanged(): boolean {
    const list = this.pageAdoptedList();
    return (
      list.length !== this.adoptedList.length ||
      list.some((sheet, i) => sheet !== this.adoptedList[i])
    );
  }

  /** Puts the page's selectors and the CSSOM back. */
  dispose(): void {
    this.syncing = true;
    for (const [rule, selector] of this.originals) rule.selectorText = selector;
    this.originals.clear();
    this.adopt("");
    this.unwatch();
    this.reset();
  }

  /** Rewrites a sheet in place, or, if the page cannot edit it, copies its interaction rules out. */
  private syncSheet(
    source: CSSStyleSheet,
    media: string,
    copied: string[],
    visited: Set<CSSStyleSheet>,
  ): void {
    // Its copy would not be used: not fetched for nothing.
    if (source.disabled && ruleCount(source) < 0) return;
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

  private rewrite(rules: ArrayLike<CSSRule>, copied: string[], visited: Set<CSSStyleSheet>): void {
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
      this.adoptedCss = "";
      return;
    }
    const sheet = current ?? new this.window.CSSStyleSheet();
    agentSheets.add(sheet);
    // Replacing a sheet's rules restyles the whole document: only when they changed.
    if (css !== this.adoptedCss || !current) sheet.replaceSync(css);
    this.adoptedCss = css;
    this.adopted = sheet;
    // The page may have replaced the list (adoptedStyleSheets = [...]) since.
    if (!document.adoptedStyleSheets.includes(sheet))
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
}
