// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DocumentCss } from "./css";

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

describe("DocumentCss", () => {
  it("copies the rules of the @media blocks that match the page, and only those", () => {
    // What the page's window says matches (jsdom has no matchMedia).
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width") }));
    document.head.innerHTML =
      "<style>@media (min-width: 1px) { .wide { color: red } } @media print { .printed { color: blue } }</style>";
    const css = new DocumentCss(document, () => null).get();
    expect(css).toContain(".wide");
    expect(css).not.toContain(".printed");
  });

  it("rewrites the selectors of nested rules, not the text of declarations", () => {
    document.head.innerHTML =
      '<style>.tip { content: "use :hover"; &:hover { opacity: 1 } }</style>';
    const css = new DocumentCss(document, () => null).get();
    expect(css).toContain("&:is(:hover,[data-thp-hover])");
    expect(css).toContain('"use :hover"');
  });

  it("draws the default focus ring of a field only where focus shows", () => {
    const css = new DocumentCss(document, () => null).get();
    expect(css).toContain("select[data-thp-focus-visible]");
    expect(css).not.toContain("select[data-thp-focus]");
  });
});
