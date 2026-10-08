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

  it("rewrites rules in @media blocks, and each rule only once", () => {
    setUp("@media all { .row:focus-within .tools { display: flex } }");
    live!.sync();
    live!.invalidate();
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
    document.styleSheets[0]!.insertRule(".row:hover .tools { display: flex }", 1);
    expect(display()).toBe("none");
    live!.sync();
    expect(display()).toBe("flex");

    const style = document.createElement("style");
    style.textContent = ".row:hover .tools { display: grid }";
    document.head.append(style);
    live!.sync();
    expect(display()).toBe("grid");
    // The page's <style> replaced by one with as many rules.
    style.textContent = ".row:hover .tools { display: block }";
    live!.sync();
    expect(display()).toBe("block");
  });

  it("puts the page's selectors back when disposed", () => {
    setUp(".row:hover .tools { display: flex }");
    live!.dispose();
    expect(selectors()).toEqual([".row:hover .tools"]);
  });
});
