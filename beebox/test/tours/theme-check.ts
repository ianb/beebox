/**
 * `bin/theme-check`: theme studio captures at a laptop and a phone screen,
 * one per scroll step, with every contrast or material miss outlined and
 * labelled; then, at every screen size, a check that each theme image fills
 * its box and that every theme rule matches something in the studio. With one
 * theme it is the theme loop's screenshot step and always exits 0; `--all`
 * walks the catalog and exits 1 on any miss, for landing.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { THEME_CATALOG } from "../../src/shared/card-theme/core.js";
import { defaultStockOf, pairedCard, type StudioCase } from "../../src/shared/theme-studio-case.js";
import { SCREENS, type Screen } from "../../src/shared/theme-screens.js";
import { BrowseSession } from "./tour-lib/browse.js";
import { auditBackdrops, describeBackdropFailure } from "./tour-lib/backdrop.js";
import { auditContrast, describeContrastFailure, mergeContrastSteps, type ContrastStep } from "./tour-lib/contrast.js";
import { collectRules, describeUncoveredRule, matchRules, ruleTargets, type RuleExemption, type RuleTarget } from "./tour-lib/rules.js";

/**
 * Theme rules the studio cannot show, by a part of their selector. Each needs
 * a reason; a rule the studio could show gets a specimen in
 * ThemeStudioHarness.tsx instead.
 */
const RULE_EXEMPTIONS: readonly RuleExemption[] = [
  { selector: "#bbx-nav-profile img", reason: "a profile photo has no text to fail; the studio shows the initial, which can" },
  { selector: ".bbx-system-control", reason: "the selection capture button shows only over a text selection" },
  { selector: "#bbx-chat-load-older:disabled", reason: "disabled only while older messages load, and the contrast audit skips disabled text" },
];

/** Every catalog theme in the studio: each system theme and stock with its paired card, then each card stock not yet covered under Flat. */
function catalogCases(): StudioCase[] {
  const cases: StudioCase[] = [];
  for (const theme of THEME_CATALOG) {
    if (!theme.chrome) continue;
    for (const systemStock of theme.stocks) cases.push({ system: theme.name, systemStock, ...pairedCard({ system: theme.name, systemStock }) });
  }
  for (const theme of THEME_CATALOG) {
    if (theme.systemOnly) continue;
    for (const stock of theme.stocks) {
      if (cases.some((c) => c.card === theme.name && c.cardStock === stock)) continue;
      cases.push({ system: "plain", systemStock: "neutral", card: theme.name, cardStock: stock });
    }
  }
  return cases;
}

/** Contrast is measured at a laptop and a phone, one screen of scroll at a time. */
const CONTRAST_SCREENS = SCREENS.filter((s) => s.name === "laptop" || s.name === "phone");
/** Each scroll step keeps this much of the last, so a line cut at one edge is whole in the next. */
const STEP_OVERLAP = 80;
/** The card contents label shows while its card scrolls, and on load, rests 1.2s after and fades for 0.25s (card-themes.css); audit it at rest. */
const SETTLE_MS = 1600;
const SCROLLER = "document.getElementById(\"bbx-theme-studio-scroll\")";
const GEOMETRY_SCRIPT = `JSON.stringify((() => {
  const s = ${SCROLLER};
  if (s === null) throw new Error("theme-check: the studio has no #bbx-theme-studio-scroll");
  return { scroll: s.scrollHeight, client: s.clientHeight };
})())`;

/** Scroll positions that show the whole studio, one screen apart less the overlap. */
async function scrollSteps(session: BrowseSession): Promise<number[]> {
  const once: unknown = JSON.parse((await session.eval(GEOMETRY_SCRIPT)).trim());
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: GEOMETRY_SCRIPT builds exactly this shape in the page
  const { scroll, client } = (typeof once === "string" ? JSON.parse(once) : once) as { scroll: number; client: number };
  const step = client - STEP_OVERLAP;
  return Array.from({ length: 1 + Math.max(0, Math.ceil((scroll - client) / step)) }, (_, i) => i * step);
}

function caseName(c: StudioCase): string {
  const system = `${c.system}-${c.systemStock}`;
  return c.system === c.card && c.systemStock === c.cardStock ? system : `${system}+${c.card}-${c.cardStock}`;
}

function studioPath(c: StudioCase): string {
  return `/dev/theme-studio?${new URLSearchParams({ ...c, controls: "0" }).toString()}`;
}

async function checkContrast(session: BrowseSession, { c, screen, outDir }: { c: StudioCase; screen: Screen; outDir: string }): Promise<number> {
  await session.open(studioPath(c));
  const steps: ContrastStep[] = [];
  for (const [n, top] of (await scrollSteps(session)).entries()) {
    const before = `${SCROLLER}.scrollTop = ${String(top)}; await new Promise((settle) => setTimeout(settle, ${String(SETTLE_MS)}));`;
    steps.push(await auditContrast(session, { outline: true, before }));
    await session.screenshot(path.join(outDir, `${caseName(c)}.${screen.name}.${String(n)}.png`));
  }
  const result = mergeContrastSteps(steps);
  const lines = result.failures.map((f) => `  ${describeContrastFailure(f)}\n`);
  // Missed coverage counts as a miss: an unmeasured run is not a passing one.
  for (const run of result.offscreen) lines.push(`  never wholly in view or always covered, so not measured: ${run}\n`);
  for (const run of result.unmeasured) lines.push(`  not measurable (partly covered, or in a faded group over an image): ${run}\n`);
  const misses = result.failures.length + result.offscreen.length + result.unmeasured.length;
  const shots = path.join(outDir, `${caseName(c)}.${screen.name}.{0..${String(steps.length - 1)}}.png`);
  process.stdout.write(`${caseName(c)} ${screen.name}: ${misses === 0 ? "ok" : `${String(misses)} to fix`} (${String(result.runs)} text runs)\n${lines.join("")}  → ${shots}\n`);
  return misses;
}

