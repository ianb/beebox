// Emits the SVG figures embedded in timeline.md. Rerun after the data block
// changes:
//
//   node --import tsx dev/devprocess-talk/figures.ts
//
// Dates come from `git log --diff-filter=A|D -- '.claude/skills/*/SKILL.md'`
// (first and last commit per skill) and `git log --format=%ad -- .claude/skills`
// for edits per month. Renames (cb- to bbx-, codex to cross-model,
// agent-browser to browse) are one bar under the current name.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "figures");

const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const AQUA = "#1baf7a";
const INK = "#1f2933";
const MUTED = "#6b7280";
const RULE = "#d9dde3";
const PAPER = "#ffffff";

// ---------------------------------------------------------------- DATA

type Skill = { name: string; born: string; died?: string; kind: "workflow" | "craft" };

const TODAY = "2026-10-09";

const SKILLS: Skill[] = [
  { name: "finish", born: "2026-05-26", kind: "workflow" },
  { name: "browse", born: "2026-05-26", kind: "workflow" },
  { name: "launch-worktree-session", born: "2026-05-27", kind: "workflow" },
  { name: "plan", born: "2026-05-29", kind: "workflow" },
  { name: "cross-model", born: "2026-06-04", kind: "workflow" },
  { name: "skill-creator", born: "2026-06-20", died: "2026-08-03", kind: "craft" },
  { name: "debug", born: "2026-06-20", died: "2026-10-07", kind: "craft" },
  { name: "codehealth", born: "2026-06-20", died: "2026-10-07", kind: "craft" },
  { name: "frontend", born: "2026-06-20", died: "2026-10-07", kind: "craft" },
  { name: "context", born: "2026-06-20", kind: "craft" },
  { name: "migration", born: "2026-06-26", kind: "workflow" },
  { name: "prompt-review", born: "2026-07-01", died: "2026-08-03", kind: "craft" },
  { name: "guide-api", born: "2026-07-04", kind: "craft" },
  { name: "guide-schemas", born: "2026-07-04", kind: "craft" },
  { name: "guide-testing", born: "2026-07-04", died: "2026-10-07", kind: "craft" },
  { name: "canvas-loop-sketch", born: "2026-07-14", died: "2026-10-07", kind: "craft" },
  { name: "ios-overlap", born: "2026-08-03", kind: "workflow" },
  { name: "doctest", born: "2026-08-03", kind: "workflow" },
  { name: "issues", born: "2026-08-03", kind: "workflow" },
  { name: "knowledge-audit", born: "2026-08-03", kind: "workflow" },
  { name: "security-report", born: "2026-08-07", kind: "workflow" },
  { name: "field-probe", born: "2026-08-12", kind: "workflow" },
  { name: "issue-actions", born: "2026-08-13", kind: "workflow" },
  { name: "user-copy", born: "2026-08-19", died: "2026-08-19", kind: "craft" },
  { name: "pick-issues", born: "2026-08-24", kind: "workflow" },
  { name: "authoring-schedules", born: "2026-08-24", kind: "workflow" },
  { name: "browser-task", born: "2026-09-12", died: "2026-10-07", kind: "craft" },
  { name: "deploy-status", born: "2026-10-07", kind: "workflow" },
  { name: "box-work", born: "2026-10-07", kind: "workflow" },
  { name: "design", born: "2026-10-07", kind: "workflow" },
];

// Commits touching .claude/skills, per month.
const EDITS: Array<[string, number]> = [
  ["2026-05", 16],
  ["2026-06", 25],
  ["2026-07", 23],
  ["2026-08", 105],
  ["2026-09", 68],
  ["2026-10", 40],
];

// Commits per month (git log --format=%ad --date=format:%Y-%m), with the
// phase each month belongs to on timeline.md.
const COMMITS: Array<[string, number, string]> = [
  ["Jan", 25, "checks"],
  ["Feb", 201, "checks"],
  ["Mar", 266, "checks"],
  ["Apr", 214, "quiet"],
  ["May", 482, "checkouts"],
  ["Jun", 748, "review"],
  ["Jul", 1510, "queue"],
  ["Aug", 2305, "unattended"],
  ["Sep", 2268, "instructions"],
  ["Oct", 1046, "measured"],
];
const PHASES: Array<[string, string]> = [
  ["checks", "checks before trust"],
  ["quiet", "quiet"],
  ["checkouts", "checkouts"],
  ["review", "2nd model"],
  ["queue", "the queue"],
  ["unattended", "unattended"],
  ["instructions", "instructions"],
  ["measured", "measured"],
];

