// Copies the live page into an XHTML string that can go inside an SVG
// <foreignObject>.
//
// Serializing the DOM is not enough on its own, because a lot of what is on
// screen is not in the markup:
//
// - form state (value, checked, selected) lives in properties, not attributes
// - scroll positions are not rendered by foreignObject at all, and the real
//   scrollbars would not show them either: they are replaced (scrollbars.ts)
// - interaction states (:hover, :focus) are expressed as attributes, see css.ts
// - animations are frozen: finite ones as they will end, the others as they are
//   now (see collectAnimatedValues)
// - images and canvases must be embedded as data URLs, and a video as its
//   current frame
//
// The copy is built in an inert document, so <img> elements in it never start
// loading anything.
//
// Type checks on live elements use the page's window (see FrameWindow).

import type { Box, FrameWindow } from "../../types";
import { scrolledText } from "../input/caret";
import { scrollbarsOf, type Scrollbar } from "../input/scrollbars";
import type { PopupView } from "../input/select-popup";
import { ACTIVE_ATTRIBUTE, FOCUS_ATTRIBUTE, FOCUS_WITHIN_ATTRIBUTE, HOVER_ATTRIBUTE } from "./css";

/** Elements that do not contribute to what is on screen. <style> is collected separately. */
const SKIPPED_ELEMENTS = new Set([
  "SCRIPT",
  "NOSCRIPT",
  "TEMPLATE",
  "STYLE",
  "LINK",
  "META",
  "TITLE",
  "BASE",
  "IFRAME",
]);

export interface SnapshotOptions {
  hovered: ReadonlySet<Element>;
  active: ReadonlySet<Element>;
  focused: Element | null;
  /** Elements added to the page only for measuring (e.g. the caret mirror); left out of the copy. */
  ignored?: ReadonlySet<Element>;
  /** Returns a data URL for an image, or null if it is not available yet. */
  inlineImage: (url: string) => string | null;
  /** The selected text in the focused field, as measured by measureSelection(). */
  selection?: readonly Box[];
  /** The page's ::selection background, if any; a default is used when it is transparent. */
  selectionColor?: string;
  /** The selection is not where the keys go (the panel is not active): drawn grey, as browsers do. */
  selectionInactive?: boolean;
  /**
   * Text being composed with an IME in a field: the value it shows while
   * composing, which goes into the copy only (never into the page), and the
   * boxes the composed text covers, underlined.
   */
  composition?: { field: Element; value: string; boxes: readonly Box[]; color: string } | null;
  /**
   * Text being composed with an IME in a contenteditable element: shown, in the
   * copy only, where the selection starts (in place of the selected text when
   * that is within one text node), underlined.
   */
  inlineComposition?: { node: Node; offset: number; endOffset: number; text: string } | null;
  /** The scrollbar being hovered or pressed, drawn darker. */
  scrollbar?: { element: Element; axis: "x" | "y"; state: "hover" | "active" } | null;
  /** The open list of a <select>, drawn over everything. */
  selectPopup?: PopupView | null;
  /**
   * The selected options of a focused list box, drawn over the copy as a
   * focused one's: the copy is never focused, and browsers draw its selection
   * in their inactive grey (WebKit whatever the page's CSS says).
   */
  listBoxSelection?: readonly ListBoxRow[];
}

/** A selected option of a focused list box: where it shows (cut by the box), where it is, and its label. */
export interface ListBoxRow {
  shown: Box;
  box: Box;
  label: string;
  font: string;
  paddingLeft: number;
}

/** Selected options of a focused list box, as browsers draw them. */
const LIST_BOX_SELECTED = "rgb(30 110 220)";

/** The last frame encoded for each video, with what it was taken at (see Snapshotter.videoFrame). */
const videoFrames = new WeakMap<
  HTMLVideoElement,
  { key: string; source: MediaProvider | string; url: string | null }
>();

/** A video's current frame at this size, as a JPEG data URL; null if it cannot be read. */
function encodeFrame(
  document: Document,
  video: HTMLVideoElement,
  width: number,
  height: number,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    // A video from another origin without CORS taints the canvas.
    return null;
  }
}

/** A video's attributes that mean nothing on the image that stands for it. */
const VIDEO_ATTRIBUTES = new Set([
  "src",
  "poster",
  "controls",
  "autoplay",
  "loop",
  "muted",
  "preload",
  "playsinline",
  "crossorigin",
]);
/** A video frame is drawn at most this many times its size on the page (the panel's pixel ratio is not known here). */
const VIDEO_SCALE = 2;

const toKebabCase = (property: string) =>
  property.startsWith("--")
    ? property
    : property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const KEYFRAME_META_KEYS = new Set(["offset", "computedOffset", "easing", "composite"]);

/** Whether `animation` is a CSS transition. Checked by shape: the page is another realm in tests. */
const isTransition = (animation: Animation) => "transitionProperty" in animation;

/**
 * Which end of its keyframes (0 or 1) a finite animation stops at, from its
 * direction and iteration count; null if it does not stop at an end (infinite,
 * or a fractional count such as 1.5).
 */
export function endOffsetOf(timing: EffectTiming): 0 | 1 | null {
  const iterations = timing.iterations ?? 1;
  if (!Number.isInteger(iterations) || iterations < 1) return null;
  const last = iterations - 1;
  const reversed =
    timing.direction === "reverse" ||
    (timing.direction === "alternate" && last % 2 === 1) ||
    (timing.direction === "alternate-reverse" && last % 2 === 0);
  return reversed ? 0 : 1;
}

/** Whether an animation's value is copied as it is now, so the panel must keep sampling it. */
export function isSampledLive(animation: Animation): boolean {
  if (isTransition(animation)) return false;
  const effect = animation.effect as KeyframeEffect | null;
  return animation.playState === "paused" || endOffsetOf(effect?.getTiming?.() ?? {}) === null;
}

/**
 * The animated values to bake into each element's copy: property (kebab-case)
 * to value, where null means the live document's value now.
 *
 * Browsers can hold back rendering in the panel's iframe (to them it is a
 * cross-origin frame the user never touches), for up to a second in Chrome,
 * and animations do not advance meanwhile. Copying their values now would show
 * a fade-in still transparent long after it should have ended. So animations
 * that end are copied as they will be at the end:
 * - transitions, and animations that do not fill forwards, end on the element's
 *   own style, which the image shows anyway: nothing is baked
 * - animations that fill forwards (or both) end on their last keyframe
 * - animations that repeat forever, and paused ones, are copied as they are now
 * Pseudo-element animations cannot go into an inline style and are left out.
 */
