// Weekly size history of the repository, read straight from git objects (no
// checkout). For every Monday from the first commit to today it takes the
// last commit on `main` before that date and counts non-blank lines in code,
// tests, docs and other tracked text, plus commits that week, open issues,
// test files and skills. Writes data/size-history.json and
// figures/size-history.svg.
//
//   node --import tsx dev/devprocess-talk/size-history.ts
//
// Classification mirrors bin/project-size.ts (code / tests / docs), collapsed
// to four buckets. Blob line counts are cached by object id, so a week costs
// only the blobs that changed.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const BRANCH = "main";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".swift", ".css", ".sh", ".html", ".py"]);
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json"]);

type Bucket = "code" | "tests" | "docs" | "other";

function isTestPath(file: string): boolean {
  const base = basename(file);
  return file.endsWith(".doctest.md") || base.includes(".test.") || `/${file}`.includes("/test/") || `/${file}`.includes("/tests/");
}

function bucket(file: string): Bucket | null {
  const base = basename(file);
  if (LOCKFILES.has(base)) return null;
  if (isTestPath(file)) return "tests";
  if (extname(file) === ".md") return "docs";
  if (CODE_EXTENSIONS.has(extname(file))) return "code";
  return "other";
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
}

// ---------------------------------------------------------------- checkpoints

type Week = {
  date: string;
  commit: string;
  commits: number;
  lines: Record<Bucket, number>;
  files: Record<Bucket, number>;
  testFiles: number;
  skills: number;
  /** Non-blank lines across every CLAUDE.md and AGENTS.md in the tree. */
  instructionLines: number;
  /** Non-blank Markdown lines under .claude/skills/. */
  skillLines: number;
  /** Every tracked file, and every directory that holds one. */
  totalFiles: number;
  totalDirs: number;
  openIssues: number;
  closedIssues: number;
  /** Test lines split: inside doctest code fences, doctest prose, and tests that are not doctests. */
  doctestCode: number;
  doctestProse: number;
  otherTestLines: number;
  /** Logging call sites in code files: console calls and log(...) calls. */
  logCalls: number;
  /** Knowledge-audit prompts defined, from the audit definitions file. */
  auditPrompts: number;
  /** User-journey walk reports on disk, and issues whose frontmatter traces them to a walk. */
  journeyWalks: number;
  journeyIssues: number;
  /** Schedules defined, and commits that week from sessions a schedule started. */
  schedules: number;
  scheduledCommits: number;
  /**
   * Estimated wall-clock minutes for one full test-suite run that week, the
   * median over the week's complete runs. From the test ledger, which began
   * 2026-08-30; null before that and in weeks with no complete run.
   */
  suiteMinutes: number | null;
  /** Plan-document edits that week: a commit touching a plan file counts once per plan file it touches. */
  planEdits: number;
  /** Files directly in the largest directory, in the three largest, and the mean over directories that hold files. */
  dirMax: number;
  dirTop3: number;
  dirMean: number;
  /**
   * Share of the week's commits that were codebase work rather than product
   * work, by the files each commit touched: 100 for all, 0 for none. The
   * codebase side is everything that serves the making of the product: scripts,
   * instructions, skills, checks, the dev dashboard, plans. Issue files are
   * ignored, since an issue is about whichever side its subject is on; a
   * commit that touches only issues is left out of the count.
   */
  codebaseShare: number;
};

const CODEBASE_PREFIXES = ["bin/", ".claude/", ".codex/", ".husky/", "workstreams-app/", "personal-vibe-check/", "agent-doctest/", "dev/", "browse/", "research/", "scripts/", "patches/", ".github/", "beebox/docs/testing/", "beebox/docs/plans/", "beebox/docs/implemented-plans/", "beebox/src/dev/", "beebox/field-tests/", "beebox/src/field-test/", "beebox/deploy/"];
const CODEBASE_FILES = ["AGENTS.md", "CLAUDE.md", "eslint.config", "tsconfig", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".prettierrc", ".gitignore", ".commit-blocklist"];
function isCodebase(path: string): boolean {
  const base = basename(path);
  return CODEBASE_PREFIXES.some((p) => path.startsWith(p)) || CODEBASE_FILES.some((f) => base.startsWith(f));
}

