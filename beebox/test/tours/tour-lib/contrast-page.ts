/**
 * Browser half of the contrast audit, as script text for `bin/browse eval`
 * (the backend program has no DOM types; browse/src/point-check-script.ts is
 * the precedent). The interfaces describe what the scripts return.
 */

type Rgba = [number, number, number, number];
interface Rect { x: number; y: number; w: number; h: number }

export interface TextRun {
  id: number;
  selector: string;
  text: string;
  /** The text color with opacity below its nearest painted background folded into alpha. */
  fg: Rgba;
  /**
   * Opacity applied above that background, and the background's solid color.
   * The capture shows the group already faded over its backdrop, so scoring
   * solves for the backdrop. Null when no ancestor fades the group.
   */
  group: { opacity: number; bg: [number, number, number] } | null;
  large: boolean;
  /**
   * Index into `materials` of the themed card this text sits in, or -1.
   * Controls draw their own surfaces by design, so they get -1 too.
   */
  material: number;
  rects: Rect[];
}

/** One themed card's material surfaces, resolved from its tokens. */
export interface Material {
  theme: string;
  paper: [number, number, number];
  /** Every surface the material declares, including paper, as opaque colors. */
  surfaces: [number, number, number][];
  pairs: { fg: string; bg: string; fgColor: Rgba; bgColor: [number, number, number] }[];
  at: Rect;
}

export interface PageRuns {
  width: number;
  height: number;
  runs: TextRun[];
  materials: Material[];
  /** Text runs (by element) that are visible but outside the viewport, so not measured. */
  offscreen: number;
  /** Runs in a faded group over an image: the capture cannot separate group from backdrop. */
  unmeasured: number;
}

/**
 * Collect visible text runs and themed materials, then hide every glyph for
 * the background capture. Evaluates to a JSON string of `PageRuns`.
 *
 * - Colors go through a canvas, so rgb(), color(srgb …) from color-mix() and
 *   oklch() all arrive as sRGB bytes (ImageData is not premultiplied).
 * - Materials: the surfaces a card theme declares, and the token pairs its
 *   components render together (prose on paper, links, Card material panels,
 *   quotes, code). A translucent paper sits over artwork; the pixel pass
 *   measures that instead.
 * - Opacity below a text's first painted background fades only the text;
 *   opacity at or above it fades text and background together (`group`).
 * - Line boxes are clipped to the viewport and to clipping ancestors, and a
 *   box whose centre hits another element (a menu, a sticky bar) is dropped.
 * - WCAG exempts inactive controls; visually hidden text is clipped to a
 *   pixel. Inputs are measured over their content box.
 * - Text shadows stay in the capture: a halo is part of what is read against.
 * - Controls draw their own surfaces by design, so they get no material.
 */