function collectAnimatedValues(document: Document): Map<Element, Map<string, string | null>> {
  const result = new Map<Element, Map<string, string | null>>();
  if (typeof document.getAnimations !== "function") return result;
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    if (!effect?.target || effect.pseudoElement || typeof effect.getKeyframes !== "function")
      continue;
    if (isTransition(animation)) continue;
    let values = result.get(effect.target);
    if (!values) result.set(effect.target, (values = new Map()));
    const keyframes = effect.getKeyframes();

    if (isSampledLive(animation)) {
      for (const keyframe of keyframes) {
        for (const key of Object.keys(keyframe))
          if (!KEYFRAME_META_KEYS.has(key)) values.set(toKebabCase(key), null);
      }
      continue;
    }
    const timing = effect.getTiming();
    if (timing.fill !== "forwards" && timing.fill !== "both") continue;
    // A property missing from the end keyframe ends on the element's own style.
    const endOffset = endOffsetOf(timing);
    for (const keyframe of keyframes) {
      if (keyframe.computedOffset !== endOffset) continue;
      for (const [key, value] of Object.entries(keyframe)) {
        if (!KEYFRAME_META_KEYS.has(key) && typeof value === "string")
          values.set(toKebabCase(key), value);
      }
    }
  }
  return result;
}

/** An absolute or fixed element's copy, and its containing block on the page (see Snapshotter.absoluteContainer). */
interface Positioned {
  copy: Element;
  fixed: boolean;
  container: Element | null;
}

const isStyled = (element: Element): element is HTMLElement | SVGElement =>
  element instanceof HTMLElement || element instanceof SVGElement;

const isSet = (value: string | undefined) => !!value && value !== "none";

/** Whether a box is the containing block of the fixed elements in it (and so of absolute ones). */
function containsFixed(style: CSSStyleDeclaration): boolean {
  return (
    isSet(style.transform) ||
    isSet(style.translate) ||
    isSet(style.rotate) ||
    isSet(style.scale) ||
    isSet(style.perspective) ||
    isSet(style.filter) ||
    isSet(style.backdropFilter) ||
    /paint|layout|strict|content/.test(style.contain ?? "") ||
    /transform|translate|rotate|scale|perspective|filter/.test(style.willChange ?? "") ||
    (isSet(style.containerType) && style.containerType !== "normal") ||
    style.contentVisibility === "auto"
  );
}

/**
 * Moves a positioned box by its insets: (dx, dy) for an absolute or fixed one,
 * or its insets the other way for a sticky one ((dx, dy) being the scroll). An
 * absolute one with both insets of an axis auto (at its place in the flow) is
 * moved by its margin.
 */
function moveInsets(
  copy: HTMLElement | SVGElement,
  style: CSSStyleDeclaration,
  dx: number,
  dy: number,
  byMargin = true,
): void {
  const axes = [
    ["top", "bottom", "margin-top", dy],
    ["left", "right", "margin-left", dx],
  ] as const;
  for (const [start, end, margin, by] of axes) {
    if (by === 0) continue;
    // A bare 0 (as jsdom gives it) is not a length inside calc().
    const value = (property: string) => {
      const value = style.getPropertyValue(property);
      return value === "0" ? "0px" : value;
    };
    const auto = (value: string) => value === "" || value === "auto";
    const from = value(start);
    const to = value(end);
    if (!auto(from)) copy.style.setProperty(start, `calc(${from} + ${by}px)`, "important");
    if (!auto(to)) copy.style.setProperty(end, `calc(${to} - ${by}px)`, "important");
    if (auto(from) && auto(to) && byMargin && style.position !== "sticky") {
      // A used margin, in px.
      const used = parseFloat(style.getPropertyValue(margin)) || 0;
      copy.style.setProperty(margin, `${used + by}px`, "important");
    }
  }
}

/** Displays of a scroll container that lays out its children as blocks (in a flow of its own). */
const BLOCK_CONTAINER = /^(block|inline-block|flow-root|list-item|table-cell|table-caption)$/;

/** Block-level displays: boxes of a block container's flow, not in lines. */
const BLOCK_LEVEL = /^(block|list-item|table|flex|grid|flow-root|-webkit-box)$/;

/** What a pinned element keeps as the page has it, from its own containing block there. */
const PINNED_SIZES = [
  "width",
  "height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
];

class Snapshotter {
  // A separate document without a browsing context, so the copies never load anything.
  private readonly inert = globalThis.document.implementation.createHTMLDocument("");
  private readonly window: FrameWindow;
  private readonly animated: Map<Element, Map<string, string | null>>;
  private readonly focusWithin = new Set<Element>();
  /** The page's element each copy is of. */
  private readonly liveOf = new WeakMap<Element, Element>();
  /** And the other way. */
  private readonly copies = new WeakMap<Element, Element>();
  /** The computed style of each element copied, read once. */
  private readonly styles = new Map<Element, CSSStyleDeclaration>();
  /** The absolute and fixed elements copied, by the page's element. */
  private readonly positioned = new Map<Element, Positioned>();
  /** The elements with fixed ones in them placed from outside them. */
  private readonly holdingFixed = new Set<Element>();
  /**
   * Copies moved for a scroll, and how: positioned relatively (the containing
   * block of absolute elements in them, now) or translated (of fixed ones too).
   */
  private readonly moved = new Map<Element, "relative" | "translated">();
  /**
   * The page's containing blocks of absolute and fixed elements where the copy
   * is now; null for the initial containing block (absolute) or the viewport (fixed).
   */
  private absoluteContainer: Element | null = null;
  private fixedContainer: Element | null = null;
  /** Scrollbars to draw over the copy. */
  readonly scrollbars: Scrollbar[] = [];

  constructor(
    private readonly document: Document,
    private readonly options: SnapshotOptions,
  ) {
    this.window = document.defaultView as FrameWindow;
    this.animated = collectAnimatedValues(document);
    for (let element = options.focused; element; element = element.parentElement)
      this.focusWithin.add(element);
  }

