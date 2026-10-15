// Emits the SVG figures embedded in overview.md from the numbers in
// reports/sweep-walks.md and reports/sweep-issues.md. Rerun after a new
// round lands and the sweeps are refreshed:
//
//   node --import tsx dev/journeys/figures.ts
//
// One accent hue, gray for everything that is not the point, aqua reserved
// for "fixed", orange for "harness". Numbers live only in the DATA block.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "figures");

const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const AQUA = "#1baf7a";
const RED = "#d03b3b";
const INK = "#1f2933";
const MUTED = "#6b7280";
const RULE = "#d9dde3";
const LIGHT = "#e8eef7";
const PAPER = "#ffffff";

// ---------------------------------------------------------------- DATA

type Walk = {
  journey: "A" | "B" | "C" | "D" | "F";
  round: 0 | 1 | 2 | 3;
  rows: number;
  harness: number;
  filed: number;
  note?: string;
};

// Claim rows, harness rows and new issues filed per walk (sweep-walks §4, §7;
// sweep-issues §5, §8). The two Aug 23 B pilots have no claim table.
const WALKS: Walk[] = [
  { journey: "B", round: 0, rows: 11, harness: 4, filed: 3 },
  { journey: "A", round: 0, rows: 19, harness: 1, filed: 8 },
  { journey: "C", round: 1, rows: 30, harness: 3, filed: 3 },
  { journey: "D", round: 1, rows: 85, harness: 5, filed: 5 },
  { journey: "F", round: 1, rows: 85, harness: 2, filed: 5 },
  { journey: "A", round: 2, rows: 88, harness: 4, filed: 17 },
  { journey: "B", round: 2, rows: 119, harness: 11, filed: 7, note: "photos damaged in repo" },
  { journey: "B", round: 2, rows: 91, harness: 12, filed: 4, note: "relative upload path" },
  { journey: "C", round: 2, rows: 49, harness: 3, filed: 5 },
  { journey: "D", round: 2, rows: 108, harness: 6, filed: 5 },
  { journey: "F", round: 2, rows: 116, harness: 2, filed: 4 },
  { journey: "A", round: 3, rows: 79, harness: 12, filed: 6, note: "5-hour stall" },
  { journey: "B", round: 3, rows: 90, harness: 10, filed: 3 },
  { journey: "C", round: 3, rows: 88, harness: 5, filed: 3 },
  { journey: "D", round: 3, rows: 84, harness: 11, filed: 4, note: "0 screenshots" },
  { journey: "D", round: 3, rows: 82, harness: 4, filed: 1 },
  { journey: "F", round: 3, rows: 97, harness: 5, filed: 3 },
];

const ROUNDS = ["Aug 23–25", "Sep 20–21", "Oct 8", "Oct 9"];
const JOURNEYS: Array<[Walk["journey"], string]> = [
  ["A", "Lending"],
  ["B", "Inventory"],
  ["C", "Reconnecting"],
  ["D", "Chemistry"],
  ["F", "Newcomer"],
];

// Funnel (sweep-issues §8, flow block).
const FUNNEL = {
  rows: 1321,
  product: 1057,
  harness: 100,
  wishes: 74,
  unverified: 26,
  other: 64, // environment, boundary, dissolved, other
  issues: 98,
  implemented: 47,
  wontfix: 3,
  needsHuman: 8,
  deferred: 10,
  harnessOpen: 2,
  untouched: 28,
};

// Kinds (sweep-issues §8 §2): [label, open, closed]
const KINDS: Array<[string, number, number]> = [
  ["Functional defect", 13, 16],
  ["Vocabulary, wording", 11, 14],
  ["Assistant behavior", 6, 6],
  ["Navigation, layout", 4, 5],
  ["Missing feature", 7, 0],
  ["Harness, tooling", 2, 4],
  ["Accessibility naming", 1, 3],
  ["Decision needed", 3, 0],
  ["Privacy boundary", 1, 2],
];

// Days from filing to close for the 50 closed issues (sweep-issues §8 §3).
const DAYS_TO_CLOSE = [
  ...Array.from({ length: 33 }, () => 0),
  1, 1, 1, 1, 1, 3, 4, 4, 6, 6, 9, 15, 17, 21, 22, 26, 31,
];

