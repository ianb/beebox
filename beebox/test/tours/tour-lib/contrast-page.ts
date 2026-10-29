/**
 * Browser half of the contrast audit, as script text for `bin/browse eval`
 * (the backend program has no DOM types; browse/src/point-check-script.ts is
 * the precedent). The interfaces describe what the scripts return.
 */

type Rgba = [number, number, number, number];
interface Rect { x: number; y: number; w: number; h: number }

export interface TextRun {
  /** Stable for the element across audits of one page load (`data-bbx-audit-run`). */
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
  /** An empty field's placeholder, which is held to the large-text ratio. */
  placeholder: boolean;
  /**
   * Index into `materials` of the themed card this text sits in, or -1.
   * Controls draw their own surfaces by design, so they get -1 too.
   */
  material: number;
  /** The lines measured: those wholly inside the viewport and its scrolling ancestors. */
  rects: Rect[];
}

/** A text element's lines, numbered in document order, and which this audit saw whole. */
export interface RunLines {
  id: number;
  /** Selector and opening text, to name a run that was never measured. */
  label: string;
  total: number;
  whole: number[];
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
  /** Every text element's lines, including those scrolled out of view, which another audit may see. */
  lines: RunLines[];
  /** Run ids the capture cannot score: in a faded group over an image, or partly covered by another element. */
  unmeasured: number[];
  /** The `::selection` colors of each element the theme studio paints as selected. */
  selections: Selection[];
}