  copy(live: Node): Node | null {
    if (live.nodeType === Node.TEXT_NODE) {
      const composition = this.options.inlineComposition;
      if (composition?.node === live) return this.composedText(live as Text, composition);
      return this.inert.importNode(live, false);
    }
    if (live.nodeType !== Node.ELEMENT_NODE) return null;
    const element = live as Element;
    if (SKIPPED_ELEMENTS.has(element.tagName) || this.options.ignored?.has(element)) return null;
    const style = this.window.getComputedStyle(element);
    this.styles.set(element, style);

    if (element instanceof this.window.HTMLCanvasElement)
      return this.remember(element, style, this.copyCanvas(element));
    if (element instanceof this.window.HTMLVideoElement)
      return this.remember(element, style, this.copyVideo(element));

    const copy = this.remember(element, style, this.inert.importNode(element, false) as Element);
    this.copyFormState(element, copy);
    this.copyImage(element, copy);
    this.copyInteractionState(element, copy);
    this.copyAnimatedValues(element, copy);

    // <head> carries no visible content, but keep the element so the structure stays valid.
    if (element.tagName === "HEAD") return copy;

    const outer = [this.absoluteContainer, this.fixedContainer] as const;
    if (containsFixed(style)) this.absoluteContainer = this.fixedContainer = element;
    else if (style.position !== "static") this.absoluteContainer = element;
    const children = element.tagName === "TEXTAREA" ? [] : Array.from(element.childNodes);
    // Composed text between two children (an empty line of an editable, say).
    const composition = this.options.inlineComposition;
    const composedAt = composition?.node === element ? composition.offset : -1;
    children.forEach((child, index) => {
      if (index === composedAt) copy.appendChild(this.composedSpan(composition!.text));
      const childCopy = this.copy(child);
      if (childCopy) copy.appendChild(childCopy);
    });
    if (composedAt === children.length) copy.appendChild(this.composedSpan(composition!.text));
    [this.absoluteContainer, this.fixedContainer] = outer;
    this.copyScroll(element, copy);
    this.hideScrollbars(element, copy, style);
    return copy;
  }

  /** Notes what a copy is of, and where it is positioned from if it is absolute or fixed. */
  private remember<T extends Node | null>(live: Element, style: CSSStyleDeclaration, copy: T): T {
    if (!(copy instanceof Element)) return copy;
    this.liveOf.set(copy, live);
    this.copies.set(live, copy);
    const fixed = style.position === "fixed";
    if (fixed || style.position === "absolute") {
      const container = fixed ? this.fixedContainer : this.absoluteContainer;
      this.positioned.set(live, { copy, fixed, container });
      if (fixed) {
        for (let box = live.parentElement; box && box !== container; box = box.parentElement)
          this.holdingFixed.add(box);
      }
    }
    return copy;
  }

