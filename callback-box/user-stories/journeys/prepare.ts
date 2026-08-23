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
 * Usage: pnpm exec tsx callback-box/user-stories/journeys/prepare.ts <journey-id>
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { parse } from "yaml";

import { errorMessage } from "../../src/lib/error-guards.ts";
import { isRecord } from "../../src/lib/is-record.ts";

const HERE = import.meta.dirname;
const MONO_ROOT = resolve(HERE, "../../..");
const WORKTREE = basename(MONO_ROOT);
const BOXES_ROOT = join(homedir(), "src", "box-worktrees", WORKTREE);
const WORK = join(HERE, "../work/journeys");

/**
 * Emptied for `base: empty` — the person's box, not a stranger's.
 *
 * The CONTENTS go; the directories stay. Removing `box/` and `store/` outright left a
 * box whose own health check reported `box/inbox/ is not writable` and
 * `store/archive/ is not writable`, and a walker spent an evening typing into an app
 * that could not accept anything (2026-08-23).
 */
const EMPTY_BUT_KEEP = ["store", "box"];

/** Removed outright: pure content, and nothing structural expects them. */
const PRUNE_ENTIRELY = ["people", "places", "memory", "procedure", "tricks"];

/** Chat state that would otherwise drop the person into an earlier conversation. */
const CHAT_STATE = ["chat-session-id.json", "chat-session-history.json"];