/** Codebase share of the commits between two dates, in percent. */
function codebaseShare(date: string, prevDate: string | null): number {
  const out = git(["log", BRANCH, "--no-merges", "--format=%x00", "--name-only", `--before=${date}T00:00:00Z`, ...(prevDate ? [`--after=${prevDate}T00:00:00Z`] : [])]);
  let n = 0, codebase = 0;
  for (const block of out.split("\0").slice(1)) {
    const files = block.split("\n").map((l) => l.trim()).filter((f) => f !== "" && !f.startsWith("issues/"));
    if (files.length === 0) continue;
    n++;
    const h = files.filter(isCodebase).length;
    codebase += h * 2 > files.length ? 1 : h * 2 === files.length ? 0.5 : 0;
  }
  return n ? Math.round((100 * codebase) / n) : 0;
}

function mondays(firstDay: string, lastDay: string): string[] {
  const out: string[] = [];
  const d = new Date(`${firstDay}T00:00:00Z`);
  // Advance to the first Monday on or after the first commit.
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const end = new Date(`${lastDay}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

const lineCache = new Map<string, number | null>();
/** Logging call sites per blob: console.* calls and bare log(...) calls. */
const logCache = new Map<string, number>();
/** Knowledge-audit entries per blob: `- id:` lines in the audit definitions file. */
const auditCache = new Map<string, number>();
const AUDIT_FILE = /(^|\/)knowledge-(audits|tests)\.ya?ml$/;
/** Per blob: whether an issue's frontmatter says it was found on a journey walk. */
const journeyCache = new Map<string, boolean>();
const WALK_REPORT = /journeys\/[^/]+\/reports\/\d{4}-\d{2}-\d{2}[^/]*\.md$/;

// ---------------------------------------------------------------- test ledger
// bin/test-ledger.ts appends one record per test run to a file inside the
// shared .git directory. The hourly full run has two tiers: "ordinary", at
// least 600 files run six at a time, and "careful", a handful of
// timing-sensitive files run one at a time. The ledger holds per-file times
// but no wall clock, so a run's wall time is estimated: the ordinary tier's
// summed file minutes over the six slots, plus the careful tier's sum. The
// careful estimate was checked against the gap between the two tiers'
// records and matched within a tenth of a minute.
const TAP_JOBS = 6;
type LedgerRun = { ts: string; tier: "ordinary" | "careful"; minutes: number };
function loadLedger(): LedgerRun[] {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const file = join(common, "beebox-test-ledger.jsonl");
  if (!existsSync(file)) return [];
  const runs: LedgerRun[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as { ts: string; mode: string; tier?: string; durations: Record<string, number> };
    if (r.mode !== "full") continue;
    const ms = Object.values(r.durations);
    const sum = ms.reduce((a, b) => a + b, 0) / 60000;
    if (r.tier === "careful") { if (ms.length > 0) runs.push({ ts: r.ts, tier: "careful", minutes: sum }); continue; }
    if (ms.length < 600) continue;
    runs.push({ ts: r.ts, tier: "ordinary", minutes: Math.max(sum / TAP_JOBS, Math.max(...ms) / 60000) });
  }
  return runs;
}
const ledger = loadLedger();
const median = (xs: number[]): number | null => { const v = xs.toSorted((a, b) => a - b); return v.length === 0 ? null : v[Math.floor(v.length / 2)]!; };
/** Schedule names: one folder per schedule, each holding a schedule.yaml. */
const SCHEDULE_NAMES = new Set(
  git(["ls-tree", "-r", "--name-only", BRANCH, "schedules/"]).split("\n").map((l) => /^schedules\/([^/]+)\/schedule\.yaml$/.exec(l)?.[1]).filter((n): n is string => n !== undefined),
);
/** Commits in a window whose Workstream trailer names a schedule: work a scheduled session did. */
function scheduledCommitsBetween(from: string | null, to: string): number {
  const out = git(["log", "--format=%(trailers:key=Workstream,valueonly)", `--before=${to}T00:00:00Z`, ...(from ? [`--after=${from}T00:00:00Z`] : []), BRANCH]);
  return out.split("\n").filter((l) => SCHEDULE_NAMES.has(l.trim())).length;
}
/** Plan files touched by the commits in a window, counted per commit. */
function planEditsBetween(from: string | null, to: string): number {
  const out = git(["log", "--format=%x00", "--name-only", `--before=${to}T00:00:00Z`, ...(from ? [`--after=${from}T00:00:00Z`] : []), BRANCH]);
  return out.split("\n").filter((l) => /(^|\/)(plans|implemented-plans)\/[^/]+\.md$/.test(l)).length;
}
function suiteMinutesBetween(from: string | null, to: string): number | null {
  const inWindow = ledger.filter((r) => r.ts < `${to}T00:00:00Z` && (from === null || r.ts >= `${from}T00:00:00Z`));
  const ordinary = median(inWindow.filter((r) => r.tier === "ordinary").map((r) => r.minutes));
  if (ordinary === null) return null;
  const careful = median(inWindow.filter((r) => r.tier === "careful").map((r) => r.minutes)) ?? 0;
  return Math.round(ordinary + careful);
}
const LOG_CALL = /\bconsole\.(?:log|warn|error|info|debug)\(|(?<![\w.])log\(/g;
/** Of those lines, how many sit inside ``` fences (code in a Markdown document). */
const fencedCache = new Map<string, number>();

/**
 * The monorepo was assembled on 2026-05-26 by merging five repositories'
 * histories as side parents of the first few commits on main. Before that
 * date the repository's own line is the largest of those imported
 * histories, so measurements walk its first-parent chain instead.
 */
function importedLineage(): string {
  const heads = git(["log", "--first-parent", "--format=%P", BRANCH]).trim().split("\n").slice(-8);
  let best = { hash: "", count: 0 };
  for (const parents of heads) {
    for (const p of parents.split(" ").slice(1)) {
      const count = Number(git(["rev-list", "--count", p]).trim());
      if (count > best.count) best = { hash: p, count };
    }
  }
  if (best.hash === "") throw new Error("no imported history found under main");
  return best.hash;
}
const LINEAGE = importedLineage();

/** Non-blank line counts for blobs not yet cached, via one cat-file batch. */
function countBlobs(ids: string[]): void {
  const missing = ids.filter((id) => !lineCache.has(id));
  if (missing.length === 0) return;
  const res = spawnSync("git", ["cat-file", "--batch"], { cwd: REPO, input: `${missing.join("\n")}\n`, maxBuffer: 1024 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git cat-file failed: ${res.stderr.toString("utf8")}`);
  const buf: Buffer = res.stdout;
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const header = buf.subarray(pos, nl).toString("utf8");
    pos = nl + 1;
    const [id, type, sizeStr] = header.split(" ");
    if (id === undefined) break;
    if (type === "missing" || sizeStr === undefined) {
      lineCache.set(id, null);
      continue;
    }
    const size = Number(sizeStr);
    const body = buf.subarray(pos, pos + size);
    pos += size + 1; // trailing newline after the object
    if (body.subarray(0, 2048).includes(0)) {
      lineCache.set(id, null);
      continue;
    }
    let lines = 0;
    let fenced = 0;
    let inFence = false;
    let lineStart = 0;
    for (let i = 0; i <= body.length; i++) {
      if (i === body.length || body[i] === 0x0a) {
        let blank = true;
        for (let j = lineStart; j < i; j++) {
          const c = body[j]!;
          if (c !== 0x20 && c !== 0x09 && c !== 0x0d) {
            blank = false;
            break;
          }
        }
        // A line opening with ``` (after indent) toggles a fence; the fence
        // lines themselves count as prose, their contents as code.
        let k = lineStart;
        while (k < i && (body[k] === 0x20 || body[k] === 0x09)) k++;
        const isFence = i - k >= 3 && body[k] === 0x60 && body[k + 1] === 0x60 && body[k + 2] === 0x60;
        if (!blank) {
          lines++;
          if (inFence && !isFence) fenced++;
        }
        if (isFence) inFence = !inFence;
        lineStart = i + 1;
      }
    }
    lineCache.set(id, lines);
    fencedCache.set(id, fenced);
    const text = body.toString("utf8");
    logCache.set(id, (text.match(LOG_CALL) ?? []).length);
    auditCache.set(id, (text.match(/^\s*- id:/gm) ?? []).length);
    journeyCache.set(id, /^discovered-(in|by):.*(journey|walk)/im.test(text.slice(0, 4000)));
  }
}

function measure(date: string, prevDate: string | null): Week | null {
  const onMain = git(["rev-list", "-1", "--first-parent", `--before=${date}T00:00:00Z`, BRANCH]).trim();
  const commit = onMain !== "" ? onMain : git(["rev-list", "-1", "--first-parent", `--before=${date}T00:00:00Z`, LINEAGE]).trim();
  if (commit === "") return null;
  const commits = Number(
    git(["rev-list", "--count", `--before=${date}T00:00:00Z`, ...(prevDate ? [`--after=${prevDate}T00:00:00Z`] : []), BRANCH]).trim(),
  );
  const tree = git(["ls-tree", "-r", "-z", commit]);
  const entries = tree
    .split("\0")
    .filter((s) => s !== "")
    .map((s) => {
      const tab = s.indexOf("\t");
      const [mode, type, id] = s.slice(0, tab).split(" ");
      return { mode: mode!, type: type!, id: id!, path: s.slice(tab + 1) };
    })
    .filter((e) => e.type === "blob" && e.mode !== "120000");
  const totalFiles = entries.length;
  const dirs = new Set<string>();
  for (const e of entries) {
    const parts = e.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const totalDirs = dirs.size;
  const perDir = new Map<string, number>();
  for (const e of entries) {
    const d = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : ".";
    perDir.set(d, (perDir.get(d) ?? 0) + 1);
  }
  const sizes = [...perDir.values()].sort((a, b) => b - a);
  const dirMax = sizes[0] ?? 0;
  const dirTop3 = sizes.slice(0, 3).reduce((a, b) => a + b, 0);
  const dirMean = sizes.length ? Math.round((entries.length / sizes.length) * 10) / 10 : 0;
  const share = codebaseShare(date, prevDate);
  const wanted = entries.filter((e) => bucket(e.path) !== null);
  countBlobs(wanted.map((e) => e.id));
  const lines: Record<Bucket, number> = { code: 0, tests: 0, docs: 0, other: 0 };
  const files: Record<Bucket, number> = { code: 0, tests: 0, docs: 0, other: 0 };
  let testFiles = 0;
  let skills = 0;
  let instructionLines = 0;
  let skillLines = 0;
  let openIssues = 0;
  let closedIssues = 0;
  let doctestCode = 0;
  let doctestProse = 0;
  let otherTestLines = 0;
  let logCalls = 0;
  let auditPrompts = 0;
  let journeyWalks = 0;
  let journeyIssues = 0;
  let schedules = 0;
  for (const e of wanted) {
    if (/^schedules\/[^/]+\/schedule\.yaml$/.test(e.path)) schedules++;
    if (AUDIT_FILE.test(e.path)) auditPrompts += auditCache.get(e.id) ?? 0;
    if (WALK_REPORT.test(e.path)) journeyWalks++;
    if (e.path.startsWith("issues/") && journeyCache.get(e.id)) journeyIssues++;
    const b = bucket(e.path)!;
    const n = lineCache.get(e.id);
    if (n === null || n === undefined) continue; // binary
    lines[b] += n;
    files[b] += 1;
    if (b === "code") logCalls += logCache.get(e.id) ?? 0;
    if (b === "tests" && (e.path.endsWith(".doctest.md") || basename(e.path).includes(".test."))) testFiles++;
    if (b === "tests") {
      if (e.path.endsWith(".doctest.md")) { const f = fencedCache.get(e.id) ?? 0; doctestCode += f; doctestProse += n - f; }
      else otherTestLines += n;
    }
    if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(e.path)) skills++;
    // Markdown only: a skill may ship scripts, and a vendored kit once
    // brought 4,400 lines of Python and HTML that were never instructions.
    if (e.path.startsWith(".claude/skills/") && e.path.endsWith(".md")) skillLines += n;
    if (/(^|\/)(CLAUDE|AGENTS)\.md$/.test(e.path)) instructionLines += n;
    if (/^issues\/.*\.md$/.test(e.path) && !/\/(README|AGENTS|CLAUDE)\.md$/.test(e.path) && /\/\d{4}-\d{2}-\d{2}-/.test(e.path)) {
      if (e.path.startsWith("issues/closed/")) closedIssues++;
      else openIssues++;
    }
  }
  return { date, commit: commit.slice(0, 9), commits, lines, files, testFiles, skills, instructionLines, skillLines, totalFiles, totalDirs, openIssues, closedIssues, doctestCode, doctestProse, otherTestLines, logCalls, auditPrompts, journeyWalks, journeyIssues, schedules, scheduledCommits: scheduledCommitsBetween(prevDate, date), suiteMinutes: suiteMinutesBetween(prevDate, date), planEdits: planEditsBetween(prevDate, date), dirMax, dirTop3, dirMean, codebaseShare: share };
}

// ---------------------------------------------------------------- figure

const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const AQUA = "#1baf7a";
const PURPLE = "#1f2933";
const INK = "#1f2933";
const MUTED = "#6b7280";
const RULE = "#d9dde3";
const PAPER = "#ffffff";

const r = (n: number): string => (Math.round(n * 10) / 10).toString();
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number): string => n.toLocaleString("en-US");
const text = (x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; weight?: number } = {}): string =>
  `<text x="${r(x)}" y="${r(y)}" font-size="${o.size ?? 13}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? "start"}" font-weight="${o.weight ?? 400}">${esc(s)}</text>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ""): string =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}" ${extra}/>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke = RULE, w = 1): string =>
  `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${w}"/>`;