  private copyFormState(element: Element, copy: Element): void {
    const { HTMLInputElement, HTMLTextAreaElement, HTMLOptionElement, HTMLSelectElement } =
      this.window;
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") {
        copy.toggleAttribute("checked", element.checked);
      } else if (element.type !== "file") {
        const value = this.shownValue(element);
        copy.setAttribute("value", value);
        // Only text inputs have a selection, and scroll their text.
        if (element.selectionStart !== null) this.copyTextScroll(element, copy, value);
      }
    } else if (element instanceof HTMLTextAreaElement) {
      const value = this.shownValue(element);
      copy.textContent = value;
      this.copyTextScroll(element, copy, value);
    } else if (element instanceof HTMLOptionElement) {
      copy.toggleAttribute("selected", element.selected);
    } else if (element instanceof HTMLSelectElement && copy instanceof HTMLElement) {
      // A <select> sizes itself to its options (and a list box to its
      // scrollbar, which the copy hides): Firefox draws the copy narrower than
      // the page's, moving what follows it. Keep the page's size: its layout
      // size, before transforms (which the copy applies again).
      const { offsetWidth, offsetHeight } = element;
      if (offsetWidth > 0 && offsetHeight > 0) {
        copy.style.setProperty("box-sizing", "border-box", "important");
        copy.style.setProperty("width", `${offsetWidth}px`, "important");
        copy.style.setProperty("height", `${offsetHeight}px`, "important");
      }
    }
  }

  /**
   * A text field's own scroll is not drawn either. Leave out the text scrolled
   * past and move the rest into place with the padding (measured, see
   * scrolledText). A line only partly scrolled past is left out whole.
   */
  private copyTextScroll(
    field: HTMLInputElement | HTMLTextAreaElement,
    copy: Element,
    value: string,
  ): void {
    const scrolled = scrolledText(field);
    if (!scrolled || !(copy instanceof HTMLElement)) return;
    const isInput = field.tagName === "INPUT";
    const rest = value.slice(scrolled.index);
    if (isInput) copy.setAttribute("value", rest);
    else copy.textContent = rest;
    const side = isInput ? "padding-left" : "padding-top";
    const padding = parseFloat(this.window.getComputedStyle(field).getPropertyValue(side)) || 0;
    copy.style.setProperty(side, `${padding + scrolled.offset}px`, "important");
  }

  /** A field's value, or what it shows while text is composed in it. */
  private shownValue(field: HTMLInputElement | HTMLTextAreaElement): string {
    const composition = this.options.composition;
    return composition?.field === field ? composition.value : field.value;
  }

  private copyImage(element: Element, copy: Element): void {
    if (!(element instanceof this.window.HTMLImageElement)) return;
    copy.removeAttribute("srcset");
    copy.removeAttribute("loading");
    const source = element.currentSrc || element.src;
    const dataUrl = source ? this.options.inlineImage(source) : null;
    if (dataUrl) copy.setAttribute("src", dataUrl);
    else copy.removeAttribute("src");
  }

  private copyCanvas(canvas: HTMLCanvasElement): Node | null {
    const image = this.inert.createElement("img");
    for (const attribute of Array.from(canvas.attributes))
      image.setAttribute(attribute.name, attribute.value);
    try {
      image.setAttribute("src", canvas.toDataURL());
    } catch {
      // A canvas tainted by cross-origin content cannot be read.
    }
    const { width, height } = canvas.getBoundingClientRect();
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    return image;
  }

  private composedSpan(text: string): Element {
    const span = this.inert.createElement("span");
    span.setAttribute("style", "text-decoration: underline");
    span.textContent = text;
    return span;
  }

  /** A text node with the composed text in it, in place of what the composition replaces. */
  private composedText(
    text: Text,
    composition: NonNullable<SnapshotOptions["inlineComposition"]>,
  ): Node {
    const fragment = this.inert.createDocumentFragment();
    fragment.append(
      text.data.slice(0, composition.offset),
      this.composedSpan(composition.text),
      text.data.slice(composition.endOffset),
    );
    return fragment;
  }

  /** A video, as an image of the frame it shows (its poster before it plays). */
  private copyVideo(video: HTMLVideoElement): Node {
    const image = this.inert.createElement("img");
    for (const attribute of Array.from(video.attributes)) {
      if (!VIDEO_ATTRIBUTES.has(attribute.name))
        image.setAttribute(attribute.name, attribute.value);
    }
    const showsPoster = video.poster !== "" && video.paused && video.currentTime === 0;
    const poster = video.poster ? this.options.inlineImage(video.poster) : null;
    const source = showsPoster
      ? (poster ?? this.videoFrame(video))
      : (this.videoFrame(video) ?? poster);
    if (source) image.setAttribute("src", source);
    const { width, height } = video.getBoundingClientRect();
    const computed = this.window.getComputedStyle(video);
    image.style.setProperty("box-sizing", "border-box");
    image.style.setProperty("width", `${width}px`);
    image.style.setProperty("height", `${height}px`);
    // A video letterboxes its frame by default; an image would stretch it.
    image.style.setProperty("object-fit", computed.objectFit);
    image.style.setProperty("object-position", computed.objectPosition);
    this.copyInteractionState(video, image);
    return image;
  }

  /** The frame a video shows now, as a data URL; null before it has one, or if it cannot be read (cross-origin). */
  /**
   * The frame a video shows now, as a data URL; null before it has one, or if
   * it cannot be read (cross-origin). Encoding a frame takes milliseconds, so a
   * frame that has not changed (a paused video, at the same time and size, of
   * the same source) is not encoded again.
   */
  private videoFrame(video: HTMLVideoElement): string | null {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const { width } = video.getBoundingClientRect();
    const scale = Math.min(1, (VIDEO_SCALE * Math.max(1, width)) / video.videoWidth);
    const frameWidth = Math.max(1, Math.round(video.videoWidth * scale));
    const frameHeight = Math.max(1, Math.round(video.videoHeight * scale));
    const key = `${video.currentTime} ${video.videoWidth}x${video.videoHeight} ${frameWidth}x${frameHeight}`;
    // Another clip or stream at the same time and size (a page swapping src or srcObject) is another frame.
    const source = video.srcObject ?? video.currentSrc;
    const cached = videoFrames.get(video);
    if (cached?.key === key && cached.source === source) return cached.url;
    const url = encodeFrame(this.document, video, frameWidth, frameHeight);
    videoFrames.set(video, { key, source, url });
    return url;
  }

  private copyInteractionState(element: Element, copy: Element): void {
    if (this.options.hovered.has(element)) copy.setAttribute(HOVER_ATTRIBUTE, "");
    if (this.options.active.has(element)) copy.setAttribute(ACTIVE_ATTRIBUTE, "");
    if (this.options.focused === element) copy.setAttribute(FOCUS_ATTRIBUTE, "");
    if (this.focusWithin.has(element)) copy.setAttribute(FOCUS_WITHIN_ATTRIBUTE, "");
  }

  private copyAnimatedValues(element: Element, copy: Element): void {
    const values = this.animated.get(element);
    if (!values?.size || !isStyled(copy)) return;
    const computed = this.window.getComputedStyle(element);
    for (const [property, value] of values) {
      const baked = value ?? computed.getPropertyValue(property);
      if (baked) copy.style.setProperty(property, baked, "important");
    }
  }

  private copyScroll(element: Element, copy: Element): void {
    // The document's own scroll is applied to <body>; <html> must not move.
    if (element === this.document.documentElement) return;
    const viewport = this.document.scrollingElement;
    if (element === this.document.body && viewport) {
      const { scrollLeft, scrollTop } = viewport;
      if ((scrollLeft !== 0 || scrollTop !== 0) && isStyled(copy))
        this.moveScrolled(element, copy, scrollLeft, scrollTop, null);
      // In quirks mode, <body> scrolls the viewport; otherwise it may scroll itself too.
      if (element === viewport) return;
    }
    const { scrollLeft, scrollTop } = element;
    if (scrollLeft === 0 && scrollTop === 0) return;
    if (element instanceof this.window.HTMLSelectElement) {
      this.copyListBoxScroll(element, copy);
      return;
    }
    // foreignObject renders every scroll container at its origin. Move the
    // content instead: by its flow where it can be (see shiftFlow), otherwise
    // each child. Bare text directly inside a scroll container then does not
    // move (a known limitation).
    const flow = this.shiftFlow(element, scrollLeft, scrollTop);
    for (const child of Array.from(copy.children)) {
      if (isStyled(child)) {
        const live = this.liveOf.get(child) ?? null;
        this.moveScrolled(live, child, scrollLeft, scrollTop, element, flow);
      }
    }
  }

  /**
   * Moves the content of a scroll container (a block, flex or grid one) up and
   * left by the scroll with margins, which move it as scrolling does: its flow
   * up and left, the boxes in it not positioned (or translated). So they paint
   * in the same order, the absolute elements in them keep their containing
   * blocks (and are not clipped by the container when theirs is outside it),
   * and the sticky ones are where the page has them.
   *
   * In a block container, the first box's top margin moves everything after it
   * (as it collapses with those of the first boxes in it, all are counted), and
   * each box's side margins move it sideways, its width kept by the other one.
   * A flex or grid item is moved by its own margins, each side's opposite one
   * keeping its margin box. False, with nothing done, where the content cannot
   * be moved this way: text or inline boxes in a block container (line boxes),
   * floats, `display: contents`, margins that collapse in ways not worked out
   * (through an empty box, or past clearance).
   */
  private shiftFlow(container: Element, x: number, y: number): boolean {
    const style = this.styles.get(container);
    if (!style || this.options.inlineComposition?.node === container) return false;
    const items = /^(inline-)?(flex|grid)$/.test(style.display);
    if (!items && !BLOCK_CONTAINER.test(style.display)) return false;
    const boxes = this.inFlowChildren(container, items);
    if (!boxes) return false;
    const margins: [Element, string, number][] = [];
    const used = (element: Element, side: string) =>
      parseFloat(this.styles.get(element)!.getPropertyValue(side)) || 0;
    for (const box of boxes) {
      if (y !== 0 && items) {
        margins.push([box, "margin-top", used(box, "margin-top") - y]);
        margins.push([box, "margin-bottom", used(box, "margin-bottom") + y]);
      }
      if (x !== 0) {
        margins.push([box, "margin-left", used(box, "margin-left") - x]);
        margins.push([box, "margin-right", used(box, "margin-right") + x]);
      }
    }
    if (y !== 0 && !items && boxes[0]) {
      const top = this.marginToMoveFlow(boxes[0], y);
      if (top === null) return false;
      margins.push([boxes[0], "margin-top", top]);
    }
    for (const [box, side, value] of margins) {
      const copy = this.copies.get(box);
      if (copy && isStyled(copy)) copy.style.setProperty(side, `${value}px`, "important");
    }
    return true;
  }

  /**
   * The boxes of a container's flow (its in-flow element children), or null
   * if anything else is in it that its flow would not move as it moves them.
   */
  private inFlowChildren(container: Element, items: boolean): Element[] | null {
    const boxes: Element[] = [];
    for (const node of Array.from(container.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (/\S/.test((node as Text).data)) return null;
        continue;
      }
      const style = node.nodeType === Node.ELEMENT_NODE && this.styles.get(node as Element);
      if (!style || style.display === "none") continue;
      if (style.position === "absolute" || style.position === "fixed") continue;
      if (style.display === "contents" || (style.cssFloat || "none") !== "none") return null;
      if (!items && !BLOCK_LEVEL.test(style.display)) return null;
      boxes.push(node as Element);
    }
    return boxes;
  }

  /**
   * The first box of a block's flow, if it is a block (its top margin can
   * collapse with the block's); null if lines come first. What is out of the
   * flow (floats, absolute and fixed elements) does not separate them.
   */
  private firstBlock(container: Element): Element | null {
    for (const node of Array.from(container.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (/\S/.test((node as Text).data)) return null;
        continue;
      }
      const style = node.nodeType === Node.ELEMENT_NODE && this.styles.get(node as Element);
      if (!style || style.display === "none") continue;
      if (style.position === "absolute" || style.position === "fixed") continue;
      if ((style.cssFloat || "none") !== "none") continue;
      return BLOCK_LEVEL.test(style.display) ? (node as Element) : null;
    }
    return null;
  }

  /**
   * The top margin for a block container's first box that moves its flow up
   * by `y`: its margin collapses with those of the first boxes in it (when
   * nothing separates them), and the margin they make together must be `y`
   * less. Null where it cannot be worked out.
   */
  private marginToMoveFlow(first: Element, y: number): number | null {
    const margins: number[] = [];
    for (let box: Element | null = first; box;) {
      const style: CSSStyleDeclaration = this.styles.get(box)!;
      // An empty box: margins collapse through it, with those after it.
      if ((box as HTMLElement).offsetHeight === 0) return null;
      // Clearance separates a box's margin from those before it.
      if (box !== first && (style.clear || "none") !== "none") return null;
      margins.push(parseFloat(style.marginTop) || 0);
      // Not a new formatting context, and nothing between it and its first box.
      const through: boolean =
        /^(block|list-item)$/.test(style.display) &&
        /^(visible|clip)$/.test(style.overflowY) &&
        /^(visible|clip)$/.test(style.overflowX) &&
        !containsFixed(style) &&
        (style.columnCount || "auto") === "auto" &&
        (style.columnWidth || "auto") === "auto" &&
        /^(normal)?$/.test(style.alignContent ?? "") &&
        (parseFloat(style.borderTopWidth) || 0) === 0 &&
        (parseFloat(style.paddingTop) || 0) === 0;
      box = through ? this.firstBlock(box) : null;
    }
    const most = (list: number[]) => Math.max(0, ...list);
    const least = (list: number[]) => Math.min(0, ...list);
    const together = most(margins) + least(margins);
    const rest = margins.slice(1);
    const positive = most(rest);
    const negative = least(rest);
    const target = together - y;
    // Negative (the most negative of them), or positive (the most positive).
    if (target - positive <= negative) return target - positive;
    if (target - negative >= positive) return target - negative;
    return null;
  }

  /**
   * Moves the copy of something scrolled up and left by the scroll, by how it
   * is positioned on the page. `container` is what scrolls (null for the
   * document); `live` is null for what the agent added (composed text); `flow`
   * says the container's flow was moved already (shiftFlow), and what is in
   * it with it.
   *
   * In the flow (or relatively positioned), it is positioned relatively, not
   * translated: a transform would make it the containing block of the fixed
   * elements in it, which would then scroll away with it. And browsers place
   * sticky elements from where the boxes are laid out, which takes relative
   * offsets into account but not transforms: moved this way, the copy's sticky
   * elements stick where the page's do, as if it were scrolled. The page's
   * z-index on a static box is ignored, and stays so. The absolute elements in
   * it whose containing block is outside it are placed by pinPositioned().
   *
   * An absolute or fixed one is moved by its insets, if it scrolls with the
   * content: if what scrolls is its containing block. Otherwise it stays.
   *
   * A sticky one cannot be moved by an offset, which its insets are for: it
   * is translated, and its insets moved by the scroll the other way, so that
   * it sticks (to its unscrolled container) where it would scrolled; or, with
   * fixed elements in it, held where it is by its insets (see holdSticky).
   */
  private moveScrolled(
    live: Element | null,
    copy: HTMLElement | SVGElement,
    x: number,
    y: number,
    container: Element | null,
    flow = false,
  ): void {
    const style = live ? this.styles.get(live) : undefined;
    const position = style?.position ?? "static";
    // Moved with the flow (sticky ones too, sticking as on the page).
    if (flow && position !== "absolute" && position !== "fixed") return;
    if (position === "static" || position === "relative") {
      // Relative offsets as laid out (a used `top` in px, whatever was specified).
      const top = position === "relative" ? parseFloat(style!.top) || 0 : 0;
      const left = position === "relative" ? parseFloat(style!.left) || 0 : 0;
      copy.style.setProperty("position", "relative", "important");
      copy.style.setProperty("top", `${top - y}px`, "important");
      copy.style.setProperty("left", `${left - x}px`, "important");
      copy.style.setProperty("bottom", "auto", "important");
      copy.style.setProperty("right", "auto", "important");
      // Only a flex or grid item's z-index applies without a position.
      const parent = live?.parentElement ? this.styles.get(live.parentElement) : undefined;
      if (position === "static" && !/flex|grid/.test(parent?.display ?? ""))
        copy.style.setProperty("z-index", "auto", "important");
      this.moved.set(copy, "relative");
      return;
    }
    if (position === "absolute" || position === "fixed") {
      const positioned = this.positioned.get(live!);
      const scrolls = container
        ? positioned?.container === container
        : position === "absolute" || positioned?.container != null;
      // Its place in the flow (both insets auto) moves with the flow, if moved.
      if (scrolls) moveInsets(copy, style!, -x, -y, !flow);
      return;
    }
    // Its static siblings, positioned now, would paint over it in their order:
    // it is lifted over them, as the page paints it over what is not positioned.
    // Not with a z-index in it, which would then only count inside it.
    if (position === "sticky" && container && style!.zIndex === "auto" && !this.ordersInside(live!))
      copy.style.setProperty("z-index", "1", "important");
    if (position === "sticky" && container && this.holdsFixed(live!)) {
      if (this.holdSticky(live!, copy, container, x, y)) return;
    }
    // The individual `translate` property composes with any `transform` it already has.
    copy.style.setProperty("translate", `${-x}px ${-y}px`);
    this.moved.set(copy, "translated");
    if (position === "sticky") moveInsets(copy, style!, x, y);
  }

  /** Whether fixed elements in `element` are placed from outside it (a transform would place them from it). */
  private holdsFixed(element: Element): boolean {
    return this.holdingFixed.has(element);
  }

  /** Whether something positioned in `element` has a z-index of its own. */
  private ordersInside(element: Element): boolean {
    for (const descendant of Array.from(element.querySelectorAll("*"))) {
      const style = this.styles.get(descendant);
      if (style && style.zIndex !== "auto" && style.zIndex !== "" && style.position !== "static")
        return true;
    }
    return false;
  }

  /**
   * Holds a sticky element where the page shows it, by insets that make that
   * box its sticky view rectangle (in the scroll container, unscrolled), so
   * that it is not translated: the fixed elements in it would be clipped to
   * the container with it. False (nothing done) where an inset cannot place it:
   * its margin box above the container's content (sticking in its padding or
   * margin, or scrolled past),
   * or with a transform of its own (then it is their containing block anyway).
   */
  private holdSticky(
    live: Element,
    copy: HTMLElement | SVGElement,
    container: Element,
    x: number,
    y: number,
  ): boolean {
    const style = this.styles.get(live)!;
    const containerStyle = this.styles.get(container);
    if (containsFixed(style) || !containerStyle) return false;
    const rect = live.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    const port = {
      top: box.top + container.clientTop,
      left: box.left + container.clientLeft,
      bottom: box.top + container.clientTop + container.clientHeight,
      right: box.left + container.clientLeft + container.clientWidth,
    };
    // Its margin box stays in the container's content (its containing block).
    const paddingTop = parseFloat(containerStyle.paddingTop) || 0;
    const paddingLeft = parseFloat(containerStyle.paddingLeft) || 0;
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginLeft = parseFloat(style.marginLeft) || 0;
    if (y !== 0 && rect.top - marginTop < port.top + paddingTop - 0.5) return false;
    if (x !== 0 && rect.left - marginLeft < port.left + paddingLeft - 0.5) return false;
    const set = (property: string, value: number) =>
      copy.style.setProperty(property, `${value}px`, "important");
    if (y !== 0) {
      set("top", rect.top - port.top);
      set("bottom", port.bottom - rect.bottom);
    }
    if (x !== 0) {
      set("left", rect.left - port.left);
      set("right", port.right - rect.right);
    }
    return true;
  }

  /**
   * Places absolute and fixed elements whose containing block in the copy is
   * one moved for a scroll (a static box positioned relatively, a sticky one
   * translated), and not the page's: where they are on the page, from that box.
   */
  pinPositioned(): void {
    for (const [live, { copy, fixed, container }] of this.positioned) {
      let trap: Element | null = null;
      for (let ancestor = copy.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (container && this.liveOf.get(ancestor) === container) break;
        const moved = this.moved.get(ancestor);
        if (moved === "translated" || (moved === "relative" && !fixed)) {
          trap = ancestor;
          break;
        }
      }
      const trapLive = trap && this.liveOf.get(trap);
      if (trapLive && isStyled(copy)) this.pin(live, copy, fixed, container, trapLive);
    }
  }

  /** Positions an absolute or fixed element's copy from `trap` (its containing block in the copy), as the page has it from `container`. */
  private pin(
    live: Element,
    copy: HTMLElement | SVGElement,
    fixed: boolean,
    container: Element | null,
    trap: Element,
  ): void {
    const style = this.styles.get(live)!;
    const viewport = this.document.scrollingElement;
    const origin = (element: Element | null) => {
      if (element) {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + element.clientLeft, y: rect.top + element.clientTop };
      }
      // The viewport, or the initial containing block: the document's start.
      return fixed
        ? { x: 0, y: 0 }
        : { x: -(viewport?.scrollLeft ?? 0), y: -(viewport?.scrollTop ?? 0) };
    };
    const from = origin(container);
    const to = origin(trap);
    // Used values (in px) for a positioned element, but for insets that are
    // over-constrained (both, and the size): those are as specified, maybe in
    // percent. Then from where it is (its border box, less its margin).
    const inset = (side: "top" | "left", from: number) => {
      const value = style.getPropertyValue(side);
      if (/^-?[\d.]+px$/.test(value)) return parseFloat(value);
      const rect = live.getBoundingClientRect();
      const margin = parseFloat(style.getPropertyValue(`margin-${side}`)) || 0;
      return (side === "top" ? rect.top : rect.left) - margin - from;
    };
    const top = inset("top", from.y);
    const left = inset("left", from.x);
    if (!Number.isFinite(top) || !Number.isFinite(left)) return;
    const set = (property: string, value: string) =>
      copy.style.setProperty(property, value, "important");
    set("top", `${top - (to.y - from.y)}px`);
    set("left", `${left - (to.x - from.x)}px`);
    set("bottom", "auto");
    set("right", "auto");
    // Sizes and margins in percent, or auto, are from the containing block: as on the page.
    for (const property of PINNED_SIZES) {
      const value = style.getPropertyValue(property);
      if (value) set(property, value);
    }
  }

  /**
   * A scrolled list box: the options scrolled out of view above are left out of
   * the copy (removed: WebKit draws a list box's options whatever their display
   * or hidden), and the rest moved up by what remains of the scroll (less than
   * a row). WebKit does not move options either, so there a row may show up to
   * that much lower than it is; the rows left out are right in every browser.
   * (An <optgroup>'s label stays, even scrolled out with its first options.)
   */
  private copyListBoxScroll(select: HTMLSelectElement, copy: Element): void {
    const style = this.window.getComputedStyle(select);
    const top =
      select.getBoundingClientRect().top + select.clientTop + (parseFloat(style.paddingTop) || 0);
    const copies = Array.from(copy.querySelectorAll("option"));
    let hidden = 0;
    let removed = 0;
    for (const [index, option] of Array.from(select.options).entries()) {
      const rect = option.getBoundingClientRect();
      const optionCopy = copies[index];
      if (rect.bottom > top + 0.5 || !optionCopy) break;
      optionCopy.remove();
      hidden += rect.height;
      removed++;
    }
    const rest = select.scrollTop - hidden;
    if (rest <= 0) return;
    for (const option of copies.slice(removed)) {
      if (option instanceof HTMLElement) option.style.setProperty("translate", `0 ${-rest}px`);
    }
  }

  /**
   * The copy is not scrolled, so its real scrollbars would show the wrong
   * position: hide them, keeping the room a classic scrollbar takes, and
   * remember them to be drawn by drawScrollbars().
   */
  private hideScrollbars(element: Element, copy: Element, style: CSSStyleDeclaration): void {
    const bars = scrollbarsOf(element, style);
    if (bars.length === 0) return;
    this.scrollbars.push(...bars);
    // The document's scrollbars are the viewport's; the root copy never shows any.
    if (element === this.document.scrollingElement || !(copy instanceof HTMLElement)) return;
    copy.style.setProperty("overflow", "hidden", "important");
    if (bars.some((bar) => bar.gutter))
      copy.style.setProperty("scrollbar-gutter", "stable", "important");
  }
}