// Five whole-life stories (overview §10). Dates are 2026.
type Ev = { d: string; kind: "filed" | "re" | "closed" | "wontfix" | "confirmed" | "open" };
const STORIES: Array<{ name: string; events: Ev[] }> = [
  {
    name: "plate header prints a scope glob",
    events: [
      { d: "10-08", kind: "filed" },
      { d: "10-08", kind: "closed" },
      { d: "10-09", kind: "confirmed" },
    ],
  },
  {
    name: "document metadata displaces the reading view",
    events: [
      { d: "09-21", kind: "filed" },
      { d: "09-21", kind: "re" },
      { d: "10-06", kind: "closed" },
      { d: "10-08", kind: "confirmed" },
    ],
  },
  {
    name: "tutor teaches a neutral-isotope rule",
    events: [
      { d: "09-21", kind: "filed" },
      { d: "09-24", kind: "wontfix" },
      { d: "10-08", kind: "confirmed" },
      { d: "10-09", kind: "confirmed" },
    ],
  },
  {
    name: "chats bind to a landmark once and never move",
    events: [
      { d: "08-25", kind: "filed" },
      { d: "09-21", kind: "re" },
      { d: "10-08", kind: "re" },
      { d: "10-09", kind: "re" },
      { d: "10-10", kind: "open" },
    ],
  },
  {
    name: "fresh-chat reservation suppresses openers",
    events: [
      { d: "09-21", kind: "filed" },
      { d: "10-08", kind: "re" },
      { d: "10-08", kind: "closed" },
      { d: "10-09", kind: "confirmed" },
    ],
  },
];

// Recurring frictions by round (overview §11): h = hit, p = partly fixed,
// f = fixed and confirmed, "" = not reported.
const FRICTION: Array<[string, string[]]> = [
  ["First screen says nothing; no openers", ["h", "h", "h", "p"]],
  ["No front door to the collection", ["h", "", "h", "p"]],
  ["Activity rows speak in commands and files", ["", "", "h", "h"]],
  ["Agent promises delivery it cannot make", ["", "h", "h", "h"]],
  ["Implementation vocabulary on screen", ["h", "h", "h", "p"]],
  ["Plate badge opens Browse, hides the chat", ["", "h", "h", "f"]],
  ["Conversations never get a title", ["", "h", "h", "f"]],
  ["Chats bind to a landmark once", ["h", "", "h", "h"]],
  ["Structured card fronts hide their facts", ["", "", "h", "h"]],
];

// ---------------------------------------------------------------- helpers

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Anchor = "start" | "middle" | "end";
const text = (
  x: number,
  y: number,
  s: string,
  o: { size?: number; fill?: string; anchor?: Anchor; weight?: number; mono?: boolean } = {},
): string =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 13}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? "start"}" font-weight="${o.weight ?? 400}"${o.mono ? ' font-family="ui-monospace, SFMono-Regular, Menlo, monospace"' : ""}>${esc(s)}</text>`;

const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ""): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;

const line = (x1: number, y1: number, x2: number, y2: number, stroke = RULE, w = 1, extra = ""): string =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" ${extra}/>`;

const circle = (cx: number, cy: number, r: number, fill: string, extra = ""): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;

