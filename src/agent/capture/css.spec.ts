import { describe, expect, it } from "vite-plus/test";
import { inlineCssUrls, rewriteSelector } from "./css";

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