// The image cannot show a text field's selection, so it is drawn over the field.
const SELECTION_COLOR = "rgb(51 144 255 / 35%)";
const INACTIVE_SELECTION_COLOR = "rgb(200 200 200)";
const SCROLLBAR_TRACK_COLOR = "rgb(0 0 0 / 5%)";
const SCROLLBAR_THUMB_COLOR = "rgb(0 0 0 / 38%)";
const SCROLLBAR_THUMB_HOVER_COLOR = "rgb(0 0 0 / 52%)";
const SCROLLBAR_THUMB_ACTIVE_COLOR = "rgb(0 0 0 / 64%)";
const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$/;
const SCROLLBAR_INSET = 2;

/** Adds a fixed box on top of everything to the root copy. */
function drawBox(
  root: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
  css: string,
): void {
  const element = root.ownerDocument.createElement("div");
  element.setAttribute(
    "style",
    `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;` +
      `margin:0;padding:0;border:0;pointer-events:none;z-index:2147483647;${css}`,
  );
  root.appendChild(element);
}

/** Adds the scrollbars on top of everything, as fixed boxes in the root copy. */
function drawScrollbars(
  root: HTMLElement,
  bars: readonly Scrollbar[],
  state: SnapshotOptions["scrollbar"],
): void {
  const box = (left: number, top: number, width: number, height: number, css: string) =>
    drawBox(root, left, top, width, height, css);
  for (const { element, axis, track, thumb, gutter } of bars) {
    if (gutter)
      box(track.left, track.top, track.width, track.height, `background:${SCROLLBAR_TRACK_COLOR}`);
    const width = Math.max(0, thumb.width - 2 * SCROLLBAR_INSET);
    const height = Math.max(0, thumb.height - 2 * SCROLLBAR_INSET);
    const current = state?.element === element && state.axis === axis ? state.state : null;
    const color =
      current === "active"
        ? SCROLLBAR_THUMB_ACTIVE_COLOR
        : current === "hover"
          ? SCROLLBAR_THUMB_HOVER_COLOR
          : SCROLLBAR_THUMB_COLOR;
    const style = `background:${color};border-radius:${Math.min(width, height) / 2}px`;
    box(thumb.left + SCROLLBAR_INSET, thumb.top + SCROLLBAR_INSET, width, height, style);
  }
}