const svg = (w: number, h: number, title: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
${rect(0, 0, w, h, PAPER)}
${body}
</svg>
`;

const fmt = (n: number): string => n.toLocaleString("en-US");

// ---------------------------------------------------------------- 1. pipeline

function pipeline(): string {
  const W = 960;
  const H = 300;
  const steps: Array<{ name: string; what: string; tracked: boolean }> = [
    { name: "Define", what: "the person, the box, watch_for", tracked: true },
    { name: "Prepare", what: "fresh box, prompt, snapshot", tracked: true },
    { name: "Walk", what: "an agent plays the person", tracked: false },
    { name: "Collect", what: "box commits, shot clock", tracked: false },
    { name: "After-action", what: "one row per claim, four buckets", tracked: true },
    { name: "Report", what: "the only durable record", tracked: true },
    { name: "Issues", what: "filed, corrected, re-met", tracked: true },
  ];
  const n = steps.length;
  const gap = 10;
  const x0 = 24;
  const bw = (W - 2 * x0 - gap * (n - 1)) / n;
  const y = 70;
  const bh = 64;
  let b = "";
  b += text(x0, 34, "The pipeline: seven steps, five of them in git", { size: 18, weight: 600 });
  steps.forEach((s, i) => {
    const x = x0 + i * (bw + gap);
    const fill = s.tracked ? LIGHT : PAPER;
    const stroke = s.tracked ? BLUE : MUTED;
    b += rect(x, y, bw, bh, fill, `rx="6" stroke="${stroke}" stroke-width="1.5"${s.tracked ? "" : ' stroke-dasharray="4 3"'}`);
    b += text(x + bw / 2, y + 26, s.name, { anchor: "middle", weight: 600, size: 14 });
    b += text(x + bw / 2, y + 46, s.tracked ? "in git" : "gitignored", { anchor: "middle", size: 11, fill: s.tracked ? BLUE : MUTED });
    if (i < n - 1) {
      const ax = x + bw + gap / 2;
      b += `<path d="M${x + bw + 1} ${y + bh / 2} L${ax + 4} ${y + bh / 2}" stroke="${MUTED}" stroke-width="1.5" marker-end="url(#arr)"/>`;
    }
    // caption under each box, wrapped by hand into two lines
    const words = s.what.split(" ");
    const l1: string[] = [];
    const l2: string[] = [];
    for (const w of words) (l1.join(" ").length < 13 ? l1 : l2).push(w);
    b += text(x + bw / 2, y + bh + 22, l1.join(" "), { anchor: "middle", size: 11.5, fill: MUTED });
    b += text(x + bw / 2, y + bh + 38, l2.join(" "), { anchor: "middle", size: 11.5, fill: MUTED });
  });
  // the rule and the loop
  b += text(x0, 210, "Nothing from a walk becomes a finding until it has been separately verified.", { size: 13, fill: INK });
  b += text(x0, 230, "The walker's job is to notice. The reader's is to find out what actually happened.", { size: 13, fill: MUTED });
  const lx = x0 + 6 * (bw + gap) + bw / 2;
  const sx = x0 + 2 * (bw + gap) + bw / 2;
  b += `<path d="M${lx} ${y + bh + 46} C ${lx} 275, ${sx} 275, ${sx} ${y + bh + 46}" fill="none" stroke="${BLUE}" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#arrb)"/>`;
  b += text((lx + sx) / 2, 262, "the next round's walk re-checks every open issue it meets", { anchor: "middle", size: 11.5, fill: BLUE });
  const defs = `<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${MUTED}"/></marker><marker id="arrb" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${BLUE}"/></marker></defs>`;
  return svg(W, H, "The journey pipeline", defs + b);
}

// ---------------------------------------------------------------- 2. funnel

