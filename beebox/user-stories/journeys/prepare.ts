/**
 * Prepare a journey run: build the box, place the assets, compose the prompt.
 *
 * Everything deterministic happens here so a run is reproducible and so no part of
 * the setup is improvised in conversation — which is how the first two runs went,
 * and it did not survive contact with a second journey.
 *
 * What this does NOT do is walk the journey. That needs an agent driving a browser,
 * which is the caller's job; this prints the prompt path to hand it. Keeping the
 * split here means the deterministic half can be re-run, diffed, and fixed without
 * spending an agent.
 *
 * Usage: pnpm exec tsx beebox/user-stories/journeys/prepare.ts <journey-id>
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { parse } from "yaml";

import { errorMessage } from "../../src/lib/error-guards.ts";
import { isRecord } from "../../src/lib/is-record.ts";
import { runHealthChecks } from "../../src/webapp/trpc/routers/health.ts";
import { assertPreviousRunsReported, allocateRun } from "./provisioning.ts";

const HERE = import.meta.dirname;
const MONO_ROOT = resolve(HERE, "../../..");
const WORKTREE = basename(MONO_ROOT);
const BOXES_ROOT = join(homedir(), "src", "box-worktrees", WORKTREE);
const WORK = join(HERE, "../work/journeys");

interface Asset { file: string, described_as: string }
interface Journey {
  id: string
  title: string
  box: { base: string, setup?: string | null }
  assets?: Asset[]
  sittings?: number
  budget_actions?: number
  situation: string
  closing?: string
  watch_for?: string
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const id = process.argv[2];
if (id === undefined) fail("usage: prepare.ts <journey-id>   (a directory under journeys/)");

const journeyDir = join(HERE, id);
const specPath = join(journeyDir, "journey.yaml");
if (!existsSync(specPath)) fail(`no journey at ${specPath}`);

const parsed: unknown = parse(readFileSync(specPath, "utf8"));
if (!isRecord(parsed)) fail(`${specPath} is not a mapping`);
// The spec is ours and validated by use, not by a schema: a bad field surfaces as a
// missing section in the composed prompt, which is visible before any agent runs.
// eslint-disable-next-line no-restricted-syntax -- parse boundary: YAML we wrote, checked by the field reads below.
const journey = parsed as unknown as Journey;

for (const required of ["id", "title", "situation"] as const) {
  if (typeof journey[required] !== "string") fail(`${specPath}: missing ${required}`);
}
if (journey.id !== id) fail(`${specPath}: id must match its directory name`);
if (!isRecord(journey.box)) fail(`${specPath}: box is required`);

// Check every asset before creating or writing anything: a run that dies
// half-provisioned leaves a box served and an .env edited for a journey that never ran.
const assets = journey.assets ?? [];
for (const a of assets) {
  if (!existsSync(join(journeyDir, "assets", a.file))) {
    fail(`asset missing: ${join(journeyDir, "assets", a.file)}`);
  }
}

// Check evidence before creating anything. Preserve previous boxes, screenshots,
// and transcripts; a new run never needs to erase another run to be fresh.
assertPreviousRunsReported({ work: WORK, journeyDir, id: journey.id });
if (journey.box.base !== "empty") fail("Only base: empty is supported; use box.setup for authored fixture state.");
const { runDir, boxDir, boxSlug } = allocateRun({ work: WORK, boxes: BOXES_ROOT, id: journey.id });
mkdirSync(join(runDir, "shots"), { recursive: true });
mkdirSync(join(runDir, "assets"), { recursive: true });

// Canonical init creates the package, current one-root layout, annex, templates,
// validation hooks and initial history. Never clone another person's runtime state.
execFileSync(join(MONO_ROOT, "beebox", "bin", "bbx"), ["engine", "init", boxDir], {
  cwd: MONO_ROOT,
  env: { ...process.env, GIT_AUTHOR_NAME: "Journey Box", GIT_AUTHOR_EMAIL: "journey@example.com",
    GIT_COMMITTER_NAME: "Journey Box", GIT_COMMITTER_EMAIL: "journey@example.com" },
  stdio: "inherit",
});
const content = boxDir;

// A journey box is built for an agent-driven browser, so it says so: with
// `agentBrowsing: "owner"` the browse key acts as the box owner and the walker
// reaches capture, Settings, and every owner-gated procedure
// (`docs/plans/agent-browsing-owner.md`). This is a disposable fixture setting;
// a box a person actually uses must never have it.
const boxConfigPath = join(content, "_config", "box.json");
const boxConfig: unknown = existsSync(boxConfigPath) ? JSON.parse(readFileSync(boxConfigPath, "utf8")) : {};
if (!isRecord(boxConfig)) fail(`${boxConfigPath} is not a JSON object`);
writeFileSync(boxConfigPath, `${JSON.stringify({ ...boxConfig, agentBrowsing: "owner" }, null, 2)}\n`);

if (typeof journey.box.setup === "string" && journey.box.setup.trim() !== "") {
  try {
    execFileSync("bash", ["-euo", "pipefail", "-c", journey.box.setup], {
      env: { ...process.env, BOX: content },
      stdio: "inherit",
    });
  } catch (e) {
    fail(`journey setup failed: ${errorMessage(e)}`);
  }
}

// Fixture edits are recorded after canonical init, with the installed hooks intact.
execFileSync("git", ["-C", boxDir, "config", "user.name", "Journey Box"], { stdio: "inherit" });
execFileSync("git", ["-C", boxDir, "config", "user.email", "journey@example.com"], { stdio: "inherit" });
execFileSync("git", ["-C", boxDir, "add", "-A"], { stdio: "inherit" });
execFileSync("git", ["-C", boxDir, "commit", "-q", "-m", "Box as it was handed over"], { stdio: "inherit" });

// Use the same structured checks as the dashboard, not the agent-facing health CLI.
const checks = await runHealthChecks(boxDir);
writeFileSync(join(runDir, "health.json"), `${JSON.stringify(checks, null, 2)}\n`);
const blockers = checks.filter((check) => !check.ok && check.severity === "error");
if (blockers.length > 0) fail(`Fixture health failed: ${blockers.map((check) => check.message).join("; ")}`);
for (const warning of checks.filter((check) => !check.ok)) console.log(`health warning: ${warning.message}`);

// A box the router does not serve is a box nobody can walk. The worktree's own
// .env lists what it serves; the router reads it when the worktree next starts.
const envPath = join(MONO_ROOT, "beebox", ".env");
const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const served = new Set<string>(
  (/^BOXES=(.*)$/mu.exec(envText)?.[1] ?? join(BOXES_ROOT, "test1")).split(/\s+/u).filter(Boolean),
);
served.add(boxDir);
const nextEnv = /^BOXES=.*$/mu.test(envText)
  ? envText.replace(/^BOXES=.*$/mu, `BOXES=${[...served].join(" ")}`)
  : `${envText}${envText.endsWith("\n") || envText === "" ? "" : "\n"}BOXES=${[...served].join(" ")}\n`;
writeFileSync(envPath, nextEnv);

// --- assets --------------------------------------------------------------------
for (const a of assets) {
  cpSync(join(journeyDir, "assets", a.file), join(runDir, "assets", a.file));
}

// --- the prompt ----------------------------------------------------------------
const assetLines = assets.length === 0
  ? "You have brought nothing with you. Whatever you do here, you do from what you already know."
  : [
    "You have these to hand:",
    "",
    ...assets.map((a) => `- \`${join(runDir, "assets", a.file)}\` — ${a.described_as}`),
    "",
    "These are yours — treat them the way you would treat your own photos. They are a starting",
    "point, not the job; the job is the thing above.",
  ].join("\n");

const template = readFileSync(join(HERE, "walker-prompt.md"), "utf8")
  .replace("{{SITUATION}}", journey.situation.trim())
  .replace("{{ASSETS}}", assetLines)
  .replace("{{BUDGET}}", String(journey.budget_actions ?? 60))
  .replaceAll("{{BOX_SLUG}}", boxSlug)
  .replaceAll("{{BOX_CONTENT}}", content)
  .replace("{{SHOTS}}", join(runDir, "shots"))
  .replace("{{NOTES}}", join(runDir, "notes.md"))
  .replace("{{CLOSING}}", (journey.closing ?? "").trim());
writeFileSync(join(runDir, "prompt.md"), template);

// `watch_for` is for whoever reads the notes. It never goes near the walker, so it
// is written beside the run rather than into the prompt.
if (journey.watch_for !== undefined) {
  writeFileSync(join(runDir, "watch-for.md"), `# ${journey.title} — for the reader\n\n${journey.watch_for.trim()}\n`);
}

// --- the before-snapshot --------------------------------------------------------
const head = execFileSync("git", ["-C", boxDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
writeFileSync(join(runDir, "before.json"), `${JSON.stringify({
  journey: journey.id,
  startedIso: new Date().toISOString(),
  box: boxDir,
  url: `http://localhost:3210/${WORKTREE}/${boxSlug}/`,
  headBefore: head,
}, null, 2)}\n`);

// Boxes accumulate, one per run, and nothing prunes them — a past walk's box holds
// the commits that walk produced, and deciding they are worth less than the disk is
// the boxholder's call, not this script's. Reporting the footprint is how that call
// stays informed rather than arriving as a surprise.
const siblings = readdirSync(BOXES_ROOT).filter((d) => d.startsWith(`${journey.id.toLowerCase()}-`));
if (siblings.length > 1) {
  const used = execFileSync("du", ["-sh", BOXES_ROOT], { encoding: "utf8" }).split("\t")[0]?.trim() ?? "?";
  console.log(`boxes    ${String(siblings.length)} runs of ${journey.id} kept (${used} total in ${BOXES_ROOT})`);
}
// A nonempty error page is not proof that the box renders. Require app chrome
// at the exact requested box URL before handing any prompt to a walker.
const browseEnv = { ...process.env, BROWSE_BOX: boxSlug };
try {
  execFileSync(join(MONO_ROOT, "bin", "browse"), ["--session", "journey-prepare", "open", "/"], {
    cwd: MONO_ROOT, env: browseEnv, stdio: "inherit", timeout: 60_000,
  });
  const ready = execFileSync(join(MONO_ROOT, "bin", "browse"), ["--session", "journey-prepare", "eval",
    `location.pathname.startsWith(${JSON.stringify(`/${WORKTREE}/${boxSlug}/`)}) && !!document.getElementById("bbx-nav-profile")`], {
    cwd: MONO_ROOT, env: browseEnv, encoding: "utf8", timeout: 60_000,
  }).trim();
  if (ready !== "true") fail(`Fixture did not render its app navigation: ${ready}. Preserve this run and investigate before walking. A warm worktree may still have the previous BOXES registration; a worktree cold start may be needed to read the new registration. This script does not restart it.`);
} catch (error) {
  fail(`Could not verify the fixture through the router: ${errorMessage(error)}. Preserve this run; do not spend a walker yet.`);
}

console.log(`box      ${boxDir}`);
console.log(`url      http://localhost:3210/${WORKTREE}/${boxSlug}/`);
console.log(`assets   ${assets.length}`);
console.log(`run      ${runDir}`);
console.log(`prompt   ${join(runDir, "prompt.md")}`);
console.log("\nHand that prompt to an agent with browser access. Then:");
console.log(`  pnpm exec tsx beebox/user-stories/journeys/collect.ts ${basename(runDir)}`);
