/**
 * `bin/theme-check`: theme studio captures at a laptop and a phone screen,
 * one per scroll step, with every contrast or material miss outlined and
 * labelled; then, at every screen size, a check that each theme image fills
 * its box and that every theme rule matches something in the studio. With one
 * theme it is the theme loop's screenshot step and always exits 0; `--all`
 * walks the catalog and exits 1 on any miss, for landing.
 */

import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { THEME_CATALOG } from "../../src/shared/card-theme/core.js";
import { defaultStockOf, pairedCard, type StudioCase } from "../../src/shared/theme-studio-case.js";
import { SCREENS, type Screen } from "../../src/shared/theme-screens.js";
import { BrowseSession } from "./tour-lib/browse.js";
import { auditBackdrops, describeBackdropFailure } from "./tour-lib/backdrop.js";
import { auditContrast, describeContrastFailure, mergeContrastSteps, type ContrastStep } from "./tour-lib/contrast.js";
import { collectRules, describeUncoveredRule, matchRules, ruleTargets, type RuleExemption, type RuleTarget } from "./tour-lib/rules.js";
import { checkFocusedStudio } from "./theme-check-focus.js";
import { jobKey, loadLastRun, retryJobs, runId, saveLastRun, sourceFingerprint, ThemeCheckError, validateLastRun, type ThemeJob } from "./theme-check-run.js";

/**
 * Theme rules the studio cannot show, by a part of their selector. Each needs
 * a reason; a rule the studio could show gets a specimen in
 * ThemeStudioHarness.tsx instead.
 */
const RULE_EXEMPTIONS: readonly RuleExemption[] = [
  { selector: "#bbx-nav-profile img", reason: "a profile photo has no text to fail; the studio shows the initial, which can" },
  { selector: ".bbx-system-control", reason: "the selection capture button shows only over a text selection" },
  { selector: "#bbx-chat-load-older:disabled", reason: "disabled only while older messages load, and the contrast audit skips disabled text" },
  { selector: ".bbx-card-surface[data-card-turn", reason: "the 140–180ms turn transform is absent from settled captures; both settled faces are studio specimens" },
  { selector: ".bbx-card-properties[aria-busy=\"true\"]", reason: "busy only during the card-turn transition; text faces are measured at rest" },
];

/**
 * The theme sheets. A rule in one that names no theme (the question patch)
 * is worn by every theme, so the studio must show it too.
 */
async function sharedSheets(): Promise<string[]> {
  return (await readdir(path.join(import.meta.dirname, "../../src/frontend/src/themes")))
    .filter((name) => name.endsWith(".css"));
}

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
/**
 * Each scroll step keeps this much of the last, so a line cut at one edge is
 * whole in the next. A sticky row at the bottom of the screen (the question
 * patch's) covers about 100px there, so the overlap clears it.
 */
const STEP_OVERLAP = 160;
/** The card contents label shows while its card scrolls, and on load, rests 1.2s after and fades for 0.25s (card-themes.css); audit it at rest. */
const SETTLE_MS = 1600;
const SCROLLER = "document.getElementById(\"bbx-theme-studio-scroll\")";
const SOURCE_CHANGED = "frontend or shared source changed during the run; restart theme-check after edits settle";
const STUDIO_RELOADED = "theme studio reloaded during the run; restart theme-check after edits settle";
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