function funnel(): string {
  const W = 960;
  const H = 360;
  const x0 = 24;
  const barW = W - 2 * x0;
  let b = "";
  b += text(x0, 34, "From 1,321 claim rows to 98 issues to 47 fixes", { size: 18, weight: 600 });

  const segs1: Array<[string, number, string]> = [
    ["product", FUNNEL.product, BLUE],
    ["harness", FUNNEL.harness, ORANGE],
    ["wishes", FUNNEL.wishes, "#9bbbe6"],
    ["unverified", FUNNEL.unverified, "#c7cdd6"],
    ["other", FUNNEL.other, "#e1e5ea"],
  ];
  const y1 = 70;
  const h1 = 36;
  b += text(x0, y1 - 10, `Claim rows, 17 walks with tables: ${fmt(FUNNEL.rows)}`, { size: 12.5, fill: MUTED });
  let x = x0;
  for (const [label, v, fill] of segs1) {
    const w = (v / FUNNEL.rows) * barW;
    b += rect(x, y1, Math.max(w - 2, 1), h1, fill, 'rx="3"');
    if (w > 120) b += text(x + 8, y1 + 23, `${label} ${fmt(v)}`, { size: 12.5, fill: fill === BLUE ? PAPER : INK });
    x += w;
  }
  // small labels for thin segments
  b += text(x0 + barW, y1 + h1 + 16, `harness ${FUNNEL.harness} · wishes ${FUNNEL.wishes} · unverified ${FUNNEL.unverified} · other ${FUNNEL.other}`, { anchor: "end", size: 11, fill: MUTED });

  // wedge to issues
  const y2 = 170;
  const h2 = 36;
  const issuesW = (FUNNEL.issues / FUNNEL.rows) * barW * 6; // scaled ×6 so it is legible; said in the label
  b += `<path d="M${x0} ${y1 + h1 + 24} L${x0 + barW} ${y1 + h1 + 24} L${x0 + issuesW} ${y2} L${x0} ${y2} Z" fill="${LIGHT}" opacity="0.7"/>`;
  b += text(x0 + barW, y2 - 8, "one issue per 13 rows; issues drawn at 6× so the bar can be read", { anchor: "end", size: 11, fill: MUTED });
  b += text(x0, y2 - 10, `Issues filed: ${FUNNEL.issues}`, { size: 12.5, fill: MUTED });
  const segs2: Array<[string, number, string]> = [
    ["fixed", FUNNEL.implemented, AQUA],
    ["won't fix", FUNNEL.wontfix, "#9fd9c3"],
    ["needs a human", FUNNEL.needsHuman, RED],
    ["deferred", FUNNEL.deferred, "#c7cdd6"],
    ["harness", FUNNEL.harnessOpen, ORANGE],
    ["untouched", FUNNEL.untouched, "#e1e5ea"],
  ];
  x = x0;
  for (const [label, v, fill] of segs2) {
    const w = (v / FUNNEL.issues) * issuesW;
    b += rect(x, y2, Math.max(w - 2, 1), h2, fill, 'rx="3"');
    if (w > 70) b += text(x + 8, y2 + 23, `${label} ${v}`, { size: 12.5, fill: fill === AQUA || fill === RED ? PAPER : INK });
    x += w;
  }
  b += text(x0, y2 + h2 + 18, `won't fix ${FUNNEL.wontfix} · needs a human ${FUNNEL.needsHuman} · deferred ${FUNNEL.deferred} · harness ${FUNNEL.harnessOpen} · untouched ${FUNNEL.untouched}`, { size: 11, fill: MUTED });

  // the three sentences
  const ty = 270;
  b += text(x0, ty, "100 rows were the instrument, not the product. The pilot's ratio was 4 of 11.", { size: 13 });
  b += text(x0, ty + 22, "33 of the 50 closes happened the same day, by the walk's own workstream. The other 17 took a median of 6 days.", { size: 13 });
  b += text(x0, ty + 44, "Feature wishes: 7 filed, 0 closed. Decisions: 3 filed, 0 closed. No journey issue has ever used the manual-testing gate.", { size: 13 });
  return svg(W, H, "Claim-to-issue funnel", b);
}

// ---------------------------------------------------------------- 3. rounds grid