export const COLLECT_SCRIPT = String.raw`JSON.stringify((() => {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const parse = (value) => {
    if (ctx === null) throw new Error("contrast audit: no 2d canvas");
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#00000000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 0 ? null : [r, g, b, a / 255];
  };
  const over = (top, under) => [top[0] * top[3] + under[0] * (1 - top[3]), top[1] * top[3] + under[1] * (1 - top[3]), top[2] * top[3] + under[2] * (1 - top[3])];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const SURFACES = ["paper", "sheet", "tint", "underlay", "quote-paper", "quote-layer-paper", "blockquote-paper", "code-paper"];
  const PAIRS = [
    ["ink", "paper"],
    ["ink-soft", "paper"],
    ["pen", "paper"],
    ["ink", "sheet"],
    ["ink", "tint"],
    ["ink", "quote-paper"],
    ["ink", "quote-layer-paper"],
    ["ink", "blockquote-paper"],
    ["code-ink", "code-paper"]
  ];
  const materials = [];
  const materialOf = new Map();
  for (const card of document.querySelectorAll(".bbx-card-theme[data-card-theme]")) {
    const box = card.getBoundingClientRect();
    if (box.bottom < 0 || box.top > vh || box.width < 2) continue;
    const probe = document.createElement("span");
    card.append(probe);
    const token = (name) => {
      probe.style.color = "var(--bbx-" + (name) + ", transparent)";
      return parse(getComputedStyle(probe).color);
    };
    const paperRaw = token("paper");
    if (paperRaw !== null && paperRaw[3] === 1) {
      const paper = [paperRaw[0], paperRaw[1], paperRaw[2]];
      const surfaces = SURFACES.map(token).filter((c) => c !== null).map((c) => over(c, paper));
      const pairs = [];
      for (const [fg, bg] of PAIRS) {
        const fgColor = token(fg);
        const bgRaw = token(bg);
        if (fgColor !== null && bgRaw !== null) pairs.push({ fg, bg, fgColor, bgColor: over(bgRaw, paper) });
      }
      materialOf.set(card, materials.length);
      materials.push({ theme: (card.dataset["cardTheme"] ?? "") + "/" + (card.dataset["cardStock"] ?? ""), paper, surfaces, pairs, at: { x: Math.max(0, box.left), y: Math.max(0, box.top), w: 1, h: 1 } });
    }
    probe.remove();
  }
  const describe = (el) => {
    const parts = [];
    for (let cur = el; cur !== null && parts.length < 3; cur = cur.parentElement) {
      if (cur.id !== "") {
        parts.unshift("#" + (cur.id));
        break;
      }
      const cls = [...cur.classList].filter((c) => !c.includes(":") && !c.includes("[")).slice(0, 2);
      parts.unshift(cur.tagName.toLowerCase() + cls.map((c) => "." + (c)).join(""));
    }
    return parts.join(" > ");
  };
  const layering = (el) => {
    let below = 1;
    let above = 1;
    let bg = null;
    let overImage = false;
    for (let cur = el; cur !== null; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      const opacity = Number(cs.opacity);
      if (bg === null && !overImage) {
        const color = parse(cs.backgroundColor);
        if (cs.backgroundImage !== "none") overImage = true;
        else if (color !== null && color[3] === 1) bg = [color[0], color[1], color[2]];
      }
      if (bg === null && !overImage) below *= opacity;
      else above *= opacity;
    }
    return { below, group: above < 1 && bg !== null ? { opacity: above, bg } : null, overImage: above < 1 && overImage };
  };
  const visible = (el, r) => {
    let [l, t, ri, b] = [r.left, r.top, r.right, r.bottom];
    for (let cur = el.parentElement; cur !== null; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = cur.getBoundingClientRect();
      [l, t, ri, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(ri, c.right), Math.min(b, c.bottom)];
    }
    [l, t, ri, b] = [Math.max(l, 0), Math.max(t, 0), Math.min(ri, vw), Math.min(b, vh)];
    if (ri - l < 2 || b - t < 4) return null;
    const hit = document.elementFromPoint((l + ri) / 2, (t + b) / 2);
    if (hit !== null && hit !== el && !el.contains(hit) && !hit.contains(el)) return null;
    return { x: l, y: t, w: ri - l, h: b - t };
  };
  const byElement = new Map();
  const offscreen = new Set();
  let unmeasured = 0;
  const add = (el, { text, color, boxes }) => {
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || el.closest(":disabled, [aria-disabled='true'], [inert], .bbx-contrast-overlay") !== null) return;
    const own = el.getBoundingClientRect();
    if (own.width <= 1 || own.height <= 1) return;
    if (own.top >= vh || own.bottom <= 0) {
      offscreen.add(el);
      return;
    }
    const fill = cs.webkitTextFillColor;
    const raw = parse(fill !== "" && fill !== cs.color ? fill : color);
    if (raw === null) return;
    const rects = boxes.map((r) => visible(el, r)).filter((r) => r !== null);
    if (rects.length === 0) return;
    const { below, group, overImage } = layering(el);
    if (overImage) {
      unmeasured++;
      return;
    }
    let run = byElement.get(el);
    if (run === void 0) {
      const size = Number.parseFloat(cs.fontSize);
      const card = el.closest("button, a, [role=button], input, textarea, select, summary") === null ? el.closest(".bbx-card-theme[data-card-theme]") : null;
      run = {
        id: byElement.size,
        selector: describe(el),
        text: "",
        fg: [raw[0], raw[1], raw[2], raw[3] * below],
        group,
        large: size >= 24 || Number(cs.fontWeight) >= 700 && size >= 18.66,
        material: card === null ? -1 : materialOf.get(card) ?? -1,
        rects: []
      };
      byElement.set(el, run);
    }
    run.text = (run.text + " " + text.trim()).trim().slice(0, 60);
    run.rects.push(...rects);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const el = node.parentElement;
    if (text.trim() === "" || el === null || el.closest("script, style, noscript, title") !== null) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    add(el, { text, color: getComputedStyle(el).color, boxes: [...range.getClientRects()] });
  }
  for (const input of document.querySelectorAll("input:not([type=checkbox], [type=radio], [type=hidden], [type=range], [type=color]), textarea")) {
    const showing = input.value !== "" ? input.value : input.placeholder;
    if (showing === "") continue;
    const cs = getComputedStyle(input);
    const color = input.value !== "" ? cs.color : getComputedStyle(input, "::placeholder").color;
    const box = input.getBoundingClientRect();
    const px = (p) => Number.parseFloat(cs.getPropertyValue(p));
    const l = px("border-left-width") + px("padding-left");
    const t = px("border-top-width") + px("padding-top");
    add(input, { text: showing, color, boxes: [new DOMRect(box.left + l, box.top + t, box.width - l - px("border-right-width") - px("padding-right"), box.height - t - px("border-bottom-width") - px("padding-bottom"))] });
  }
  const style = document.createElement("style");
  style.id = "bbx-contrast-hide-text";
  style.textContent = "*, *::before, *::after, ::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; caret-color: transparent !important; }";
  document.head.append(style);
  return { width: vw, height: vh, runs: [...byElement.values()], materials, offscreen: offscreen.size, unmeasured };
})())`;

export interface OverlayMark {
  rects: Rect[];
  label: string;
}

/** Restore the glyphs, then outline each mark (`OverlayMark[]`, spliced in as JSON). */
export function restoreAndMarkScript(marks: readonly OverlayMark[]): string {
  return String.raw`((marks) => {
  document.getElementById("bbx-contrast-hide-text")?.remove();
  document.querySelector(".bbx-contrast-overlay")?.remove();
  if (marks.length === 0) return 0;
  const layer = document.createElement("div");
  layer.className = "bbx-contrast-overlay";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  for (const mark of marks) {
    const left = Math.min(...mark.rects.map((r) => r.x));
    const top = Math.min(...mark.rects.map((r) => r.y));
    const right = Math.max(...mark.rects.map((r) => r.x + r.w));
    const bottom = Math.max(...mark.rects.map((r) => r.y + r.h));
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;left:" + (left - 2) + "px;top:" + (top - 2) + "px;width:" + (right - left + 4) + "px;height:" + (bottom - top + 4) + "px;outline:2px solid #ff0040;box-shadow:0 0 0 3px #fff";
    const tag = document.createElement("span");
    tag.textContent = mark.label;
    tag.style.cssText = "position:absolute;left:-2px;top:-17px;font:600 11px/15px ui-monospace,monospace;background:#ff0040;color:#fff;padding:0 4px;border-radius:3px;white-space:nowrap";
    box.append(tag);
    layer.append(box);
  }
  document.body.append(layer);
  return marks.length;
})(${JSON.stringify(marks)})`;
}