async function openStudio(session: BrowseSession, { c, marker }: { c: StudioCase; marker: string }): Promise<void> {
  await session.open(studioPath(c));
  try {
    await session.run(["wait", "--fn", `${SCROLLER} !== null`, "--timeout", "30000"]);
  } catch (cause) {
    throw new ThemeCheckError(`theme studio did not render #bbx-theme-studio-scroll for ${caseName(c)} within 30 seconds: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  try { await session.run(["wait", ".bbx-app-nav"]); }
  catch (cause) { throw new ThemeCheckError(`normal studio navigation is not visible for ${caseName(c)}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
  // Activity lives outside the transcript; expanding it exposes its hint and actions.
  const ambientToggle = "#bbx-theme-studio-ambient button[aria-expanded]";
  try {
    await session.run(["wait", ambientToggle]);
    await session.run(["scrollintoview", ambientToggle]);
    await session.run(["click", ambientToggle]);
    await session.run(["wait", "--fn", `document.querySelector(${JSON.stringify(ambientToggle)})?.getAttribute("aria-expanded") === "true"`]);
  } catch (cause) {
    throw new ThemeCheckError(`could not expand conversation activity for ${caseName(c)}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  await session.run(["mouse", "move", "0", "0"]);
  await session.eval(`${SCROLLER}.scrollTop = 0; ${SCROLLER}.dataset.themeCheckRun = ${JSON.stringify(marker)}`);
}

async function checkMarker(session: BrowseSession, marker: string): Promise<void> {
  const actual = (await session.eval(`${SCROLLER}?.dataset.themeCheckRun ?? null`)).trim();
  if (actual !== JSON.stringify(marker)) throw new ThemeCheckError(STUDIO_RELOADED);
}

async function assertSourceUnchanged(fingerprint: string): Promise<void> {
  try {
    if (await sourceFingerprint() !== fingerprint) throw new ThemeCheckError(SOURCE_CHANGED);
  } catch (cause) {
    throw new ThemeCheckError(SOURCE_CHANGED, { cause });
  }
}

async function checkContrast(session: BrowseSession, { c, screen, outDir, marker }: { c: StudioCase; screen: Screen; outDir: string; marker: string }): Promise<number> {
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
  await checkMarker(session, marker);
  return misses;
}

/** Rules per case, collected on the case's first load; and which rule keys matched anywhere. */
interface Coverage {
  shared: readonly string[];
  targets: Map<string, RuleTarget[]>;
  all: Map<string, RuleTarget>;
  matched: Set<string>;
  unparsable: Set<string>;
}

async function checkScreen(session: BrowseSession, { c, screen, coverage, marker, state }: { c: StudioCase; screen: Screen; coverage: Coverage; marker: string; state: string }): Promise<number> {
  const result = await auditBackdrops(session);
  const lines = result.failures.map((f) => `  ${describeBackdropFailure(f)}\n`);
  for (const image of result.unloaded) lines.push(`  ${image} did not load, so it was not measured\n`);
  if (lines.length > 0) process.stdout.write(`${caseName(c)} ${state} ${String(screen.width)}×${String(screen.height)}: ${String(lines.length)} backdrop misses\n${lines.join("")}`);
  const name = caseName(c);
  let targets = coverage.targets.get(name);
  if (targets === undefined) {
    targets = ruleTargets(await collectRules(session), { themes: [c.system, c.card], shared: coverage.shared, exemptions: RULE_EXEMPTIONS });
    coverage.targets.set(name, targets);
    for (const target of targets) coverage.all.set(target.key, target);
  }
  const matches = await matchRules(session, targets);
  for (const [i, target] of targets.entries()) {
    if (matches[i] === true) coverage.matched.add(target.key);
    if (matches[i] === null) coverage.unparsable.add(target.key);
  }
  await checkMarker(session, marker);
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

/** Run the jobs on `workers` browser sessions at once; each browse call mostly waits. */
async function runJobs(jobs: readonly ThemeJob[], { workers, id, fingerprint, run }: { workers: number; id: string; fingerprint: string; run: (session: BrowseSession, options: { job: ThemeJob; marker: string }) => Promise<number> }): Promise<{ misses: number; failed: string[] }> {
  let next = 0;
  let misses = 0;
  let stopped = false;
  const failed: string[] = [];
  const results = await Promise.allSettled(Array.from({ length: Math.min(workers, jobs.length) }, async (_, i) => {
    const session = new BrowseSession(`theme-check-${id}-${String(i + 1)}`);
    let viewport = "";
    try {
      while (!stopped) {
        const job = jobs[next++];
        if (job === undefined) break;
        await assertSourceUnchanged(fingerprint);
        const size = `${String(job.screen.width)}×${String(job.screen.height)}`;
        if (size !== viewport) await session.setViewport(job.screen.width, job.screen.height);
        viewport = size;
        const marker = `${id}-${String(next)}`;
        try { await openStudio(session, { c: job.c, marker }); }
        catch (error) { await assertSourceUnchanged(fingerprint); throw error; }
        try {
          const found = await run(session, { job, marker });
          await assertSourceUnchanged(fingerprint);
          misses += found;
          if (found > 0) failed.push(jobKey(job));
        } catch (error) {
          await assertSourceUnchanged(fingerprint);
          // A readable changed marker proves a reload. A dead browser cannot
          // establish that: retain the original operation's diagnostic.
          try { await checkMarker(session, marker); }
          catch (markerError) { if (markerError instanceof ThemeCheckError) throw markerError; }
          throw error;
        }
      }
    } catch (error) {
      stopped = true;
      throw error;
    } finally {
      await session.close();
    }
  }));
  const error = results.find((result) => result.status === "rejected");
  if (error?.status === "rejected") throw error.reason;
  return { misses, failed };
}

function validateModes(all: boolean, failed: boolean): void {
  if (all && failed) throw new ThemeCheckError("choose either --all or --failed");
}

function reportRetry(last: { fullCatalog: boolean; cases: readonly StudioCase[] }): void {
  process.stdout.write(`Retrying the last completed ${last.fullCatalog ? "full-catalog" : "preview"} run (${String(last.cases.length)} cases). A later preview replaces this record; use a separate --out to keep runs independent.\n`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      system: { type: "string", default: "draft" },
      "system-stock": { type: "string" },
      card: { type: "string" },
      "card-stock": { type: "string" },
      all: { type: "boolean", default: false },
      failed: { type: "boolean", default: false },
      out: { type: "string" },
      jobs: { type: "string", default: "3" },
    },
  });
  validateModes(values.all, values.failed);
  const outRoot = path.resolve(values.out ?? path.join(import.meta.dirname, ".artifacts", "theme-check"));
  const id = runId();
  const outDir = path.join(outRoot, id);
  await mkdir(outDir, { recursive: true });
  const last = values.failed ? await loadLastRun(outRoot) : null;
  if (last !== null) validateLastRun(last, { catalog: catalogCases(), themes: THEME_CATALOG });
  if (last !== null) reportRetry(last);
  const systemStock = values["system-stock"] ?? defaultStockOf(values.system);
  const cases = last?.cases ?? (values.all ? catalogCases() : [{
    system: values.system,
    systemStock,
    card: values.card ?? values.system,
    cardStock: values["card-stock"] ?? (values.card === undefined ? systemStock : defaultStockOf(values.card)),
  }]);
  const workers = Number(values.jobs);
  if (!Number.isInteger(workers) || workers < 1) throw new ThemeCheckError(`--jobs must be a whole number of browser sessions, got ${values.jobs}`);
  const coverage: Coverage = { shared: await sharedSheets(), targets: new Map(), all: new Map(), matched: new Set(), unparsable: new Set() };
  const available: ThemeJob[] = [
    ...CONTRAST_SCREENS.flatMap((screen) => cases.map((c) => ({ kind: "contrast" as const, screen, c }))),
    ...SCREENS.flatMap((screen) => cases.map((c) => ({ kind: "screen" as const, screen, c }))),
  ];
  const selected = last === null ? { jobs: available, completeCoverage: true } : retryJobs(last, available);
  const fingerprint = await sourceFingerprint();
  const result = await runJobs(selected.jobs, {
    workers, id, fingerprint,
    run: (session, { job: { kind, screen, c }, marker }) => kind === "contrast" ? checkContrast(session, { c, screen, outDir, marker }) : checkFocusedStudio(session, { screen, name: caseName(c), check: (state) => checkScreen(session, { c, screen, coverage, marker, state }) }),
  });
  let misses = result.misses;
  const coverageMisses = selected.completeCoverage ? reportCoverage(coverage) : 0;
  misses += coverageMisses;
  if (!selected.completeCoverage) process.stdout.write("Rule coverage not checked in this partial retry.\n");
  await saveLastRun(outRoot, { version: 1, fullCatalog: last?.fullCatalog ?? values.all, cases, failed: result.failed, coverageNeeded: coverageMisses > 0 });
  process.stdout.write(misses === 0
    ? `No contrast, material or backdrop misses measured${selected.completeCoverage ? "; rule coverage passed" : "; rule coverage not checked"}.\n`
    : `${String(misses)} misses.\n`);
  if (values.failed) process.stdout.write("Diagnostic retry only; run --all for the landing gate.\n");
  return (values.all || values.failed) && misses > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e: unknown) => {
  process.stderr.write(`theme-check: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