function roundsGrid(): string {
  const W = 960;
  const H = 400;
  const x0 = 150;
  const y0 = 80;
  const colW = (W - x0 - 30) / ROUNDS.length;
  const rowH = 52;
  let b = "";
  b += text(24, 34, "Nineteen walks: dot area is claim rows, orange is the harness share, number is new issues filed", { size: 16, weight: 600 });
  ROUNDS.forEach((r, i) => b += text(x0 + colW * i + colW / 2, y0 - 22, r, { anchor: "middle", size: 13, weight: 600 }));
  JOURNEYS.forEach(([j, name], ri) => {
    const cy = y0 + ri * rowH + rowH / 2;
    b += text(24, cy + 5, `${j}  ${name}`, { size: 13 });
    b += line(x0 - 10, cy + rowH / 2, W - 30, cy + rowH / 2);
    for (let c = 0; c < ROUNDS.length; c++) {
      const ws = WALKS.filter((w) => w.journey === j && w.round === c);
      const slot = colW / (ws.length + 1);
      ws.forEach((w, k) => {
        const cx = x0 + colW * c + slot * (k + 1);
        const r = Math.sqrt(w.rows) * 1.35;
        b += circle(cx, cy, r, BLUE, 'opacity="0.85"');
        const hr = Math.sqrt(w.harness) * 1.35;
        b += circle(cx, cy, hr, ORANGE);
        b += text(cx + r + 4, cy + 4, String(w.filed), { size: 12, weight: 600 });
        if (w.note) b += text(cx, k % 2 ? cy - r - 6 : cy + r + 13, w.note, { anchor: "middle", size: 9.5, fill: MUTED });
      });
    }
  });
  // B's two Aug 23 pilots
  b += text(x0 + colW / 2, y0 + rowH + rowH / 2 + 32, "", { size: 9.5 });
  const ly = y0 + 5 * rowH + 24;
  b += circle(40, ly, Math.sqrt(100) * 1.35, BLUE, 'opacity="0.85"');
  b += text(60, ly + 4, "100 claim rows", { size: 12, fill: MUTED });
  b += circle(190, ly, Math.sqrt(10) * 1.35, ORANGE);
  b += text(203, ly + 4, "10 of them the harness, not the product", { size: 12, fill: MUTED });
  b += text(440, ly + 4, "Not drawn: two Aug 23 pilots with no claim table; a Sep 21 recovery pass.", { size: 11.5, fill: MUTED });
  b += text(24, ly + 34, "Oct 8 filed 43 issues; Oct 9 filed 23 and spent its rows re-checking the day before (73 re-encounter rows against 29).", { size: 12.5 });
  return svg(W, H, "Walks by journey and round", b);
}

// ---------------------------------------------------------------- 4. kinds

function kinds(): string {
  const W = 960;
  const H = 330;
  const x0 = 220;
  const y0 = 60;
  const rowH = 26;
  const max = Math.max(...KINDS.map(([, o, c]) => o + c));
  const scale = (W - x0 - 120) / max;
  let b = "";
  b += text(24, 34, "What the 98 issues are, and which kinds close", { size: 18, weight: 600 });
  KINDS.forEach(([label, open, closed], i) => {
    const y = y0 + i * rowH;
    b += text(x0 - 10, y + 15, label, { anchor: "end", size: 12.5 });
    const cw = closed * scale;
    const ow = open * scale;
    if (closed) b += rect(x0, y + 3, cw - (open ? 2 : 0), 16, AQUA, 'rx="3"');
    if (open) b += rect(x0 + cw, y + 3, ow, 16, "#c7cdd6", 'rx="3"');
    b += text(x0 + cw + ow + 8, y + 15, `${closed} closed · ${open} open`, { size: 11.5, fill: MUTED });
  });
  const ly = y0 + KINDS.length * rowH + 22;
  b += rect(x0, ly - 10, 14, 12, AQUA, 'rx="2"');
  b += text(x0 + 20, ly, "closed", { size: 12, fill: MUTED });
  b += rect(x0 + 80, ly - 10, 14, 12, "#c7cdd6", 'rx="2"');
  b += text(x0 + 100, ly, "open", { size: 12, fill: MUTED });
  b += text(24, ly + 28, "Defects and wording close. Feature wishes never have. Assistant behavior closes only through guidance changes,", { size: 12.5 });
  b += text(24, ly + 46, "and the next walk saw three of the four Oct 9 guidance closes still present.", { size: 12.5 });
  return svg(W, H, "Issue kinds, open and closed", b);
}

// ---------------------------------------------------------------- 5. days to close