interface Asset { file: string, described_as: string }
interface Journey {
  id: string
  title: string
  box: { slug: string, base: string, setup?: string | null }
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
if (!isRecord(journey.box) || typeof journey.box.slug !== "string") fail(`${specPath}: box.slug is required`);

// Check every asset before creating or writing anything: a run that dies
// half-provisioned leaves a box served and an .env edited for a journey that never ran.
const assets = journey.assets ?? [];
for (const a of assets) {
  if (!existsSync(join(journeyDir, "assets", a.file))) {
    fail(`asset missing: ${join(journeyDir, "assets", a.file)}`);
  }
}

// Never reuse or overwrite a run directory. The first version refused when one existed
// and told the operator to move it aside, which just trains them to `rm -rf` the
// obstacle — and that is exactly how a completed walk's notes and 24 screenshots were
// destroyed on 2026-08-23. Taking the next free suffix removes the temptation.
const today = new Date().toISOString().slice(0, 10);
let runDir = join(WORK, `${journey.id}-${today}`);
for (let n = 2; existsSync(runDir); n++) runDir = join(WORK, `${journey.id}-${today}-${n}`);
mkdirSync(join(runDir, "shots"), { recursive: true });
mkdirSync(join(runDir, "assets"), { recursive: true });

// --- the box -------------------------------------------------------------------
const boxDir = join(BOXES_ROOT, journey.box.slug);
if (existsSync(boxDir)) {
  // git-annex stores its objects read-only, and read-only files inside read-only
  // directories defeat rmSync — so reprovisioning a box that has been annexed once
  // fails partway and leaves a wreck. Make it writable first.
  execFileSync("chmod", ["-R", "u+w", boxDir], { stdio: "inherit" });
  rmSync(boxDir, { recursive: true, force: true });
}

const base = journey.box.base === "empty" ? join(BOXES_ROOT, "test1") : journey.box.base;
if (!existsSync(base)) fail(`base box not found: ${base}`);
cpSync(base, boxDir, { recursive: true, filter: (src) => !src.includes(`${join(base, ".git")}`) });

const content = join(boxDir, "content");
if (journey.box.base === "empty") {
  for (const dir of PRUNE_ENTIRELY) rmSync(join(content, dir), { recursive: true, force: true });
  for (const dir of EMPTY_BUT_KEEP) {
    const full = join(content, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) rmSync(join(full, entry), { recursive: true, force: true });
  }
}
for (const f of CHAT_STATE) rmSync(join(content, ".callback-box", f), { force: true });
rmSync(join(content, ".callback-box", "active-chats"), { recursive: true, force: true });

// Emptying `box/` and `store/` removes `box/inbox` and `store/archive` along with the
// contents, and the box then fails its own health check. `cb init` is the supported way
// to restore a valid skeleton without reintroducing anyone's data.
execFileSync(join(MONO_ROOT, "callback-box", "bin", "cb"), ["init"], { cwd: content, stdio: "inherit" });

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

// The box gets its OWN history. Copying test1's .git would hand the person a
// stranger's commits in a product whose History view is a feature; starting fresh
// means the first thing in their history is their own arrival.
execFileSync("git", ["-C", boxDir, "init", "-q"], { stdio: "inherit" });
execFileSync("git", ["-C", boxDir, "config", "user.name", "Journey Box"], { stdio: "inherit" });
execFileSync("git", ["-C", boxDir, "config", "user.email", "journey@example.com"], { stdio: "inherit" });
execFileSync("git", ["-C", boxDir, "add", "-A"], { stdio: "inherit" });
execFileSync("git", ["-C", boxDir, "commit", "-q", "-m", "Box as it was handed over", "--no-verify"], {
  stdio: "inherit",
});

// A real box is annex-converted; a file copy plus `git init` is not, and the box then
// answers 503 to every upload. The first run on a prepared box hit exactly that and
// spent an hour on what looked like a product bug — so this is provisioning, not
// polish. Failing here is better than a walk built on a box that cannot take a photo.
try {
  // `cb` finds its box from the working directory, so it runs IN the box — not via
  // `pnpm --dir`, which moves the cwd to the package and loses it.
  execFileSync(join(MONO_ROOT, "callback-box", "bin", "cb"), ["attachments", "to-annex"], {
    cwd: content,
    stdio: "inherit",
  });
} catch (e) {
  fail(`annex conversion failed for ${boxDir}: ${errorMessage(e)}\nUploads would answer 503; fix before walking.`);
}

// A box the router does not serve is a box nobody can walk. The worktree's own
// .env lists what it serves; the router reads it when the worktree next starts.
const envPath = join(MONO_ROOT, "callback-box", ".env");
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
  ? "You have nothing with you. Whatever you do here, you do from what you already know."
  : [
    "You have these to hand:",
    "",
    ...assets.map((a) => `- \`${join(runDir, "assets", a.file)}\` — ${a.described_as}`),
    "",
    "That is a starting point, not the job. The job is the thing above.",
  ].join("\n");

const template = readFileSync(join(HERE, "walker-prompt.md"), "utf8")
  .replace("{{SITUATION}}", journey.situation.trim())
  .replace("{{ASSETS}}", assetLines)
  .replace("{{BUDGET}}", String(journey.budget_actions ?? 60))
  .replaceAll("{{BOX_SLUG}}", journey.box.slug)
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

// --- is this box actually usable? ------------------------------------------------
//
// Twice now a walk has been spent on a box that could not do the thing the journey
// needed, and both times the app knew: `cb health` named the blocker in plain English
// while the person typed into a screen that said nothing. So ask it before handing
// over, and refuse on a hard failure. `!` warnings (missing optional credentials,
// pending migrations) are reported and allowed through.
// `cb health` exits non-zero precisely when it has something to say, so a throwing
// call would hide the output we came for.
let health = "";
try {
  health = execFileSync(join(MONO_ROOT, "callback-box", "bin", "cb"), ["health"], {
    cwd: content,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  health = isRecord(e) && typeof e["stdout"] === "string" ? e["stdout"] : "";
  if (health === "") fail(`could not read box health: ${errorMessage(e)}`);
}
const blockers = health.split("\n").filter((l) => l.trimStart().startsWith("✗"));
const warnings = health.split("\n").filter((l) => l.trimStart().startsWith("!"));
if (blockers.length > 0) {
  console.error("\nthis box fails its own health check — a walk on it would measure the fixture:\n");
  for (const b of blockers) console.error(b);
  fail("\nfix provisioning before walking.");
}
if (warnings.length > 0) {
  console.log(`${warnings.length} health warning(s), not blocking:`);
  for (const w of warnings.slice(0, 4)) console.log(w);
  console.log("");
}

// --- the before-snapshot --------------------------------------------------------
const head = execFileSync("git", ["-C", boxDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
writeFileSync(join(runDir, "before.json"), `${JSON.stringify({
  journey: journey.id,
  startedIso: new Date().toISOString(),
  box: boxDir,
  url: `http://localhost:3210/${WORKTREE}/${journey.box.slug}/`,
  headBefore: head,
}, null, 2)}\n`);

console.log(`box      ${boxDir}`);
console.log(`url      http://localhost:3210/${WORKTREE}/${journey.box.slug}/`);
console.log(`assets   ${assets.length}`);
console.log(`run      ${runDir}`);
console.log(`prompt   ${join(runDir, "prompt.md")}`);
console.log("\nHand that prompt to an agent with browser access. Then:");
console.log(`  pnpm exec tsx callback-box/user-stories/journeys/collect.ts ${basename(runDir)}`);