const POPUP_HIGHLIGHT = "rgb(30 110 220)";

/** Draws a selected option of a focused list box over its copy: white on the selection's blue, cut to the box. */
function drawListBoxRow(root: HTMLElement, row: ListBoxRow): void {
  const document = root.ownerDocument;
  const { shown, box } = row;
  const clip = document.createElement("div");
  clip.setAttribute(
    "style",
    `position:fixed;left:${shown.left}px;top:${shown.top}px;width:${shown.width}px;height:${shown.height}px;` +
      "margin:0;padding:0;border:0;overflow:hidden;pointer-events:none;z-index:2147483646",
  );
  const option = document.createElement("div");
  option.setAttribute(
    "style",
    `position:absolute;left:${box.left - shown.left}px;top:${box.top - shown.top}px;width:${box.width}px;height:${box.height}px;` +
      `box-sizing:border-box;margin:0;border:0;padding:0 0 0 ${row.paddingLeft}px;background:${LIST_BOX_SELECTED};color:#fff;` +
      `font:${row.font};line-height:${box.height}px;white-space:pre;overflow:hidden;text-align:left;letter-spacing:normal`,
  );
  option.textContent = row.label;
  clip.appendChild(option);
  root.appendChild(clip);
}

/** Draws the open list of a <select>, as a fixed box over everything. */
function drawSelectPopup(root: HTMLElement, view: PopupView): void {
  const document = root.ownerDocument;
  const list = document.createElement("div");
  const { left, top, width, height } = view.box;
  list.setAttribute(
    "style",
    `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;box-sizing:border-box;` +
      "margin:0;padding:0;border:1px solid rgb(118 118 118);background:#fff;color:#000;overflow:hidden;" +
      "box-shadow:0 2px 8px rgb(0 0 0 / 25%);pointer-events:none;z-index:2147483647;text-align:left;" +
      `font:${view.font};line-height:${view.itemHeight}px;letter-spacing:normal;text-transform:none`,
  );
  for (const item of view.items) {
    const row = document.createElement("div");
    const indent = item.grouped ? 20 : 8;
    const color = item.highlighted
      ? "#fff"
      : item.disabled && item.index >= 0
        ? "rgb(128 128 128)"
        : "#000";
    const background = item.highlighted
      ? POPUP_HIGHLIGHT
      : item.selected
        ? "rgb(0 0 0 / 8%)"
        : "transparent";
    row.setAttribute(
      "style",
      `height:${view.itemHeight}px;padding:0 8px 0 ${indent}px;margin:0;white-space:pre;overflow:hidden;` +
        `text-overflow:ellipsis;color:${color};background:${background};font-weight:${item.index < 0 ? "bold" : "normal"}`,
    );
    row.textContent = item.label;
    list.appendChild(row);
  }
  root.appendChild(list);
}