function daysToClose(): string {
  const W = 960;
  const H = 230;
  const x0 = 60;
  const axisY = 140;
  const scale = (W - x0 - 40) / 32;
  let b = "";
  b += text(24, 34, "Two speeds: days from filing to close, 50 closed issues", { size: 18, weight: 600 });
  b += line(x0, axisY, x0 + 32 * scale, axisY, RULE, 1);
  for (const t of [0, 5, 10, 15, 20, 25, 30]) {
    b += line(x0 + t * scale, axisY, x0 + t * scale, axisY + 5, MUTED, 1);
    b += text(x0 + t * scale, axisY + 20, String(t), { anchor: "middle", size: 11, fill: MUTED });
  }
  b += text(x0 + 32 * scale, axisY + 20, "days", { anchor: "end", size: 11, fill: MUTED });
  // stack dots per day
  const counts = new Map<number, number>();
  for (const d of DAYS_TO_CLOSE) {
    const k = Math.max(d, 0);
    const n = counts.get(k) ?? 0;
    const col = Math.floor(n / 11);
    const row = n % 11;
    const cx = x0 + k * scale + col * 9 - (k === 0 ? 9 : 0);
    const cy = axisY - 8 - row * 9;
    b += circle(cx, cy, 3.6, k === 0 ? AQUA : BLUE);
    counts.set(k, n + 1);
  }
  b += text(x0 + 30, 50, "33 same day", { size: 12.5, weight: 600, fill: AQUA });
  b += text(x0 + 30, 66, "the walk's own workstream fixes what it found", { size: 11.5, fill: MUTED });
  b += text(x0 + 9 * scale, 92, "17 later, median 6 days", { size: 12.5, weight: 600, fill: BLUE });
  b += text(x0 + 9 * scale, 108, "a planned workstream picks the issue up; the next walk confirms it", { size: 11.5, fill: MUTED });
  b += text(24, 190, "Nothing in between: no journey issue was closed by a pick-from-the-queue session, apart from two small batches.", { size: 12.5 });
  b += text(24, 208, "The 48 still open: 8 wait on a decision, 10 are deferred, 2 are harness, 28 are untriaged (neither October round has priorities).", { size: 12.5 });
  return svg(W, H, "Days from filing to close", b);
}

// ---------------------------------------------------------------- 6. stories

function stories(): string {
  const W = 960;
  const H = 350;
  const x0 = 320;
  const y0 = 70;
  const rowH = 40;
  const start = new Date("2026-08-20").getTime();
  const end = new Date("2026-10-12").getTime();
  const xOf = (d: string): number => x0 + ((new Date(`2026-${d}`).getTime() - start) / (end - start)) * (W - x0 - 30);
  let b = "";
  b += text(24, 34, "Five issues, whole life", { size: 18, weight: 600 });
  for (const m of ["08-25", "09-01", "09-15", "10-01", "10-08"]) {
    b += line(xOf(m), y0 - 14, xOf(m), y0 + STORIES.length * rowH - 10, RULE);
    b += text(xOf(m), y0 - 20, m.replace("-", "/"), { anchor: "middle", size: 11, fill: MUTED });
  }
  STORIES.forEach((s, i) => {
    const cy = y0 + i * rowH + 10;
    b += text(x0 - 12, cy + 4, s.name, { anchor: "end", size: 12.5 });
    const first = xOf(s.events[0].d);
    const last = xOf(s.events[s.events.length - 1].d);
    const endsOpen = s.events[s.events.length - 1].kind === "open";
    b += line(first, cy, last, cy, endsOpen ? RED : BLUE, 2, endsOpen ? 'stroke-dasharray="4 3"' : "");
    for (const e of s.events) {
      const x = xOf(e.d);
      switch (e.kind) {
        case "filed":
          b += circle(x, cy, 5, BLUE);
          break;
        case "re":
          b += circle(x, cy, 5, PAPER, `stroke="${BLUE}" stroke-width="2"`);
          break;
        case "closed":
          b += rect(x - 5, cy - 5, 10, 10, AQUA, 'rx="2"');
          break;
        case "wontfix":
          b += rect(x - 5, cy - 5, 10, 10, "#9fd9c3", 'rx="2"');
          break;
        case "confirmed":
          b += `<path d="M${x - 5} ${cy} l3.5 3.5 l6 -7" fill="none" stroke="${AQUA}" stroke-width="2.2"/>`;
          break;
        case "open":
          b += text(x + 8, cy + 4, "open", { size: 11, fill: RED, weight: 600 });
          break;
      }
    }
  });
  const ly = y0 + STORIES.length * rowH + 14;
  const leg: Array<[string, string]> = [
    ["filed", "filled dot"],
    ["re-encountered by a later walk", "ring"],
    ["closed", "square"],
    ["won't fix", "pale square"],
    ["next walk confirmed", "tick"],
  ];
  let lx = 24;
  for (const [k, shape] of leg) {
    if (shape === "filled dot") b += circle(lx + 5, ly, 5, BLUE);
    if (shape === "ring") b += circle(lx + 5, ly, 5, PAPER, `stroke="${BLUE}" stroke-width="2"`);
    if (shape === "square") b += rect(lx, ly - 5, 10, 10, AQUA, 'rx="2"');
    if (shape === "pale square") b += rect(lx, ly - 5, 10, 10, "#9fd9c3", 'rx="2"');
    if (shape === "tick") b += `<path d="M${lx} ${ly} l3.5 3.5 l6 -7" fill="none" stroke="${AQUA}" stroke-width="2.2"/>`;
    b += text(lx + 16, ly + 4, k, { size: 11.5, fill: MUTED });
    lx += 16 + k.length * 6.6 + 18;
  }
  b += text(24, ly + 30, "The openers issue was re-encountered by all six Oct 8 walks on their first screenshot, closed that day, and confirmed by all six Oct 9 walks.", { size: 12.5 });
  b += text(24, ly + 48, "The landmark-binding issue has been hit by three walks over 46 days and waits on a decision between three options.", { size: 12.5 });
  return svg(W, H, "Five issue lifelines", b);
}

