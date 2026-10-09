import { describe, expect, it } from "vite-plus/test";
import { inlineCssUrls, liveSelector, rewriteSelector } from "./css";

describe("rewriteSelector", () => {
  it("turns interaction pseudo-classes into attributes", () => {
    expect(rewriteSelector("a:hover, b:active")).toBe("a[data-thp-hover], b[data-thp-active]");
  });

  it("keeps :focus, :focus-visible and :focus-within apart", () => {
    expect(rewriteSelector("input:focus")).toBe("input[data-thp-focus]");
    expect(rewriteSelector("input:focus-visible")).toBe("input[data-thp-focus]");
    expect(rewriteSelector(".card:focus-within")).toBe(".card[data-thp-focus-within]");
  });

  it("maps :root to html", () => {
    expect(rewriteSelector(":root")).toBe("html");
  });

  it("leaves other pseudo-classes alone", () => {
    expect(rewriteSelector("li:hover-like, a:hovered, p:not(:first-child)")).toBe(
      "li:hover-like, a:hovered, p:not(:first-child)",
    );
  });
});

describe("liveSelector", () => {
  it("lets each interaction pseudo-class also match its attribute", () => {
    expect(liveSelector(".row:hover .tools, a:active")).toBe(
      ".row:is(:hover,[data-thp-hover]) .tools, a:is(:active,[data-thp-active])",
    );
    expect(liveSelector("form:focus-within .hint, input:focus, input:focus-visible")).toBe(
      "form:is(:focus-within,[data-thp-focus-within]) .hint, input:is(:focus,[data-thp-focus]), input:is(:focus-visible,[data-thp-focus])",
    );
    expect(liveSelector("li:not(:hover)")).toBe("li:not(:is(:hover,[data-thp-hover]))");
  });

  it("leaves an interaction after a pseudo-element, which neither :is() nor an attribute may follow", () => {
    expect(liveSelector(".row:hover .tools, .bar::-webkit-scrollbar-thumb:hover")).toBe(
      ".row:is(:hover,[data-thp-hover]) .tools, .bar::-webkit-scrollbar-thumb:hover",
    );
    expect(liveSelector("x-menu::part(item):hover")).toBeNull();
    // Not a pseudo-element: inside an attribute's value, or an argument.
    expect(liveSelector('[title="a::b"]:hover')).toBe('[title="a::b"]:is(:hover,[data-thp-hover])');
    expect(rewriteSelector(".bar::-webkit-scrollbar-thumb:hover, a:hover")).toBe(
      ".bar::-webkit-scrollbar-thumb:hover, a[data-thp-hover]",
    );
  });

  it("is null for selectors without them, or rewritten already", () => {
    expect(liveSelector("li:hover-like, p:first-child")).toBeNull();
    expect(liveSelector(".row:is(:hover, [data-thp-hover])")).toBeNull();
  });

  it("is rewritten for the image as the page's own selector is", () => {
    expect(rewriteSelector(liveSelector(".row:hover .tools")!)).toBe(
      ".row:is([data-thp-hover],[data-thp-hover]) .tools",
    );
  });
});

describe("inlineCssUrls", () => {
  it("replaces resolvable urls and drops the rest", () => {
    const resolve = (url: string) =>
      url === "https://example.test/a.png" ? "data:image/png;base64,AA" : null;
    expect(
      inlineCssUrls(
        "a{background:url(a.png)} b{background:url('b.png')}",
        "https://example.test/",
        resolve,
      ),
    ).toBe('a{background:url("data:image/png;base64,AA")} b{background:none}');
  });

  it("keeps data urls", () => {
    expect(
      inlineCssUrls(
        'a{background:url("data:image/gif;base64,R0")}',
        "https://example.test/",
        () => null,
      ),
    ).toBe('a{background:url("data:image/gif;base64,R0")}');
  });
});