const BACKGROUND_PROPERTIES = [
  "background-color",
  "background-image",
  "background-repeat",
  "background-position",
  "background-size",
  "background-origin",
  "background-clip",
  "background-attachment",
];

/**
 * Browsers paint the root's background over the whole page, and the body's
 * there instead when the root has none, not painting it on the body then (CSS
 * Backgrounds 3, "The Canvas Background"). The copy is not a document's root
 * inside the foreignObject, so a body's background would only cover the body:
 * it is moved to the copy of the root, which fills the page, as browsers do.
 */
function propagateBodyBackground(
  document: Document,
  root: HTMLElement,
  inlineImage: (url: string) => string | null,
): void {
  const view = document.defaultView;
  const body = document.body;
  if (!view || body?.tagName !== "BODY") return;
  const rootStyle = view.getComputedStyle(document.documentElement);
  if (!TRANSPARENT.test(rootStyle.backgroundColor) || rootStyle.backgroundImage !== "none") return;
  const bodyStyle = view.getComputedStyle(body);
  if (TRANSPARENT.test(bodyStyle.backgroundColor) && bodyStyle.backgroundImage === "none") return;
  const bodyCopy = root.querySelector<HTMLElement>(":scope > body");
  if (!bodyCopy) return;
  for (const property of BACKGROUND_PROPERTIES) {
    let value = bodyStyle.getPropertyValue(property);
    // Images the copy can show: data URLs (one not loaded yet comes with a later frame).
    if (property === "background-image") value = inlineBackgroundImages(value, inlineImage);
    if (value) root.style.setProperty(property, value);
  }
  bodyCopy.style.setProperty("background", "none", "important");
}