// ---------------------------------------------------------------- 7. friction grid

function friction(): string {
  const W = 960;
  const H = 445;
  const x0 = 380;
  const y0 = 80;
  const colW = 120;
  const rowH = 30;
  let b = "";
  b += text(24, 34, "What keeps coming back: frictions by round", { size: 18, weight: 600 });
  ROUNDS.forEach((r, i) => b += text(x0 + colW * i + colW / 2, y0 - 16, r, { anchor: "middle", size: 12.5, weight: 600 }));
  FRICTION.forEach(([label, cells], ri) => {
    const y = y0 + ri * rowH;
    b += text(x0 - 12, y + 19, label, { anchor: "end", size: 12.5 });
    cells.forEach((c, ci) => {
      const cx = x0 + colW * ci + colW / 2;
      const cy = y + 14;
      if (c === "h") b += circle(cx, cy, 8, BLUE);
      if (c === "p") {
        b += circle(cx, cy, 8, PAPER, `stroke="${AQUA}" stroke-width="2"`);
        b += `<path d="M${cx} ${cy - 8} A8 8 0 0 1 ${cx} ${cy + 8} Z" fill="${AQUA}"/>`;
      }
      if (c === "f") b += `<path d="M${cx - 7} ${cy} l5 5 l9 -10" fill="none" stroke="${AQUA}" stroke-width="2.5"/>`;
    });
  });
  const ly = y0 + FRICTION.length * rowH + 22;
  b += circle(34, ly, 8, BLUE);
  b += text(50, ly + 4, "reported", { size: 12, fill: MUTED });
  b += circle(140, ly, 8, PAPER, `stroke="${AQUA}" stroke-width="2"`);
  b += `<path d="M140 ${ly - 8} A8 8 0 0 1 140 ${ly + 8} Z" fill="${AQUA}"/>`;
  b += text(156, ly + 4, "partly fixed", { size: 12, fill: MUTED });
  b += `<path d="M${258} ${ly} l5 5 l9 -10" fill="none" stroke="${AQUA}" stroke-width="2.5"/>`;
  b += text(282, ly + 4, "fixed and confirmed by the next walk", { size: 12, fill: MUTED });
  b += text(24, ly + 34, "Each round's biggest complaint is fixed before the next; the fix brings a smaller defect in the surface that fixed it.", { size: 12.5 });
  b += text(24, ly + 52, "Oct 9's main defect, a root place page saying \"Nothing here yet\" beside a box full of cards, was introduced by the work that fixed the openers.", { size: 12.5 });
  return svg(W, H, "Recurring frictions by round", b);
}

// ---------------------------------------------------------------- write

mkdirSync(OUT, { recursive: true });
const figures: Array<[string, () => string]> = [
  ["pipeline.svg", pipeline],
  ["funnel.svg", funnel],
  ["rounds.svg", roundsGrid],
  ["kinds.svg", kinds],
  ["days-to-close.svg", daysToClose],
  ["stories.svg", stories],
  ["friction.svg", friction],
];
for (const [name, fn] of figures) {
  writeFileSync(join(OUT, name), fn());
  console.log(`wrote figures/${name}`);
}
