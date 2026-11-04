/**
 * Theme contrast and material audit. axe-core declines ("incomplete") to
 * measure text over images, gradients and textures, which is where themes put
 * most of their text. This audit measures what a reader sees: hide every
 * glyph, capture the real background, and compare each text run's color with
 * the pixels under it. It also checks each card theme's declared token pairs,
 * and reports text inside a card that sits on a surface the theme did not
 * declare and that inverts the paper's light/dark side (a shared component
 * painting a light panel into a dark theme, or the reverse).
 *
 * The result is a visual estimate (see PERCENTILE), not a conformance claim.
 * It needs only `eval` and `screenshot`, so tours and `bin/theme-check` share it.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Sharp from "sharp";
import { COLLECT_SCRIPT, restoreAndMarkScript, type Material, type OverlayMark, type PageRuns, type RunLines, type Selection, type TextRun } from "./contrast-page.js";

export interface ContrastPage {
  eval(expression: string): Promise<string>;
  screenshot(filePath: string): Promise<void>;
}

export interface RawImage {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}

type Rgb = readonly [number, number, number];

export type ContrastFailure =
  /** Text against the pixels under it. */
  | { kind: "text"; run: number; selector: string; text: string; fg: string; bg: string; ratio: number; required: number }
  /** A token pair the theme's components render together. */
  | { kind: "token"; material: number; theme: string; fg: string; bg: string; ratio: number; required: number }
  /** Text in a card on an undeclared surface on the other side of light/dark from the paper. */
  | { kind: "surface"; run: number; selector: string; text: string; theme: string; bg: string; paper: string; ratio: number; required: number }
  /** Selected text: the `::selection` ink on its background. */
  | { kind: "selection"; selector: string; text: string; fg: string; bg: string; ratio: number; required: number; rects: Selection["rects"] };

/**
 * WCAG AA. Large text is 24px, or 18.66px bold. A placeholder gets the large
 * ratio: it must read as lighter than typed text (boxholder, 2026-10-25).
 */
const NORMAL = 4.5;
const LARGE = 3;
/**
 * A run scores the contrast at this percentile of its background samples.
 * The minimum would let one speck of texture fail a line; the median would
 * pass text unreadable across a fifth of its width. A low band narrower than
 * this share of the run passes.
 */
const PERCENTILE = 0.1;
const MAX_SAMPLES_PER_RECT = 600;
/**
 * A surface "inverts" the paper when it sits on the other side of the
 * luminance where black and white text read equally well, and differs from
 * the paper by at least this ratio.
 */
const POLARITY_PIVOT = 0.179;
const SURFACE_BREAK = 3;
/** A sampled surface matches a declared one when they differ by less than this ratio. */
const SAME_SURFACE = 1.15;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(top: Rgb, { under, a }: { under: Rgb; a: number }): Rgb {
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a)];
}

