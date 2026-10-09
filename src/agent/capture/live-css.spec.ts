// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { LiveInteractionCss } from "./live-css";

let live: LiveInteractionCss | null = null;

afterEach(() => {
  live?.dispose();
  live = null;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

const ROW = `<div class="row"><span class="tools"><button>Act</button></span></div>`;
const display = () => getComputedStyle(document.querySelector(".tools")!).display;
const selectors = (sheet = 0) =>
  Array.from(document.styleSheets[sheet]!.cssRules).map(
    (rule) => (rule as CSSStyleRule).selectorText,
  );

function setUp(css: string): void {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = ROW;
  live = new LiveInteractionCss(document);
  live.sync();
}

describe("LiveInteractionCss", () => {
  it("makes the page's :hover rules match the hover mark, in place", () => {
    setUp(".tools { display: none } .row:hover .tools { display: flex } .other { color: red }");
    expect(display()).toBe("none");
    document.querySelector(".row")!.setAttribute("data-thp-hover", "");
    expect(display()).toBe("flex");
    // The same rules, in the same order: only the interaction selector changed.
    expect(selectors()).toEqual([".tools", ".row:is(:hover,[data-thp-hover]) .tools", ".other"]);
  });

  it("takes in a rule the page inserts into an @media block", () => {
    setUp(".tools { display: none } @media all { .x { color: red } }");
    document.querySelector(".row")!.setAttribute("data-thp-hover", "");
    const media = document.styleSheets[0]!.cssRules[1] as CSSMediaRule;
    media.insertRule(".row:hover .tools { display: flex }", 1);
    live!.sync();
    expect(display()).toBe("flex");
  });

  it("rewrites rules in @media blocks, and each rule only once", () => {
    setUp("@media all { .row:focus-within .tools { display: flex } }");
    live!.sync();
    live!.reset();
    live!.sync();
    const media = document.styleSheets[0]!.cssRules[0] as CSSMediaRule;
    expect((media.cssRules[0] as CSSStyleRule).selectorText).toBe(
      ".row:is(:focus-within,[data-thp-focus-within]) .tools",
    );
  });

  it("takes in rules and stylesheets the page adds later", () => {
    setUp(".tools { display: none }");
    const row = document.querySelector(".row")!;
    row.setAttribute("data-thp-hover", "");
    // Nothing changed: nothing read again.
    expect(live!.sync()).toBe(false);
    // Through the CSSOM, which no MutationObserver sees.
    document.styleSheets[0]!.insertRule(".row:hover .tools { display: flex }", 1);
    expect(display()).toBe("none");
    expect(live!.sync()).toBe(true);
    expect(display()).toBe("flex");

    const style = document.createElement("style");
    style.textContent = ".row:hover .tools { display: grid }";
    document.head.append(style);
    live!.invalidate();
    live!.sync();
    expect(display()).toBe("grid");
    // The page's <style> replaced by one with as many rules.
    style.textContent = ".row:hover .tools { display: block }";
    live!.invalidate();
    live!.sync();
    expect(display()).toBe("block");
  });

  it("rewrites the other selectors of a list with an interaction after a pseudo-element", () => {
    setUp(
      ".tools { display: none } .row:hover .tools, .bar::-webkit-scrollbar-thumb:hover { display: flex }",
    );
    // (jsdom cannot match a list with that pseudo-element at all.)
    expect(selectors()[1]).toBe(
      ".row:is(:hover,[data-thp-hover]) .tools, .bar::-webkit-scrollbar-thumb:hover",
    );
  });

  it("copies the interaction rules of a sheet the page cannot read into a sheet of its own", () => {
    // jsdom has no adoptedStyleSheets; the browsers do.
    Object.defineProperty(document, "adoptedStyleSheets", {
      configurable: true,
      writable: true,
      value: [],
    });
    try {
      document.head.innerHTML = "<style>.tools { display: none }</style>";
      document.body.innerHTML = ROW;
      // What DocumentCss fetched with CORS, standing in for the unreadable sheet.
      const copy = new CSSStyleSheet();
      copy.replaceSync(
        "@media all { .row:hover .tools { display: flex } } .plain { color: red }" +
          " @layer ui { .menu:focus-within .list { display: block } }" +
          ' .tip { content: "use :hover"; color: gray; &:hover { opacity: 1 } }',
      );
      live = new LiveInteractionCss(document, (sheet) =>
        sheet === document.styleSheets[0] ? copy : null,
      );
      live.sync();
      const adopted = (document as unknown as { adoptedStyleSheets: CSSStyleSheet[] })
        .adoptedStyleSheets;
      expect(adopted).toHaveLength(1);
      const css = Array.from(adopted[0]!.cssRules, (rule) => rule.cssText).join(" ");
      expect(css).toContain(".row:is(:hover,[data-thp-hover]) .tools");
      expect(css).not.toContain(".plain");
      // In the block it is in, whatever block that is.
      expect(css).toMatch(
        /@layer ui\s*\{\s*\.menu:is\(:focus-within,\[data-thp-focus-within\]\) \.list/,
      );
      // A nested rule's selector, not the declarations' text; and not its parent's own declarations.
      expect(css).toContain("&:is(:hover,[data-thp-hover])");
      expect(css).not.toContain("use :is(");
      expect(css).not.toContain("gray");
      // The copy is DocumentCss's, for the image: left as it was.
      const media = copy.cssRules[0] as CSSMediaRule;
      expect((media.cssRules[0] as CSSStyleRule).selectorText).toBe(".row:hover .tools");
      live.dispose();
      live = null;
      expect(
        (document as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets,
      ).toHaveLength(0);
    } finally {
      delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
    }
  });

  it("rewrites a disabled sheet too, for when the page enables it", () => {
    document.head.innerHTML = `<style>.tools { display: none }</style><style>.row:hover .tools { display: flex }</style>`;
    document.body.innerHTML = ROW;
    document.styleSheets[1]!.disabled = true;
    live = new LiveInteractionCss(document);
    live.sync();
    // (jsdom applies disabled sheets anyway: the selector is checked instead.)
    expect(selectors(1)).toEqual([".row:is(:hover,[data-thp-hover]) .tools"]);
  });

  it("rewrites the page's own adopted stylesheets, and keeps its own sheet out of the page's", () => {
    const adopted: CSSStyleSheet[] = [];
    Object.defineProperty(document, "adoptedStyleSheets", {
      configurable: true,
      get: () => adopted,
      set: (sheets: CSSStyleSheet[]) => adopted.splice(0, adopted.length, ...sheets),
    });
    try {
      const own = new CSSStyleSheet();
      own.replaceSync(".tools { display: none } .row:hover .tools { display: flex }");
      adopted.push(own);
      document.body.innerHTML = ROW;
      live = new LiveInteractionCss(document);
      live.sync();
      expect((own.cssRules[1] as CSSStyleRule).selectorText).toBe(
        ".row:is(:hover,[data-thp-hover]) .tools",
      );
    } finally {
      delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
    }
  });

  it("forgets the rules of a <style> the page removed", () => {
    setUp(".row:hover .tools { display: flex }");
    const sheet = document.styleSheets[0]!;
    const rule = sheet.cssRules[0] as CSSStyleRule;
    document.head.innerHTML = "";
    live!.invalidate();
    live!.sync();
    live!.dispose();
    live = null;
    // Not written back into the sheet the page dropped.
    expect(rule.selectorText).toBe(".row:is(:hover,[data-thp-hover]) .tools");
  });

  it("puts the page's selectors back when disposed", () => {
    setUp(".row:hover .tools { display: flex }");
    live!.dispose();
    expect(selectors()).toEqual([".row:hover .tools"]);
  });
});