/** Rules per case, collected on the case's first load; and which rule keys matched anywhere. */
interface Coverage {
  targets: Map<string, RuleTarget[]>;
  all: Map<string, RuleTarget>;
  matched: Set<string>;
  unparsable: Set<string>;
}

async function checkScreen(session: BrowseSession, { c, screen, coverage }: { c: StudioCase; screen: Screen; coverage: Coverage }): Promise<number> {
  await session.open(studioPath(c));
  const result = await auditBackdrops(session);
  const lines = result.failures.map((f) => `  ${describeBackdropFailure(f)}\n`);
  for (const image of result.unloaded) lines.push(`  ${image} did not load, so it was not measured\n`);
  if (lines.length > 0) process.stdout.write(`${caseName(c)} ${String(screen.width)}×${String(screen.height)}: ${String(lines.length)} backdrop misses\n${lines.join("")}`);
  const name = caseName(c);
  let targets = coverage.targets.get(name);
  if (targets === undefined) {
    targets = ruleTargets(await collectRules(session), { themes: [c.system, c.card], exemptions: RULE_EXEMPTIONS });
    coverage.targets.set(name, targets);
    for (const target of targets) coverage.all.set(target.key, target);
  }
  const matches = await matchRules(session, targets);
  for (const [i, target] of targets.entries()) {
    if (matches[i] === true) coverage.matched.add(target.key);
    if (matches[i] === null) coverage.unparsable.add(target.key);
  }
  return lines.length;
}

function reportCoverage(coverage: Coverage): number {
  // A member of a list in a selector that matches nothing is that selector's miss, reported once.
  const uncovered = [...coverage.all.values()].filter((t) => !coverage.matched.has(t.key) && (t.whole === null || coverage.matched.has(t.whole)));
  if (uncovered.length === 0) return 0;
  process.stdout.write(`${String(uncovered.length)} theme rules match nothing in the studio at any screen: render what they style in ThemeStudioHarness.tsx, delete them if no component renders it, or exempt them in theme-check.ts with a reason\n`);
  for (const target of uncovered) process.stdout.write(`  ${describeUncoveredRule(target, { unparsable: coverage.unparsable.has(target.key) })}\n`);
  return uncovered.length;
}

interface Job { kind: "contrast" | "screen"; screen: Screen; c: StudioCase }

/** Run the jobs on `workers` browser sessions at once; each browse call mostly waits. */
async function runJobs(jobs: readonly Job[], { workers, run }: { workers: number; run: (session: BrowseSession, job: Job) => Promise<number> }): Promise<number> {
  let next = 0;
  let misses = 0;
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, async (_, i) => {
    const session = new BrowseSession(`theme-check-${String(i + 1)}`);
    let viewport = "";
    try {
      for (let job = jobs[next++]; job !== undefined; job = jobs[next++]) {
        const size = `${String(job.screen.width)}×${String(job.screen.height)}`;
        if (size !== viewport) await session.setViewport(job.screen.width, job.screen.height);
        viewport = size;
        // Await first: `misses += await …` reads `misses` before the await and
        // drops counts other sessions add meanwhile.
        const found = await run(session, job);
        misses += found;
      }
    } finally {
      await session.close();
    }
  }));
  return misses;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      system: { type: "string", default: "draft" },
      "system-stock": { type: "string" },
      card: { type: "string" },
      "card-stock": { type: "string" },
      all: { type: "boolean", default: false },
      out: { type: "string" },
      jobs: { type: "string", default: "3" },
    },
  });
  const outDir = path.resolve(values.out ?? path.join(import.meta.dirname, ".artifacts", "theme-check"));
  await mkdir(outDir, { recursive: true });
  const systemStock = values["system-stock"] ?? defaultStockOf(values.system);
  const cases = values.all ? catalogCases() : [{
    system: values.system,
    systemStock,
    card: values.card ?? values.system,
    cardStock: values["card-stock"] ?? (values.card === undefined ? systemStock : defaultStockOf(values.card)),
  }];
  const workers = Number(values.jobs);
  if (!Number.isInteger(workers) || workers < 1) throw new Error(`--jobs must be a whole number of browser sessions, got ${values.jobs}`);
  const coverage: Coverage = { targets: new Map(), all: new Map(), matched: new Set(), unparsable: new Set() };
  const jobs: Job[] = [
    ...CONTRAST_SCREENS.flatMap((screen) => cases.map((c) => ({ kind: "contrast" as const, screen, c }))),
    ...SCREENS.flatMap((screen) => cases.map((c) => ({ kind: "screen" as const, screen, c }))),
  ];
  let misses = await runJobs(jobs, {
    workers,
    run: (session, { kind, screen, c }) => kind === "contrast" ? checkContrast(session, { c, screen, outDir }) : checkScreen(session, { c, screen, coverage }),
  });
  misses += reportCoverage(coverage);
  process.stdout.write(misses === 0 ? "No contrast, material, backdrop or rule coverage misses measured.\n" : `${String(misses)} misses.\n`);
  return values.all && misses > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e: unknown) => {
  process.stderr.write(`theme-check: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