// Worktree branches landing on main per month (inventory, repo-wide numbers).
// Undercounts before 2026-08-24, when landings were fast-forwards.
const LANDINGS: Array<[string, number]> = [
  ["May", 6],
  ["Jun", 34],
  ["Jul", 25],
  ["Aug", 114],
  ["Sep", 305],
  ["Oct", 116],
];

// Word count of the always-loaded instruction files at the first commit on or
// before each date: the package file (the main system) and the monorepo root.
const INSTRUCTIONS: Array<[string, number, number | null]> = [
  ["2026-02-01", 1324, null],
  ["2026-03-01", 1249, null],
  ["2026-03-04", 946, null],
  ["2026-04-01", 1106, null],
  ["2026-05-01", 1446, null],
  ["2026-06-01", 1545, 848],
  ["2026-07-01", 1685, 1267],
  ["2026-08-01", 2348, 1299],
  ["2026-09-01", 2514, 2204],
  ["2026-09-13", 1094, 868],
  ["2026-10-01", 1218, 977],
  ["2026-10-10", 1266, 1355],
];

// Issues filed (file date prefix) and moved to closed (first git add under
// issues/closed/) per month. The tree started 2026-07-04; earlier filed rows
// are backfilled dates.
const ISSUES: Array<[string, number, number]> = [
  ["Jul", 227, 133],
  ["Aug", 430, 298],
  ["Sep", 314, 208],
  ["Oct", 153, 124],
];
const OPEN_NOW = 489;

// Events live in lanes.md: one `## kind` section per kind, one
// `YYYY-MM-DD — label` line per event. Each kind draws in one of two lanes
// with its own color; the mapping is here.
type Event = { date: string; label: string; kind: string; key: boolean; detail: string; show: string[] };
type Kind = { lane: "code" | "product"; color: string; legend: string };
const KINDS: Record<string, Kind> = {
  process: { lane: "code", color: BLUE, legend: "process: how agents are run and checked" },
  sweeps: { lane: "code", color: ORANGE, legend: "sweeps: one-off cleanups across code or docs" },
  product: { lane: "product", color: AQUA, legend: "features a person notices" },
  infrastructure: { lane: "product", color: "#7c5cbf", legend: "infrastructure the product runs on" },
};
const LANE_ORDER: Array<"code" | "product"> = ["code", "product"];

function readEvents(): Event[] {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "lanes.md"), "utf8");
  const events: Event[] = [];
  let kind: string | null = null;
  for (const raw of src.split("\n")) {
    const h = /^## (\w+)\s*$/.exec(raw);
    if (h) {
      kind = h[1]!;
      if (!(kind in KINDS)) throw new Error(`lanes.md: unknown kind "${kind}"`);
      continue;
    }
    const e = /^(\d{4}-\d{2}-\d{2}) — ([^—#]+?)(?: — ([^#]*?))?\s*((?:#\S+\s*)*)$/.exec(raw);
    if (e) {
      if (kind === null) throw new Error(`lanes.md: event before any heading: ${raw}`);
      const tags = (e[4] ?? "").split(/\s+/).filter(Boolean);
      let key = false;
      let show: string[] = [];
      for (const t of tags) {
        if (t === "#key") key = true;
        else if (t.startsWith("#show=")) show = t.slice(6).split(",").filter(Boolean);
        else throw new Error(`lanes.md: unknown tag ${t} on: ${raw}`);
      }
      events.push({ date: e[1]!, label: e[2]!.trim(), kind, key, detail: (e[3] ?? "").trim(), show });
    } else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      throw new Error(`lanes.md: malformed event line: ${raw}`);
    }
  }
  return events;
}

/** Where a file exhibit's source link points. */
const REPO_URL = "https://github.com/ianb/beebox";
// Chapters live in chapters.md: `## title`, then `span:`, `stats:`, `kinds:`,
// `events:` lines, then Markdown bullets for the card.
type Exhibit =
  | { kind: "graph"; title: string; stats: string[]; kinds: string[]; events: "key" | "all"; scale: "global" | "view"; from?: string; to?: string }
  | { kind: "code"; title: string; file: string; href: string; code: string; body: string[]; images?: string[] }
  | { kind: "text"; title: string; body: string[]; images?: string[] };
type Chapter = { title: string; from: string; to: string; comic?: string; tagline?: string; stats: string[]; kinds: string[]; events: "key" | "all"; scale: "global" | "view"; body: string[]; exhibits: Exhibit[] };