function hex(rgb: readonly number[]): string {
  return `#${rgb.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What the reader sees for one background sample: the text color over the
 * group's own background, then the group faded over a backdrop recovered from
 * the sample. Returns [seen text, seen background].
 */
export function composite(run: Pick<TextRun, "fg" | "group">, sample: Rgb): [Rgb, Rgb] {
  const [fr, fg, fb, fa] = run.fg;
  if (run.group === null) return [mix([fr, fg, fb], { under: sample, a: fa }), sample];
  const { opacity: o, bg } = run.group;
  const unfade = (s: number, b: number): number => Math.min(255, Math.max(0, (s - b * o) / (1 - o)));
  const backdrop: Rgb = o >= 1 ? sample : [unfade(sample[0], bg[0]), unfade(sample[1], bg[1]), unfade(sample[2], bg[2])];
  return [mix(mix([fr, fg, fb], { under: bg, a: fa }), { under: backdrop, a: o }), sample];
}

function samplesOf(image: RawImage, { width, run }: { width: number; run: TextRun }): Rgb[] {
  const scale = image.width / width;
  const out: Rgb[] = [];
  for (const rect of run.rects) {
    // Whole pixels only: a pixel the box only partly covers is blended with
    // its neighbour, such as the edge of a scroller or the panel above it.
    const inner = (from: number, to: number): [number, number] => {
      const [a, b] = [Math.ceil(from * scale), Math.floor(to * scale)];
      return b > a ? [a, b] : [Math.floor(from * scale), Math.ceil(to * scale)];
    };
    const [ix0, ix1] = inner(rect.x, rect.x + rect.w);
    const [iy0, iy1] = inner(rect.y, rect.y + rect.h);
    const x0 = Math.max(0, ix0);
    const y0 = Math.max(0, iy0);
    const x1 = Math.min(image.width, ix1);
    const y1 = Math.min(image.height, iy1);
    const step = Math.max(1, Math.floor(Math.sqrt(Math.max(1, (x1 - x0) * (y1 - y0)) / MAX_SAMPLES_PER_RECT)));
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const i = (y * image.width + x) * image.channels;
        out.push([image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]);
      }
    }
  }
  return out;
}

function surfaceBreak(material: Material, bg: Rgb): number | null {
  if (material.surfaces.some((s) => contrastRatio(s, bg) < SAME_SURFACE)) return null;
  const inverted = (luminance(bg) > POLARITY_PIVOT) !== (luminance(material.paper) > POLARITY_PIVOT);
  const ratio = contrastRatio(bg, material.paper);
  return inverted && ratio >= SURFACE_BREAK ? ratio : null;
}

/** Score runs against the glyph-free capture. Pure, so tests reach it without a browser. */
export function scoreRuns(image: RawImage, page: Pick<PageRuns, "width" | "runs" | "materials">): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const run of page.runs) {
    const samples = samplesOf(image, { width: page.width, run }).map((s) => {
      const [text, bg] = composite(run, s);
      return { ratio: contrastRatio(text, bg), bg };
    });
    if (samples.length === 0) continue;
    const sorted = samples.toSorted((a, b) => a.ratio - b.ratio);
    const at = sorted[Math.min(samples.length - 1, Math.floor(samples.length * PERCENTILE))];
    if (at === undefined) continue;
    const required = run.large || run.placeholder ? LARGE : NORMAL;
    if (at.ratio < required) {
      failures.push({ kind: "text", run: run.id, selector: run.selector, text: run.text, fg: hex(run.fg), bg: hex(at.bg), ratio: round(at.ratio), required });
      continue;
    }
    const material = page.materials[run.material];
    if (material === undefined) continue;
    const median = samples.toSorted((a, b) => luminance(a.bg) - luminance(b.bg))[Math.floor(samples.length / 2)];
    const broke = median === undefined ? null : surfaceBreak(material, median.bg);
    if (broke !== null && median !== undefined) {
      failures.push({ kind: "surface", run: run.id, selector: run.selector, text: run.text, theme: material.theme, bg: hex(median.bg), paper: hex(material.paper), ratio: round(broke), required: SURFACE_BREAK });
    }
  }
  return failures;
}

/** Token pairs below AA, named by token so the fix lands in the theme's material. */
export function scoreMaterials(materials: readonly Material[]): ContrastFailure[] {
  return materials.flatMap((m, material) => m.pairs.flatMap((pair) => {
    const [r, g, b, a] = pair.fgColor;
    const [br, bg, bb] = pair.bgColor;
    const ratio = contrastRatio([r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)], pair.bgColor);
    return ratio >= NORMAL ? [] : [{ kind: "token" as const, material, theme: m.theme, fg: `--bbx-${pair.fg}`, bg: `--bbx-${pair.bg}`, ratio: round(ratio), required: NORMAL }];
  }));
}

/**
 * Selected text below AA. A translucent selection background is scored over
 * white; shipped selection colors are opaque.
 */
export function scoreSelections(selections: readonly Selection[]): ContrastFailure[] {
  return selections.flatMap((s) => {
    const [br, bgG, bb, ba] = s.bg;
    const bg: Rgb = [br * ba + 255 * (1 - ba), bgG * ba + 255 * (1 - ba), bb * ba + 255 * (1 - ba)];
    const [r, g, b, a] = s.fg;
    const fg: Rgb = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
    const ratio = contrastRatio(fg, bg);
    return ratio >= NORMAL ? [] : [{ kind: "selection" as const, selector: s.selector, text: s.text, fg: hex(fg), bg: hex(bg), ratio: round(ratio), required: NORMAL, rects: s.rects }];
  });
}

/** One line per miss: ratio, what, colors, where. */
export function describeContrastFailure(f: ContrastFailure): string {
  const ratio = `${f.ratio.toFixed(2)}:1 < ${String(f.required)}`;
  switch (f.kind) {
    case "text": return `${ratio}  "${f.text}"  ${f.fg} on ${f.bg}  ${f.selector}`;
    case "token": return `${ratio}  ${f.theme}: ${f.fg} on ${f.bg} (material tokens)`;
    case "selection": return `${ratio}  selected "${f.text}"  ${f.fg} on ${f.bg}  ${f.selector}`;
    case "surface": return `surface ${f.bg} is not part of ${f.theme} (paper ${f.paper}) and inverts it ${f.ratio.toFixed(1)}:1  "${f.text}"  ${f.selector}`;
  }
}

function parseEval(stdout: string): PageRuns {
  const once: unknown = JSON.parse(stdout.trim());
  // agent-browser prints eval results as JSON; a string result is JSON again.
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: collectAndHideText builds exactly this shape in the page
  return (typeof once === "string" ? JSON.parse(once) : once) as PageRuns;
}

function marksFor(failures: readonly ContrastFailure[], page: PageRuns): OverlayMark[] {
  const perMaterial = new Map<number, number>();
  return failures.map((f) => {
    if (f.kind === "selection") return { rects: f.rects, label: `selection ${f.ratio.toFixed(1)}:1` };
    if (f.kind !== "token") return { rects: page.runs.find((run) => run.id === f.run)?.rects ?? [], label: f.kind === "text" ? `${f.ratio.toFixed(1)}:1` : `surface ${f.bg}` };
    const n = (perMaterial.get(f.material) ?? 0) + 1;
    perMaterial.set(f.material, n);
    const at = page.materials[f.material]?.at ?? { x: 0, y: 0, w: 1, h: 1 };
    return { rects: [{ x: at.x + 4, y: at.y + 20 * n, w: 1, h: 1 }], label: `${f.fg.slice(6)} on ${f.bg.slice(6)} ${f.ratio.toFixed(1)}:1` };
  });
}

/** One audit of the viewport. Run ids and line numbers are stable across audits of one page load. */
export interface ContrastStep {
  failures: ContrastFailure[];
  /** Ids of the runs scored. */
  runs: number[];
  lines: RunLines[];
  unmeasured: number[];
}

export interface ContrastResult {
  failures: ContrastFailure[];
  runs: number;
  /** Runs with a line no audit saw whole, by label. */
  offscreen: string[];
  /** Runs some audit could not score and whose lines no audit saw all of, by label. */
  unmeasured: string[];
}

function failureKey(f: ContrastFailure): string {
  if (f.kind === "token") return `token ${f.theme} ${f.fg} ${f.bg}`;
  // Scrolling moves the rects; the element and its colors name the miss.
  if (f.kind === "selection") return `selection ${f.selector} ${f.fg} ${f.bg}`;
  return `${f.kind} ${String(f.run)}`;
}

/**
 * Merge audits of one page at several scroll positions. A failure counts once
 * (its lowest ratio); a run is fully measured when every line was seen whole
 * by some audit.
 */
export function mergeContrastSteps(steps: readonly ContrastStep[]): ContrastResult {
  const failures = new Map<string, ContrastFailure>();
  const total = new Map<number, number>();
  const seen = new Map<number, Set<number>>();
  const labels = new Map<number, string>();
  for (const step of steps) {
    for (const f of step.failures) {
      const known = failures.get(failureKey(f));
      if (known === undefined || f.ratio < known.ratio) failures.set(failureKey(f), f);
    }
    for (const { id, label, total: lines, whole } of step.lines) {
      labels.set(id, label);
      total.set(id, Math.max(total.get(id) ?? 0, lines));
      const set = seen.get(id) ?? new Set<number>();
      for (const n of whole) set.add(n);
      seen.set(id, set);
    }
  }
  const missed = [...total].filter(([id, lines]) => (seen.get(id)?.size ?? 0) < lines).map(([id]) => id);
  const unmeasurable = new Set(steps.flatMap((s) => s.unmeasured));
  const label = (id: number): string => labels.get(id) ?? `run ${String(id)}`;
  return {
    failures: [...failures.values()],
    runs: new Set(steps.flatMap((s) => s.runs)).size,
    offscreen: missed.filter((id) => !unmeasurable.has(id)).map(label),
    unmeasured: missed.filter((id) => unmeasurable.has(id)).map(label),
  };
}

/**
 * Measure the current viewport and restore its text. With `outline`, the
 * failures stay drawn on the page for the caller's next screenshot; the next
 * audit or navigation removes them.
 */
export async function auditContrast(page: ContrastPage, { outline, before }: {
  outline: boolean;
  /** Script statements run first in the same call, such as a scroll and a wait for the page to settle. */
  before?: string;
}): Promise<ContrastStep> {
  const dir = await mkdtemp(path.join(tmpdir(), "bbx-contrast-"));
  let marks: OverlayMark[] = [];
  try {
    const runs = parseEval(await page.eval(before === undefined ? COLLECT_SCRIPT : `(async () => { ${before}\nreturn ${COLLECT_SCRIPT}; })()`));
    const shot = path.join(dir, "background.png");
    await page.screenshot(shot);
    const { data, info } = await Sharp(shot).raw().toBuffer({ resolveWithObject: true });
    if (Math.abs(info.height / info.width - runs.height / runs.width) > 0.01) {
      throw new Error(`contrast audit: capture is ${String(info.width)}×${String(info.height)} but the viewport is ${String(runs.width)}×${String(runs.height)}`);
    }
    const failures = [...scoreRuns({ data, width: info.width, height: info.height, channels: info.channels }, runs), ...scoreMaterials(runs.materials), ...scoreSelections(runs.selections)];
    if (outline) marks = marksFor(failures, runs);
    return { failures, runs: runs.runs.map(({ id }) => id), lines: runs.lines, unmeasured: runs.unmeasured };
  } finally {
    // One round trip: each browse call costs about a second.
    await page.eval(restoreAndMarkScript(marks));
    await rm(dir, { recursive: true, force: true });
  }
}