const day = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

function render(weeks: Week[]): string {
  const W = 960;
  const LEFT = 64;
  const RIGHT = W - 24;
  const start = day(weeks[0]!.date);
  const end = day(weeks[weeks.length - 1]!.date);
  const x = (iso: string): number => LEFT + ((day(iso) - start) / (end - start)) * (RIGHT - LEFT);

  type Panel = { title: string; top: number; height: number; max: number };
  const panels: Panel[] = [];
  let cursor = 84;
  const addPanel = (title: string, height: number, max: number): Panel => {
    const p = { title, top: cursor, height, max };
    panels.push(p);
    cursor += height + 44;
    return p;
  };
  const maxLines = Math.max(...weeks.map((w) => Math.max(w.lines.code, w.lines.tests, w.lines.docs)));
  const linesPanel = addPanel("Non-blank lines, thousands", 260, Math.ceil(maxLines / 50_000) * 50_000);
  const commitsPanel = addPanel("Commits per week", 120, Math.ceil(Math.max(...weeks.map((w) => w.commits)) / 100) * 100);
  const issuesPanel = addPanel("Issues: open and closed", 120, Math.ceil(Math.max(...weeks.map((w) => Math.max(w.openIssues, w.closedIssues))) / 100) * 100);
  const H = cursor + 10;

  const parts: string[] = [];
  parts.push(text(24, 24, "The repository, week by week", { size: 16, weight: 600 }));
  parts.push(text(24, 42, `Mondays from ${weeks[0]!.date} to ${weeks[weeks.length - 1]!.date}, measured on main.`, { fill: MUTED }));

  const months: Array<[string, string]> = [
    ["2026-02-01", "Feb"], ["2026-03-01", "Mar"], ["2026-04-01", "Apr"], ["2026-05-01", "May"], ["2026-06-01", "Jun"],
    ["2026-07-01", "Jul"], ["2026-08-01", "Aug"], ["2026-09-01", "Sep"], ["2026-10-01", "Oct"],
  ];
  for (const p of panels) {
    const y = (v: number): number => p.top + p.height - (v / p.max) * p.height;
    parts.push(text(LEFT, p.top - 10, p.title, { size: 12, weight: 600 }));
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = (p.max / steps) * i;
      parts.push(line(LEFT, y(v), RIGHT, y(v)));
      parts.push(text(LEFT - 6, y(v) + 4, p === linesPanel ? String(Math.round(v / 1000)) : fmt(v), { size: 10, fill: MUTED, anchor: "end" }));
    }
    for (const [iso, label] of months) {
      if (day(iso) < start || day(iso) > end) continue;
      parts.push(`<line x1="${r(x(iso))}" y1="${r(p.top)}" x2="${r(x(iso))}" y2="${r(p.top + p.height)}" stroke="${RULE}" stroke-width="1" stroke-dasharray="2 4"/>`);
      parts.push(text(x(iso) + 3, p.top + p.height + 14, label, { size: 10, fill: MUTED }));
    }
  }

  // Panel 1: lines, three series.
  {
    const p = linesPanel;
    const y = (v: number): number => p.top + p.height - (v / p.max) * p.height;
    const series: Array<[keyof Week["lines"], string, string]> = [
      ["code", AQUA, "code"],
      ["tests", BLUE, "tests"],
      ["docs", ORANGE, "docs"],
    ];
    for (const [key, color, label] of series) {
      const d = weeks.map((w, i) => `${i === 0 ? "M" : "L"}${r(x(w.date))},${r(y(w.lines[key]))}`).join(" ");
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`);
      const last = weeks[weeks.length - 1]!;
      parts.push(text(x(last.date) - 4, y(last.lines[key]) - 6, `${label} ${Math.round(last.lines[key] / 1000)}k`, { size: 11, fill: color, anchor: "end", weight: 600 }));
    }
  }
  // Panel 2: commits per week, bars.
  {
    const p = commitsPanel;
    const y = (v: number): number => p.top + p.height - (v / p.max) * p.height;
    const slot = (RIGHT - LEFT) / weeks.length;
    weeks.forEach((w) => {
      const bx = x(w.date) - slot + 1;
      parts.push(rect(Math.max(bx, LEFT), y(w.commits), Math.max(slot - 2, 1), p.top + p.height - y(w.commits), BLUE, 'rx="1"'));
    });
    const peak = weeks.reduce((a, b) => (b.commits > a.commits ? b : a));
    parts.push(text(x(peak.date), y(peak.commits) - 4, `${fmt(peak.commits)} in the week of ${peak.date.slice(5)}`, { size: 10, fill: MUTED, anchor: "end" }));
  }
  // Panel 3: issues open and closed, two lines.
  {
    const p = issuesPanel;
    const y = (v: number): number => p.top + p.height - (v / p.max) * p.height;
    const since = weeks.filter((w) => w.openIssues + w.closedIssues > 0);
    for (const [key, color, label] of [
      ["openIssues", PURPLE, "open"],
      ["closedIssues", AQUA, "closed"],
    ] as const) {
      const d = since.map((w, i) => `${i === 0 ? "M" : "L"}${r(x(w.date))},${r(y(w[key]))}`).join(" ");
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="8 5" stroke-linecap="round"/>`);
      const last = since[since.length - 1];
      if (last) parts.push(text(x(last.date) - 4, y(last[key]) - 6, `${label} ${fmt(last[key])}`, { size: 11, fill: color, anchor: "end", weight: 600 }));
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="Repository size by week, 2026">
<title>Repository size by week, 2026</title>
${rect(0, 0, W, H, PAPER)}
${parts.join("\n")}
</svg>
`;
}

// ---------------------------------------------------------------- main

function main(): void {
  const firstDay = git(["log", "--reverse", "--format=%ad", "--date=short", BRANCH]).split("\n")[0]!;
  const lastDay = new Date().toISOString().slice(0, 10);
  const weeks: Week[] = [];
  let prev: string | null = null;
  for (const date of mondays(firstDay, lastDay)) {
    const w = measure(date, prev);
    if (w) weeks.push(w);
    prev = date;
    process.stderr.write(`${date} ${w ? `${fmt(w.lines.code)} code ${fmt(w.lines.tests)} tests ${fmt(w.lines.docs)} docs ${w.commits} commits` : "no commit"}\n`);
  }
  mkdirSync(join(HERE, "data"), { recursive: true });
  mkdirSync(join(HERE, "figures"), { recursive: true });
  writeFileSync(join(HERE, "data", "size-history.json"), `${JSON.stringify({ branch: BRANCH, collectedAt: lastDay, weeks }, null, 1)}\n`);
  writeFileSync(join(HERE, "figures", "size-history.svg"), render(weeks));
  console.log(`size-history: ${weeks.length} weeks → dev/devprocess-talk/data/size-history.json, figures/size-history.svg`);
}

main();