function readChapters(): Chapter[] {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "chapters.md"), "utf8");
  const chapters: Chapter[] = [];
  let cur: Chapter | null = null;
  // A "### " heading inside a chapter opens an exhibit; until one does, the
  // stats/kinds/events lines belong to the chapter itself (its first exhibit).
  let ex: Exhibit | null = null;
  for (const raw of src.split("\n")) {
    const h = /^## (.+?)\s*$/.exec(raw);
    if (h) {
      cur = { title: h[1]!, from: "", to: "", stats: [], kinds: [], events: "key", scale: "global", body: [], exhibits: [] };
      chapters.push(cur);
      ex = null;
      continue;
    }
    if (!cur) continue;
    const h3 = /^### (.+?)\s*$/.exec(raw);
    if (h3) {
      ex = { kind: "graph", title: h3[1]!, stats: [], kinds: [], events: "key", scale: "global" };
      cur.exhibits.push(ex);
      continue;
    }
    const span = /^span:\s*(\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2})\s*$/.exec(raw);
    if (span) {
      // A span on a graph exhibit widens or narrows the view for that card only.
      if (ex && ex.kind === "graph") { ex.from = span[1]!; ex.to = span[2]!; } else { cur.from = span[1]!; cur.to = span[2]!; }
      continue;
    }
    const comic = /^comic:\s*(\S+)\s*$/.exec(raw);
    if (comic && !ex) {
      if (!existsSync(join(dirname(fileURLToPath(import.meta.url)), comic[1]!))) throw new Error(`chapters.md: "${cur.title}" comic ${comic[1]} not found`);
      cur.comic = comic[1]!;
      continue;
    }
    // tagline: a line under the chapter's name on its title card.
    const tagline = /^tagline:\s*(.+?)\s*$/.exec(raw);
    if (tagline && !ex) { cur.tagline = tagline[1]!; continue; }
    const file = /^file:\s*(\S+)\s*$/.exec(raw);
    if (file && ex) {
      const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", file[1]!), "utf8");
      const i = cur.exhibits.indexOf(ex);
      ex = { kind: "code", title: ex.title, file: file[1]!, href: `${REPO_URL}/blob/main/${file[1]!}`, code, body: [] };
      cur.exhibits[i] = ex;
      continue;
    }
    const image = /^image:\s*(\S+)\s*$/.exec(raw);
    if (image && ex) {
      const rel = image[1]!;
      if (!existsSync(join(dirname(fileURLToPath(import.meta.url)), rel))) throw new Error(`chapters.md: "${cur.title}" image ${rel} not found`);
      if (ex.kind === "graph") { const i = cur.exhibits.indexOf(ex); ex = { kind: "text", title: ex.title, body: [] }; cur.exhibits[i] = ex; }
      (ex.images ??= []).push(rel);
      continue;
    }
    const range = /^lines:\s*(\d+)-(\d+)\s*$/.exec(raw);
    if (range && ex && ex.kind === "code") {
      const all = ex.code.split("\n");
      const a = Number(range[1]), b = Number(range[2]);
      if (a < 1 || b > all.length || a > b) throw new Error(`chapters.md: "${cur.title}" lines ${a}-${b} outside ${ex.file} (${all.length} lines)`);
      ex.code = all.slice(a - 1, b).join("\n");
      ex.file = `${ex.file}, lines ${a} to ${b}`;
      ex.href = `${ex.href}#L${a}-L${b}`;
      continue;
    }
    const target = ex && ex.kind === "graph" ? ex : cur;
    const list = /^(stats|kinds):\s*(.*)$/.exec(raw);
    if (list) { target[list[1] as "stats" | "kinds"] = list[2]!.split(",").map((x) => x.trim()).filter(Boolean); continue; }
    const ev = /^events:\s*(key|all)\s*$/.exec(raw);
    if (ev) { target.events = ev[1] as "key" | "all"; continue; }
    // scale: global (the year's peak, so pace reads across chapters) or view (the weeks on screen).
    const sc = /^scale:\s*(global|view)\s*$/.exec(raw);
    if (sc) { target.scale = sc[1] as "global" | "view"; continue; }
    if (/^- /.test(raw)) {
      // Bullets under an exhibit heading with no stats or file make it a text exhibit.
      if (ex && ex.kind === "graph" && !ex.stats.length && !ex.kinds.length) { const i = cur.exhibits.indexOf(ex); ex = { kind: "text", title: ex.title, body: [] }; cur.exhibits[i] = ex; }
      (ex && ex.kind !== "graph" ? ex.body : cur.body).push(raw.slice(2));
    }
  }
  for (const c of chapters) {
    if (!c.from || !c.to) throw new Error(`chapters.md: "${c.title}" has no span`);
    if (c.body.length === 0) throw new Error(`chapters.md: "${c.title}" has no bullets`);
    // The chapter's own graph settings are exhibit 1 when it has any.
    if (c.stats.length || c.kinds.length) c.exhibits.unshift({ kind: "graph", title: "On the graph", stats: c.stats, kinds: c.kinds, events: c.events, scale: c.scale });
    for (const e of c.exhibits) {
      if (e.kind === "graph") for (const k of e.kinds) if (!(k in KINDS)) throw new Error(`chapters.md: "${c.title}" unknown kind ${k}`);
      if (e.kind === "graph" && !e.stats.length && !e.kinds.length) throw new Error(`chapters.md: "${c.title}" exhibit "${e.title}" sets nothing: give it stats, kinds, or a file`);
    }
  }
  return chapters;
}