/**
 * Browsers apply the body's overflow to the viewport, not to the body, when
 * the root leaves its own visible. The copy of the body would clip what it has
 * to its box, and be the box its sticky elements stick in (not the viewport,
 * the copy of the root): it is left visible, the copy of the root clipping.
 */
function propagateBodyOverflow(document: Document, root: HTMLElement): void {
  const view = document.defaultView;
  const body = document.body;
  if (!view || body?.tagName !== "BODY") return;
  const rootStyle = view.getComputedStyle(document.documentElement);
  if (rootStyle.overflowX !== "visible" || rootStyle.overflowY !== "visible") return;
  const bodyStyle = view.getComputedStyle(body);
  if (bodyStyle.overflowX === "visible" && bodyStyle.overflowY === "visible") return;
  root
    .querySelector<HTMLElement>(":scope > body")
    ?.style.setProperty("overflow", "visible", "important");
}

/** A computed background-image with its URLs as data URLs; none while one is not loaded. */
function inlineBackgroundImages(
  value: string,
  inlineImage: (url: string) => string | null,
): string {
  let missing = false;
  const inlined = value.replace(/url\((["']?)(.*?)\1\)/g, (_match, _quote, url: string) => {
    const dataUrl = inlineImage(url);
    if (!dataUrl) missing = true;
    return `url("${dataUrl ?? ""}")`;
  });
  return missing ? "none" : inlined;
}

/** Serializes the page as XHTML (an <html> element with the XHTML namespace). */
export function snapshotDocument(document: Document, options: SnapshotOptions): string {
  const snapshotter = new Snapshotter(document, options);
  const root = snapshotter.copy(document.documentElement) as HTMLElement;
  snapshotter.pinPositioned();
  root.style.setProperty("width", `${document.documentElement.clientWidth}px`);
  root.style.setProperty("height", `${document.documentElement.clientHeight}px`);
  root.style.setProperty("overflow", "hidden");
  propagateBodyBackground(document, root, options.inlineImage);
  propagateBodyOverflow(document, root);
  // In the root, not <body>: a scrolled <body> is moved (or translated), which could move fixed boxes with it.
  // The highlight is drawn over the text, not under it: the page's color (often
  // opaque) is multiplied in, which keeps dark text on a light field readable.
  const pageColor =
    options.selectionColor && !TRANSPARENT.test(options.selectionColor)
      ? options.selectionColor
      : null;
  const css = options.selectionInactive
    ? `background:${INACTIVE_SELECTION_COLOR};mix-blend-mode:multiply`
    : pageColor
      ? `background:${pageColor};mix-blend-mode:multiply`
      : `background:${SELECTION_COLOR}`;
  for (const { left, top, width, height } of options.selection ?? [])
    drawBox(root, left, top, width, height, css);
  // Composed text is underlined, as IMEs do.
  if (options.composition) {
    const { boxes, color } = options.composition;
    for (const box of boxes) {
      const thickness = Math.max(1, Math.round(box.height / 14));
      drawBox(
        root,
        box.left,
        box.top + box.height - thickness,
        box.width,
        thickness,
        `background:${color}`,
      );
    }
  }
  drawScrollbars(root, snapshotter.scrollbars, options.scrollbar);
  for (const row of options.listBoxSelection ?? []) drawListBoxRow(root, row);
  if (options.selectPopup) drawSelectPopup(root, options.selectPopup);
  return new XMLSerializer().serializeToString(root);
}

/** Wraps the page's XHTML and CSS in an SVG document of the given size. */
export function buildFrameSvg(xhtml: string, css: string, width: number, height: number): string {
  // "]]>" inside CSS would end the CDATA section early.
  const safeCss = css.replace(/]]>/g, "]]]]><![CDATA[>");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style><![CDATA[${safeCss}]]></style>` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject>` +
    `</svg>`
  );
}