/** Selected text's ink and background, as `::selection` resolves them where the text sits. */
export interface Selection {
  selector: string;
  text: string;
  fg: Rgba;
  bg: Rgba;
  rects: Rect[];
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
 * - Each text element keeps one run id across audits of the page
 *   (`data-bbx-audit-run`), so audits at several scroll positions merge. A
 *   line cut by the viewport or a scrolling ancestor is left for the audit
 *   that sees it whole: its sliver would be scored against the wrong pixels.
 * - Text that is not rendered (in a closed <details>) is skipped.
 * - Text shadows stay in the capture: a halo is part of what is read against.
 * - Controls draw their own surfaces by design, and a region that sets its
 *   own `--bbx-ink` declares its own material, so neither gets a surface check.
 * - Selection: the theme studio paints sample text with the
 *   `bbx-selection-preview` highlight; each such element's `::selection`
 *   colors are read, and the highlight is hidden for the capture.
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
    ["ink-soft", "sheet"],
    ["ink", "tint"],
    ["danger", "paper"],
    ["danger", "sheet"],
    ["danger", "tint"],
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
    // An element that clips its own overflow (a truncated label) clips its text too.
    const own = getComputedStyle(el);
    if (own.overflowX !== "visible" || own.overflowY !== "visible") {
      const c = el.getBoundingClientRect();
      [l, t, ri, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(ri, c.right), Math.min(b, c.bottom)];
    }
    // Only ancestors on the containing-block chain clip: an absolute box
    // escapes overflow until its positioned ancestor, a fixed box escapes all.
    let escaping = getComputedStyle(el).position === "absolute";
    if (getComputedStyle(el).position !== "fixed") {
      for (let cur = el.parentElement; cur !== null; cur = cur.parentElement) {
        const cs = getComputedStyle(cur);
        if (escaping && cs.position === "static") continue;
        escaping = false;
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
          const c = cur.getBoundingClientRect();
          [l, t, ri, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(ri, c.right), Math.min(b, c.bottom)];
        }
        if (cs.position === "fixed") break;
        if (cs.position === "absolute") escaping = true;
      }
    }
    [l, t, ri, b] = [Math.max(l, 0), Math.max(t, 0), Math.min(ri, vw), Math.min(b, vh)];
    // Clipped away by overflow (truncation) or too thin to hold a glyph: nothing to measure.
    if (ri - l < 2 || b - t < 4) return "clipped";
    // Text under another element (a menu, a sticky bar, a decoration) is not
    // what the reader sees. Hit testing is on for everything while collecting.
    // A 3×3 grid of probes: all covered drops the box; some covered makes
    // the run unmeasurable, since the cover's pixels would enter its samples.
    const probes = [l + 1, (l + ri) / 2, ri - 1].flatMap((x) => [t + 1, (t + b) / 2, b - 1].map((y) => [x, y]));
    // Hit testing on a line snaps a point near a text edge to the adjacent
    // inline (the next word's span) even when that box lies beside the point,
    // so a hit counts as cover only when its box contains the point.
    const covered = probes.filter(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      if (hit === null || hit === el || el.contains(hit) || hit.contains(el)) return false;
      const box = hit.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    }).length;
    if (covered === probes.length) return null;
    return { x: l, y: t, w: ri - l, h: b - t, partial: covered > 0 };
  };
  // A previous audit's outlines would cover the text they mark.
  document.querySelector(".bbx-contrast-overlay")?.remove();
  const hitAll = document.createElement("style");
  hitAll.id = "bbx-contrast-hit-all";
  hitAll.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
  document.head.append(hitAll);
  // A line cut by the viewport or a vertically scrolling ancestor is measured
  // at another scroll position; one clipped by overflow: hidden (truncation)
  // is not, so only scrolling ancestors count.
  const scrollClip = (el) => {
    let [t, b] = [0, vh];
    if (getComputedStyle(el).position === "fixed") return [t, b];
    for (let cur = el.parentElement; cur !== null; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
        const c = cur.getBoundingClientRect();
        [t, b] = [Math.max(t, c.top), Math.min(b, c.bottom)];
      }
      if (cs.position === "fixed") break;
    }
    return [t, b];
  };
  const runId = (el) => {
    const known = el.getAttribute("data-bbx-audit-run");
    if (known !== null) return Number(known);
    const next = Number(document.documentElement.dataset.bbxAuditRuns ?? "0");
    document.documentElement.dataset.bbxAuditRuns = String(next + 1);
    el.setAttribute("data-bbx-audit-run", String(next));
    return next;
  };
  const byElement = new Map();
  const linesOf = new Map();
  const unmeasurable = new Set();
  const add = (el, { text, color, boxes, placeholder = false }) => {
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || !el.checkVisibility() || el.closest(":disabled, [aria-disabled='true'], [inert], .bbx-contrast-overlay") !== null) return;
    const own = el.getBoundingClientRect();
    if (own.width <= 1 || own.height <= 1) return;
    const id = runId(el);
    // Number the lines; a line scrolled out of view, wholly or in part, is left for another audit.
    const [top, bottom] = scrollClip(el);
    const lines = linesOf.get(el) ?? { id, label: describe(el) + ' "' + text.trim().slice(0, 40) + '" [data-bbx-audit-run=' + id + ']', total: 0, whole: [] };
    linesOf.set(el, lines);
    const whole = [];
    for (const r of boxes) {
      if (r.height <= 0) continue;
      if (r.top >= top - 0.5 && r.bottom <= bottom + 0.5) whole.push({ r, n: lines.total });
      lines.total++;
    }
    if (whole.length === 0) return;
    const fill = cs.webkitTextFillColor;
    const raw = parse(fill !== "" && fill !== cs.color ? fill : color);
    // Clear text, and lines clipped away by overflow: hidden, have nothing to measure.
    const checked = raw === null ? [] : whole.map(({ r, n }) => ({ n, box: visible(el, r) }));
    const seen = checked.map(({ box }) => box).filter((box) => box !== null && box !== "clipped");
    const { below, group, overImage } = layering(el);
    if (seen.length > 0 && (overImage || seen.some((box) => box.partial))) {
      unmeasurable.add(id);
      return;
    }
    // A line counts as measured only when a step scored it; a line wholly
    // under a menu or overlay waits for a step that shows it. Clear text has
    // nothing to score, so all its lines count.
    lines.whole.push(...(raw === null ? whole : checked.filter(({ box }) => box !== null)).map(({ n }) => n));
    if (raw === null || seen.length === 0) return;
    const rects = seen.map(({ x, y, w, h }) => ({ x, y, w, h }));
    let run = byElement.get(el);
    if (run === void 0) {
      const size = Number.parseFloat(cs.fontSize);
      const control = el.closest("button, a, [role=button], input, textarea, select, summary") !== null;
      const themed = el.closest(".bbx-card-theme[data-card-theme]");
      // A region that sets its own ink (a heading strip over artwork) is its own material.
      const ownInk = themed !== null && getComputedStyle(el).getPropertyValue("--bbx-ink") !== getComputedStyle(themed).getPropertyValue("--bbx-ink");
      const card = control || ownInk ? null : themed;
      run = {
        id,
        selector: describe(el),
        text: "",
        fg: [raw[0], raw[1], raw[2], raw[3] * below],
        group,
        large: size >= 24 || Number(cs.fontWeight) >= 700 && size >= 18.66,
        placeholder,
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
    add(input, { text: showing, color, placeholder: input.value === "", boxes: [new DOMRect(box.left + l, box.top + t, box.width - l - px("border-right-width") - px("padding-right"), box.height - t - px("border-bottom-width") - px("padding-bottom"))] });
  }
  hitAll.remove();
  const selections = [];
  for (const range of CSS.highlights?.get("bbx-selection-preview") ?? []) {
    const el = range.startContainer.parentElement;
    if (el === null) continue;
    const cs = getComputedStyle(el, "::selection");
    const fg = parse(cs.color);
    const bg = parse(cs.backgroundColor);
    const rects = [...range.getClientRects()].map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
    // A range in hidden text (a card's other face) renders nothing to read.
    if (fg !== null && bg !== null && rects.some((r) => r.w > 0 && r.h > 0)) selections.push({ selector: describe(el), text: range.toString().trim(), fg, bg, rects });
  }
  const style = document.createElement("style");
  style.id = "bbx-contrast-hide-text";
  style.textContent = "*, *::before, *::after, ::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; caret-color: transparent !important; } ::highlight(bbx-selection-preview) { color: transparent !important; background-color: transparent !important; }";
  document.head.append(style);
  return { width: vw, height: vh, runs: [...byElement.values()], materials, lines: [...linesOf.values()], unmeasured: [...unmeasurable], selections };
})())`;

export interface OverlayMark {
  rects: Rect[];
  label: string;
}

/** Restore the glyphs and hit testing (also after a failed collection), then outline each mark (`OverlayMark[]`, spliced in as JSON). */
export function restoreAndMarkScript(marks: readonly OverlayMark[]): string {
  return String.raw`((marks) => {
  document.getElementById("bbx-contrast-hide-text")?.remove();
  document.getElementById("bbx-contrast-hit-all")?.remove();
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