// ---------------------------------------------------------------- HELPERS

// Coordinates are rounded to a tenth: it keeps the files small and keeps
// long digit runs, which the commit blocklist can match, out of them.
const r = (n: number): string => (Math.round(n * 10) / 10).toString();

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Anchor = "start" | "middle" | "end";
const text = (
  x: number,
  y: number,
  s: string,
  o: { size?: number; fill?: string; anchor?: Anchor; weight?: number; halo?: boolean } = {},
): string =>
  `<text x="${r(x)}" y="${r(y)}" font-size="${o.size ?? 13}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? "start"}" font-weight="${o.weight ?? 400}"${o.halo ? ` paint-order="stroke" stroke="${PAPER}" stroke-width="6" stroke-linejoin="round"` : ""}>${esc(s)}</text>`;

const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ""): string =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}" ${extra}/>`;

const line = (x1: number, y1: number, x2: number, y2: number, stroke = RULE, w = 1): string =>
  `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${w}"/>`;

const circle = (cx: number, cy: number, rad: number, fill: string): string =>
  `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="${fill}"/>`;

const fmt = (n: number): string => n.toLocaleString("en-US");

const svg = (w: number, h: number, title: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
${rect(0, 0, w, h, PAPER)}
${body}
</svg>
`;

const day = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

// ---------------------------------------------------------------- FIGURE

function skillsFigure(): string {
  const W = 960;
  const LEFT = 190;
  const RIGHT = W - 24;
  const ROW = 17;
  const TOP = 64;
  const start = day("2026-05-20");
  const end = day("2026-10-12");
  const x = (iso: string): number => LEFT + ((day(iso) - start) / (end - start)) * (RIGHT - LEFT);

  const rows = [...SKILLS].sort((a, b) => day(a.born) - day(b.born) || a.name.localeCompare(b.name));
  const barsBottom = TOP + rows.length * ROW;
  const editsTop = barsBottom + 36;
  const editsH = 90;
  const H = editsTop + editsH + 40;

  const months: Array<[string, string]> = [
    ["2026-06-01", "Jun"],
    ["2026-07-01", "Jul"],
    ["2026-08-01", "Aug"],
    ["2026-09-01", "Sep"],
    ["2026-10-01", "Oct"],
  ];

  const parts: string[] = [];
  parts.push(text(24, 24, "Every skill, from the day it was written to the day it died", { size: 16, weight: 600 }));
  parts.push(text(24, 42, "A step in a workflow lasts. A skill that teaches craft gets retired into a doc.", { fill: MUTED }));

  // Month grid
  for (const [iso, label] of months) {
    const gx = x(iso);
    parts.push(line(gx, TOP - 6, gx, barsBottom + 4));
    parts.push(text(gx + 4, TOP - 10, label, { size: 11, fill: MUTED }));
    parts.push(line(gx, editsTop - 8, gx, editsTop + editsH));
  }

  // Bars
  rows.forEach((s, i) => {
    const y = TOP + i * ROW;
    const x1 = x(s.born);
    const x2 = x(s.died ?? TODAY);
    const alive = s.died === undefined;
    const fill = alive ? AQUA : ORANGE;
    const w = Math.max(x2 - x1, 4);
    parts.push(rect(x1, y + 3, w, ROW - 7, fill, 'rx="2"'));
    if (!alive) parts.push(text(x2 + 5, y + ROW - 5, "×", { size: 12, fill: ORANGE, weight: 700 }));
    parts.push(text(LEFT - 8, y + ROW - 5, s.name, { size: 11, anchor: "end", fill: alive ? INK : MUTED }));
  });

  // Legend
  const alive = SKILLS.filter((s) => s.died === undefined).length;
  const ly = 24;
  parts.push(rect(RIGHT - 230, ly - 9, 12, 10, AQUA, 'rx="2"'));
  parts.push(text(RIGHT - 214, ly, `still used (${alive})`, { size: 11, fill: MUTED }));
  parts.push(rect(RIGHT - 110, ly - 9, 12, 10, ORANGE, 'rx="2"'));
  parts.push(text(RIGHT - 94, ly, `retired (${SKILLS.length - alive})`, { size: 11, fill: MUTED }));

  // Edits per month, as bars sharing the time axis
  parts.push(text(24, editsTop - 12, "Commits touching skills, per month", { size: 12, weight: 600 }));
  const max = Math.max(...EDITS.map(([, n]) => n));
  for (const [ym, n] of EDITS) {
    const a = `${ym}-01`;
    const [yy, mm] = ym.split("-").map(Number);
    const next = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
    const bx1 = Math.max(x(a), LEFT);
    const bx2 = Math.min(x(next), RIGHT);
    const h = (n / max) * (editsH - 18);
    parts.push(rect(bx1 + 6, editsTop + editsH - h, bx2 - bx1 - 12, h, BLUE, 'rx="3"'));
    parts.push(text((bx1 + bx2) / 2, editsTop + editsH - h - 5, String(n), { size: 11, anchor: "middle", fill: MUTED }));
  }
  parts.push(line(LEFT, editsTop + editsH, RIGHT, editsTop + editsH, RULE, 1));

  return svg(W, H, "Skill lifespans, May to October 2026, with skill edits per month", parts.join("\n"));
}

function commitsFigure(): string {
  const W = 960;
  const H = 330;
  const LEFT = 56;
  const RIGHT = W - 24;
  const TOP = 92;
  const BOTTOM = H - 40;
  const max = 2600;
  const slot = (RIGHT - LEFT) / COMMITS.length;
  const y = (n: number): number => BOTTOM - (n / max) * (BOTTOM - TOP);
  const parts: string[] = [];
  parts.push(text(24, 24, "Commits per month, and what I was changing in the process", { size: 16, weight: 600 }));
  parts.push(text(24, 42, "Each phase bought enough confidence to leave the agent alone longer.", { fill: MUTED }));
  for (const g of [500, 1000, 1500, 2000]) {
    parts.push(line(LEFT, y(g), RIGHT, y(g)));
    parts.push(text(LEFT - 6, y(g) + 4, fmt(g), { size: 10, fill: MUTED, anchor: "end" }));
  }
  // Phase bands
  let i = 0;
  while (i < COMMITS.length) {
    const phase = COMMITS[i]![2];
    let j = i;
    while (j < COMMITS.length && COMMITS[j]![2] === phase) j++;
    const x1 = LEFT + i * slot;
    const x2 = LEFT + j * slot;
    const label = PHASES.find(([k]) => k === phase)?.[1] ?? phase;
    if (i % 2 === 0) parts.push(rect(x1, TOP - 26, x2 - x1, BOTTOM - TOP + 26, "#f3f6fa"));
    parts.push(text((x1 + x2) / 2, TOP - 12, label, { size: 10, fill: MUTED, anchor: "middle" }));
    i = j;
  }
  COMMITS.forEach(([m, n], k) => {
    const x1 = LEFT + k * slot + 10;
    parts.push(rect(x1, y(n), slot - 20, BOTTOM - y(n), BLUE, 'rx="3"'));
    parts.push(text(x1 + (slot - 20) / 2, y(n) - 5, fmt(n), { size: 11, fill: MUTED, anchor: "middle" }));
    parts.push(text(x1 + (slot - 20) / 2, BOTTOM + 16, m, { size: 12, anchor: "middle" }));
  });
  parts.push(line(LEFT, BOTTOM, RIGHT, BOTTOM, RULE, 1));
  return svg(W, H, "Commits per month, January to October 2026, with process phases", parts.join("\n"));
}

function landingsFigure(): string {
  const W = 960;
  const H = 220;
  const LEFT = 56;
  const RIGHT = W - 24;
  const TOP = 60;
  const BOTTOM = H - 40;
  const max = 320;
  const slot = (RIGHT - LEFT) / LANDINGS.length;
  const y = (n: number): number => BOTTOM - (n / max) * (BOTTOM - TOP);
  const parts: string[] = [];
  parts.push(text(24, 24, "Separate checkouts landing on main, per month", { size: 16, weight: 600 }));
  parts.push(text(24, 42, "One session, one checkout. Ten a day by September.", { fill: MUTED }));
  for (const g of [100, 200, 300]) {
    parts.push(line(LEFT, y(g), RIGHT, y(g)));
    parts.push(text(LEFT - 6, y(g) + 4, String(g), { size: 10, fill: MUTED, anchor: "end" }));
  }
  LANDINGS.forEach(([m, n], k) => {
    const x1 = LEFT + k * slot + 24;
    parts.push(rect(x1, y(n), slot - 48, BOTTOM - y(n), AQUA, 'rx="3"'));
    parts.push(text(x1 + (slot - 48) / 2, y(n) - 5, String(n), { size: 11, fill: MUTED, anchor: "middle" }));
    parts.push(text(x1 + (slot - 48) / 2, BOTTOM + 16, m, { size: 12, anchor: "middle" }));
  });
  parts.push(line(LEFT, BOTTOM, RIGHT, BOTTOM, RULE, 1));
  return svg(W, H, "Worktree branches landing on main per month, May to October 2026", parts.join("\n"));
}

function instructionsFigure(): string {
  const W = 960;
  const H = 320;
  const LEFT = 56;
  const RIGHT = W - 150;
  const TOP = 60;
  const BOTTOM = H - 40;
  const start = day("2026-01-25");
  const end = day("2026-10-12");
  const max = 2700;
  const x = (iso: string): number => LEFT + ((day(iso) - start) / (end - start)) * (RIGHT - LEFT);
  const y = (n: number): number => BOTTOM - (n / max) * (BOTTOM - TOP);
  const parts: string[] = [];
  parts.push(text(24, 24, "The instructions every session reads: words over time", { size: 16, weight: 600 }));
  parts.push(text(24, 42, "I cut by hand in March and September. Between cuts it grows, one rule per correction.", { fill: MUTED }));
  for (const g of [500, 1000, 1500, 2000, 2500]) {
    parts.push(line(LEFT, y(g), RIGHT, y(g)));
    parts.push(text(LEFT - 6, y(g) + 4, fmt(g), { size: 10, fill: MUTED, anchor: "end" }));
  }
  const months: Array<[string, string]> = [
    ["2026-02-01", "Feb"], ["2026-03-01", "Mar"], ["2026-04-01", "Apr"], ["2026-05-01", "May"],
    ["2026-06-01", "Jun"], ["2026-07-01", "Jul"], ["2026-08-01", "Aug"], ["2026-09-01", "Sep"], ["2026-10-01", "Oct"],
  ];
  for (const [iso, label] of months) parts.push(text(x(iso), BOTTOM + 16, label, { size: 11, fill: MUTED, anchor: "middle" }));
  const path = (pick: (r: (typeof INSTRUCTIONS)[number]) => number | null): string =>
    INSTRUCTIONS.filter((row) => pick(row) !== null)
      .map((row, i) => `${i === 0 ? "M" : "L"}${x(row[0]).toFixed(1)},${y(pick(row)!).toFixed(1)}`)
      .join(" ");
  parts.push(`<path d="${path((r) => r[1])}" fill="none" stroke="${BLUE}" stroke-width="2.5"/>`);
  parts.push(`<path d="${path((r) => r[2])}" fill="none" stroke="${ORANGE}" stroke-width="2.5"/>`);
  for (const r of INSTRUCTIONS) {
    parts.push(circle(x(r[0]), y(r[1]), 3.5, BLUE));
    if (r[2] !== null) parts.push(circle(x(r[0]), y(r[2]), 3.5, ORANGE));
  }
  // Cut markers
  for (const [iso, label] of [["2026-03-03", "first cut"], ["2026-09-12", "calibration rewrite"]] as const) {
    parts.push(line(x(iso), TOP, x(iso), BOTTOM, INK, 1));
    parts.push(text(x(iso) + 4, TOP + 10, label, { size: 10, fill: INK }));
  }
  const last = INSTRUCTIONS[INSTRUCTIONS.length - 1]!;
  parts.push(text(RIGHT + 8, y(last[1]) + 4, `main system (${fmt(last[1])})`, { size: 11, fill: BLUE }));
  parts.push(text(RIGHT + 8, y(last[2]!) - 8, `monorepo root (${fmt(last[2]!)})`, { size: 11, fill: ORANGE }));
  return svg(W, H, "Word count of always-loaded instruction files, February to October 2026", parts.join("\n"));
}

function issuesFigure(): string {
  const W = 960;
  const H = 260;
  const LEFT = 56;
  const RIGHT = W - 24;
  const TOP = 60;
  const BOTTOM = H - 40;
  const max = 450;
  const slot = (RIGHT - LEFT) / ISSUES.length;
  const y = (n: number): number => BOTTOM - (n / max) * (BOTTOM - TOP);
  const parts: string[] = [];
  parts.push(text(24, 24, "Issues filed and closed, per month, since the tree started in July", { size: 16, weight: 600 }));
  parts.push(text(24, 42, `Agents file nearly all of them. ${OPEN_NOW} are open today.`, { fill: MUTED }));
  for (const g of [100, 200, 300, 400]) {
    parts.push(line(LEFT, y(g), RIGHT, y(g)));
    parts.push(text(LEFT - 6, y(g) + 4, String(g), { size: 10, fill: MUTED, anchor: "end" }));
  }
  const bw = (slot - 40) / 2;
  ISSUES.forEach(([m, filed, closed], k) => {
    const x1 = LEFT + k * slot + 20;
    parts.push(rect(x1, y(filed), bw - 2, BOTTOM - y(filed), BLUE, 'rx="3"'));
    parts.push(text(x1 + bw / 2, y(filed) - 5, String(filed), { size: 11, fill: MUTED, anchor: "middle" }));
    parts.push(rect(x1 + bw, y(closed), bw - 2, BOTTOM - y(closed), AQUA, 'rx="3"'));
    parts.push(text(x1 + bw * 1.5, y(closed) - 5, String(closed), { size: 11, fill: MUTED, anchor: "middle" }));
    parts.push(text(x1 + bw, BOTTOM + 16, m, { size: 12, anchor: "middle" }));
  });
  parts.push(rect(RIGHT - 160, 36, 12, 10, BLUE, 'rx="2"'));
  parts.push(text(RIGHT - 144, 45, "filed", { size: 11, fill: MUTED }));
  parts.push(rect(RIGHT - 90, 36, 12, 10, AQUA, 'rx="2"'));
  parts.push(text(RIGHT - 74, 45, "closed", { size: 11, fill: MUTED }));
  parts.push(line(LEFT, BOTTOM, RIGHT, BOTTOM, RULE, 1));
  return svg(W, H, "Issues filed and closed per month, July to October 2026", parts.join("\n"));
}

const EVENTS = readEvents();

function lanesFigure(opts: { width: number; font: number; title: boolean; bands?: boolean; minRows?: number }): string {
  const W = opts.width;
  const F = opts.font;
  const LEFT = 40;
  const RIGHT = W - Math.round(F * 9);
  const start = day("2026-01-25");
  const end = day("2026-10-15");
  const x = (iso: string): number => LEFT + ((day(iso) - start) / (end - start)) * (RIGHT - LEFT);
  const LINE = Math.round(F * 2.2);
  const CHAR = F * 0.6;
  const minRows = opts.minRows ?? 1;
  // Lay events into rows: an event takes the lowest row whose last label
  // ends before this one starts.
  const place = (events: Event[]): Array<Event & { row: number }> => {
    const sorted = [...events].sort((a, b) => day(a.date) - day(b.date));
    const rowEnd: number[] = [];
    return sorted.map((e) => {
      const x1 = x(e.date);
      let row = 0;
      while (row < rowEnd.length && (rowEnd[row] ?? -1) > x1 - F) row++;
      rowEnd[row] = x1 + e.label.length * CHAR + F;
      return { ...e, row };
    });
  };
  const lanes = LANE_ORDER.map((name) => {
    const placed = place(EVENTS.filter((e) => KINDS[e.kind]!.lane === name));
    const rows = Math.max(minRows, ...placed.map((e) => e.row + 1));
    return { name, placed, rows };
  });
  const TOP = opts.title ? 56 : F * 2;
  const bandH = opts.bands ? F * 2.4 : 0;
  const GAP = F * 1.2;
  // One central axis: the code lane's stems rise above it, the product
  // lane's hang below it.
  const up = lanes[0]!;
  const down = lanes[1]!;
  const axisY = TOP + bandH + GAP + F * 1.6 + up.rows * LINE;
  const bottom = axisY + F * 1.6 + down.rows * LINE + GAP;
  const H = bottom + F * 4.4;
  const parts: string[] = [];
  if (opts.title) {
    parts.push(text(24, 24, "Two lanes: the code and the product", { size: 16, weight: 600 }));
    parts.push(text(24, 42, "Process and sweeps above the line; features and infrastructure below.", { fill: MUTED }));
  }
  const months: Array<[string, string]> = [
    ["2026-02-01", "Feb"], ["2026-03-01", "Mar"], ["2026-04-01", "Apr"], ["2026-05-01", "May"], ["2026-06-01", "Jun"],
    ["2026-07-01", "Jul"], ["2026-08-01", "Aug"], ["2026-09-01", "Sep"], ["2026-10-01", "Oct"],
  ];
  // Phase bands, from the commits chart: label and span.
  if (opts.bands) {
    const spans: Array<[string, string, string]> = [
      ["2026-01-25", "2026-04-01", "checks before trust"],
      ["2026-04-01", "2026-05-01", "quiet"],
      ["2026-05-01", "2026-06-01", "checkouts"],
      ["2026-06-01", "2026-07-01", "second model"],
      ["2026-07-01", "2026-08-01", "the queue"],
      ["2026-08-01", "2026-09-01", "runs unattended"],
      ["2026-09-01", "2026-10-01", "instructions"],
      ["2026-10-01", "2026-10-15", "measured"],
    ];
    spans.forEach(([a, b, label], i) => {
      const x1 = x(a);
      const x2 = x(b);
      parts.push(rect(x1, TOP, x2 - x1, bottom - TOP, i % 2 === 0 ? "#f3f6fa" : PAPER));
      parts.push(text((x1 + x2) / 2, TOP + F * 1.5, label, { size: F, fill: MUTED, anchor: "middle", weight: 600 }));
    });
  }
  for (const [iso, label] of months) {
    parts.push(`<line x1="${r(x(iso))}" y1="${r(TOP + bandH)}" x2="${r(x(iso))}" y2="${r(bottom)}" stroke="${RULE}" stroke-width="1" stroke-dasharray="2 4"/>`);
    parts.push(text(x(iso) + 4, bottom + F * 1.2, label, { size: F + 1, fill: MUTED }));
  }
  const dot = F * 0.3;
  // Stems first, then dots and labels, so a label's halo hides any stem
  // that crosses it.
  const labels: string[] = [];
  parts.push(line(LEFT, axisY, RIGHT, axisY, INK, 2));
  labels.push(text(LEFT, TOP + bandH + GAP + F, up.name, { size: F, fill: INK, weight: 700, halo: true }));
  labels.push(text(LEFT, bottom - GAP / 2, down.name, { size: F, fill: INK, weight: 700, halo: true }));
  for (const e of up.placed) {
    const color = KINDS[e.kind]!.color;
    const ex = x(e.date);
    const ey = axisY - F - e.row * LINE;
    parts.push(line(ex, ey, ex, axisY, color, 1.5));
    labels.push(circle(ex, ey, dot, color));
    labels.push(text(ex + dot + 4, ey + F * 0.35, e.label, { size: F, fill: INK, halo: true }));
  }
  for (const e of down.placed) {
    const color = KINDS[e.kind]!.color;
    const ex = x(e.date);
    const ey = axisY + F + e.row * LINE;
    parts.push(line(ex, axisY, ex, ey, color, 1.5));
    labels.push(circle(ex, ey, dot, color));
    labels.push(text(ex + dot + 4, ey + F * 0.35, e.label, { size: F, fill: INK, halo: true }));
  }
  parts.push(...labels);
  // Legend on its own line under the months, one entry per kind.
  let lx = LEFT;
  for (const k of Object.keys(KINDS)) {
    const kind = KINDS[k]!;
    parts.push(circle(lx + dot, H - F * 1.3, dot, kind.color));
    parts.push(text(lx + dot * 2 + 5, H - F, k, { size: F, fill: MUTED }));
    lx += k.length * CHAR + F * 2.5;
  }
  return svg(W, H, "Code lane (process, sweeps) and product lane (features, infrastructure) on one time axis, 2026", parts.join("\n"));
}

mkdirSync(OUT, { recursive: true });
mkdirSync(join(dirname(fileURLToPath(import.meta.url)), "data"), { recursive: true });
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "data", "chapters.json"), `${JSON.stringify(readChapters(), null, 1)}\n`);
writeFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "data", "lanes.json"),
  `${JSON.stringify({ kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { lane: v.lane, color: v.color }])), events: EVENTS }, null, 1)}\n`,
);
writeFileSync(join(OUT, "lanes.svg"), lanesFigure({ width: 960, font: 10, title: true }));
writeFileSync(join(OUT, "skills.svg"), skillsFigure());
writeFileSync(join(OUT, "commits.svg"), commitsFigure());
writeFileSync(join(OUT, "landings.svg"), landingsFigure());
writeFileSync(join(OUT, "instructions.svg"), instructionsFigure());
writeFileSync(join(OUT, "issues.svg"), issuesFigure());
