/**
 * Generate agent documentation for a Bee Box.
 *
 * Produces two categories of docs in the box:
 * 1. `.beebox/agent-guide.md` — compact, always-loaded via @-include in CLAUDE.md
 * 2. `_content/docs/generated/*.md` — docs compiled from THIS box's content
 *    (guides, personality, box-local card types), read on demand by agents
 *
 * The reference docs about beebox itself (card types, `bbx` commands,
 * connectors, views, …) are NOT written into the box: they live in the
 * installed package (`package-docs.ts`, `ensurePackageDocs`), which this
 * module keeps current on every run.
 *
 * Called by `bbx init` and at the start of `bbx reactor`.
 */

import { join } from "node:path";
import { execFile } from "node:child_process";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { fileExists } from "../../lib/file-exists.js";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, readdir, unlink, stat } from "node:fs/promises";
import { z } from "zod";
import { cardSchemas, loadBoxSchemas } from "../../schemas/registry.js";
import { generateAgentGuide } from "../agent-guide/index.js";
import {
  installProcedures,
  installGuides,
  installPersonality,
  installBriefing,
  installSchedules,
} from "../box/index.js";
import { installSchemasGuide, installViewsGuide } from "../box/templates.js";
import { pruneStaleTemplateUpdates, isTemplateManagedPath } from "../install-template-file.js";
import { generateRules } from "../init-rules.js";
import { generateSkills } from "../box/skills.js";
import { installValidationHooks } from "../install-validation-hooks.js";
import { getBoxShape, type BoxShape } from "../../lib/box-shape.js";
import { getBoxDir } from "../../lib/paths.js";
import { isRepo, hasCommits, getStatus, stageFiles, commitPaths, withBoxGitLock } from "../../lib/git.js";
import { AGENT_GUIDE_DIR, AGENT_GUIDE_FILE, DOCS_DIR, withDocId } from "./shared.js";
import { getTemplatesOwnedBy, type TemplateDefinition } from "../../schemas/templates.js";
import { ensureEngineDocs, pruneEngineDocs, writeBoxCardDocs } from "./box-docs.js";
import {
  scanProcedures,
  compileBriefings,
  compileGuides,
  compilePersonalities,
} from "./compile.js";
import type { ProcedureSummary } from "./compile.js";
import { compileExpositionRules } from "../compile-exposition-rules.js";
import { ensureAgentContext } from "./claude-md.js";

export type { ProcedureSummary, GuideSummary } from "./compile.js";

const execFileAsync = promisify(execFile);

/**
 * Diagnostic marker — constructed (never thrown) only to capture a stack
 * trace when generateDocs is mistakenly called against the beebox
 * source repo instead of a box. See the DIAG block in generateDocs().
 */
class GenerateDocsAgainstSourceError extends Error {
  constructor() {
    super("generateDocs called against the beebox repo");
    this.name = "GenerateDocsAgainstSourceError";
  }
}

const DeployInfoSchema = z.object({
  commits: z.record(z.string(), z.object({ hash: z.string().optional() })).optional(),
});

/**
 * Box-relative path of the doc-generation cache marker: an ISO timestamp plus
 * the engine version signal the run was made against. Exported for
 * `docs-refresh.ts`, which reads it before and after a run to tell "the cache
 * was current" from "docs were regenerated".
 */
export const GENERATE_MARKER = ".beebox/docs-generated-at";

const DOCID_DEBUG_MARKER = ".beebox/docid-debug";

/**
 * Version signal for the running beebox code, used to invalidate the
 * doc-generation cache (the `.beebox/docs-generated-at` marker). It
 * combines two sources so it advances whenever the *executing* code changes, in
 * every environment — if either moves, the combined string flips and
 * regeneration fires; a stale component never pins it:
 *
 *  - **deploy stamp** (prod): `deploy-info.json` at PACKAGE_ROOT carries the
 *    build's commit hash. Prod runs the bundled `dist/cli.mjs`, and the deploy
 *    does NOT advance the server's source git HEAD — so the deploy hash is the
 *    ONLY thing that moves per deploy. Keying solely on git HEAD (the old bug)
 *    meant generated docs never refreshed on existing boxes after a deploy.
 *  - **source git HEAD** (dev): no `deploy-info.json` when running from source
 *    via tsx, so git HEAD is the running code and advances per commit.
 *
 * Returns null only when neither is available.
 */
async function getBeeBoxVersion(): Promise<string | null> {
  const parts: string[] = [];
  try {
    const raw = await readFile(join(PACKAGE_ROOT, "deploy-info.json"), "utf-8");
    // Parse boundary: deploy-info.json is written by deploy.sh, untyped here.
    const info = DeployInfoSchema.parse(JSON.parse(raw));
    const hash = info.commits?.["beebox"]?.hash;
    if (typeof hash === "string" && hash !== "") parts.push(`deploy:${hash}`);
  } catch (_e) {
    // No deploy-info.json (dev) or unreadable — fall through to git HEAD.
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: PACKAGE_ROOT });
    parts.push(`git:${stdout.trim()}`);
  } catch (_e) {
    // Not a git repo / git unavailable — the deploy stamp alone may still pin it.
  }
  if (parts.length === 0) {
    console.warn("[generate-docs] no deploy stamp and git rev-parse failed; treating version as unknown");
    return null;
  }
  return parts.join("|");
}

export interface GenerateDocsOptions {
  /** Add DOCID markers to each generated file for debugging prompt inclusion.
   *  If not specified, checks for a `.beebox/docid-debug` marker file. */
  docIdDebug?: boolean | undefined;
  /** Bypass the input-mtime / source-commit cache and regenerate everything.
   *  Use during dev when source has uncommitted changes that affect output,
   *  or in test infrastructure where stale docs would invalidate results. */
  force?: boolean | undefined;
}

/**
 * Check if the docid-debug marker file exists in the box.
 */
async function hasDocIdMarker(boxRoot: string): Promise<boolean> {
  try {
    await stat(join(boxRoot, DOCID_DEBUG_MARKER));
    return true;
  } catch (_e) {
    // stat throws ENOENT when the marker is absent — that simply means
    // docid-debug is off. No other failure mode is actionable here.
    return false;
  }
}

/**
 * Set or clear the docid-debug marker file.
 */
export async function setDocIdDebug(boxRoot: string, enabled: boolean): Promise<void> {
  const markerPath = join(boxRoot, DOCID_DEBUG_MARKER);
  if (enabled) {
    await mkdir(join(boxRoot, AGENT_GUIDE_DIR), { recursive: true });
    await writeFile(markerPath, "");
  } else {
    try {
      await unlink(markerPath);
    } catch (_e) {
      // Already gone — disabling an absent marker is a no-op, nothing to report.
    }
  }
}

/**
 * Collect mtimes of all input files that affect doc generation.
 * Returns the newest mtime found, or 0 if no inputs exist.
 */
async function newestInputMtime(boxRoot: string): Promise<number> {
  let newest = 0;

  const check = async (filePath: string) => {
    try {
      const s = await stat(filePath);
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    } catch (_e) {
      // Optional input file absent — it simply doesn't contribute an mtime.
      // These probes run over many maybe-present paths; logging each miss is noise.
    }
  };

  const checkDir = async (dirPath: string, pattern: RegExp) => {
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch (_e) {
      // Optional input directory absent — contributes no mtimes. Probed over
      // many maybe-present dirs, so logging each miss would be noise.
      return;
    }
    for (const f of files) {
      if (pattern.test(f)) {
        await check(join(dirPath, f));
      }
    }
  };

  // Config-level inputs
  await checkDir(getBoxDir(boxRoot, "config"), /\.(guide|personality)\.card$/);
  await checkDir(getBoxDir(boxRoot, "procedures"), /\.procedure\.card$/);
  await checkDir(getBoxDir(boxRoot, "schemas"), /\.ts$/);

  // Briefing cards (root + any subdirectory)
  await check(join(boxRoot, "_content", "briefing.briefing.card"));

  // Person cards — a `boxholder: true` flag feeds the compiled personality's
  // boxholder identity line, so editing one must invalidate the doc cache.
  await checkDir(getBoxDir(boxRoot, "people"), /\.person\.card$/);

  // Per-chat guide cards
  await checkChatGuideMtimes(boxRoot, check);

  return newest;
}

/**
 * Fold the mtimes of every per-chat guide card into the running newest mtime.
 */
async function checkChatGuideMtimes(
  boxRoot: string,
  check: (filePath: string) => Promise<void>
): Promise<void> {
  const chatRoot = getBoxDir(boxRoot, "chat");
  let connectors: string[];
  try {
    connectors = await readdir(chatRoot);
  } catch (_e) {
    // No _content/chat directory — box has no chats yet. Expected; nothing to report.
    return;
  }

  for (const connector of connectors) {
    const connectorDir = join(chatRoot, connector);
    let slugs: string[];
    try {
      slugs = await readdir(connectorDir);
    } catch (_e) {
      // Not a readable connector dir — no chat guides under it to date.
      // Part of the mtime probe; logging each miss would be noise.
      continue;
    }
    for (const slug of slugs) {
      await check(join(connectorDir, slug, "chat.guide.card"));
    }
  }
}

/**
 * Re-install upstream templates (procedures, guides, schedules, personality,
 * briefing, card rules, managed box skills) into the box. Each install* helper is idempotent and
 * only writes when the upstream template differs from the box's copy. Runs
 * inside generateDocs's cache-invalidated path, so it fires when the
 * beebox source has changed (typically right after a deploy) and is a
 * no-op otherwise.
 *
 * Any tracked-file changes the helpers leave behind get committed in a
 * single surgical commit so the box's working tree doesn't accumulate drift
 * on hosts that don't routinely run `bbx tick` (which would otherwise sweep
 * the changes via its post-script housekeeping commit).
 */
async function syncTemplatesFromSource(boxRoot: string): Promise<void> {
  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installPersonality(boxRoot);
  await installBriefing(boxRoot);
  await installSchedules(boxRoot);
  // Refresh the box-local schemas guide so boxes carrying the old XML-only
  // version pick up the frontmatter-first rewrite on the normal cycle (not
  // just on an explicit `bbx init`). Tracker-based, so user-edited guides are
  // parked, not clobbered.
  await installSchemasGuide(boxRoot);
  // Same tracker treatment for the views guide, so boxes carrying the old
  // standalone-view guide pick up the attach-to-cards rewrite on the normal
  // cycle (not just an explicit `bbx init`); user-edited guides are parked.
  await installViewsGuide(boxRoot);
  await generateRules(boxRoot);
  // Managed box skills refresh on the same path as the rules they mirror.
  // They used to be provisioned only by `bbx init`, so a box that never got a
  // manual re-init kept whatever skills shipped the day it was created; the
  // engine's own upgrades (a renamed card type in a skill body, say) never
  // reached it. Same cache gate as everything else here, so this is a no-op
  // between deploys.
  await generateSkills(boxRoot);
  await installValidationHooks(boxRoot);
  await pruneStaleTemplateUpdates(boxRoot);

  await commitTemplateSyncChanges(boxRoot);
}

/**
 * Commit any template-managed paths the install/generateRules helpers
 * dirtied, leaving user work in progress (in other paths) alone.
 *
 * shapeVersion 3 has one root, so `boxRoot` IS the repo root and every
 * git-status path `getStatus`/`stageFiles`/`commitPaths` report or accept is
 * already box-root-relative — no prefix normalization needed.
 *
 * Exported (rather than only reachable through `generateDocs`) so doctests
 * can exercise the sync commit directly against a minimal fixture, without
 * also going through `installValidationHooks` + a real, executable
 * `.git/hooks/pre-commit` that shells out to a `bbx` binary — an unrelated
 * hazard in a repo-in-a-repo dev/test environment.
 */
export async function commitTemplateSyncChanges(boxRoot: string): Promise<void> {
  const shape = await getBoxShape(boxRoot);
  const { boxRoot: repoRoot } = shape;
  if (!(await isRepo(repoRoot))) return;
  if (!(await hasCommits(repoRoot))) return;

  await withBoxGitLock(repoRoot, async () => {
    const status = await getStatus(repoRoot);
    const candidates = [...status.staged, ...status.modified, ...status.untracked];
    const toCommit = candidates.filter((p) => isTemplateManagedPath(p));
    if (toCommit.length === 0) return;

    // Stage explicitly so untracked files are picked up by `commit -- <paths>`.
    await stageFiles(repoRoot, toCommit);
    await commitPaths(repoRoot, {
      paths: toCommit,
      message: "Sync templates from upstream",
      trailers: { "Triggered-By": "generateDocs" },
    });
  });
}

/**
 * Decide whether doc generation can be skipped because nothing changed.
 * Returns true only when the input mtimes and the beebox version signal
 * (see getBeeBoxVersion — deploy stamp ‖ git HEAD) both match the marker
 * written by the previous run. Always false when force is set.
 */
async function canSkipGeneration(params: {
  markerPath: string;
  inputMtime: number;
  currentCommit: string | null;
  force: boolean;
}): Promise<boolean> {
  const { markerPath, inputMtime, currentCommit, force } = params;
  if (force) return false;
  try {
    const markerStat = await stat(markerPath);
    const markerContent = await readFile(markerPath, "utf-8");
    const storedCommit = markerContent.split("\n")[1] || null;
    const mtimeUnchanged = inputMtime > 0 && inputMtime <= markerStat.mtimeMs;
    const commitUnchanged = currentCommit !== null && storedCommit === currentCommit;
    return mtimeUnchanged && commitUnchanged;
  } catch (_e) {
    // No marker file — first run, generate everything.
    return false;
  }
}

interface DocWritePlan {
  boxRoot: string;
  debug: boolean;
  procedures: ProcedureSummary[];
  allCardSchemas: typeof cardSchemas;
  boxCardSchemas: typeof cardSchemas;
  boxTemplates: TemplateDefinition[];
  engineSourcePresent: boolean;
  personalitySection: string | undefined;
  shape: BoxShape;
}

/**
 * Write the agent guide and the box-local card docs, and clear out any engine
 * docs an older engine left in the box's docs dir (they live in the package
 * now — `package-docs.ts`).
 */
async function writeStaticDocs(plan: DocWritePlan): Promise<void> {
  const { boxRoot, debug, procedures, allCardSchemas, boxCardSchemas, boxTemplates, engineSourcePresent, personalitySection, shape } = plan;
  await Promise.all([
    writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
      withDocId({
        relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`,
        content: generateAgentGuide({ procedures, allCardSchemas, boxCardSchemas, boxTemplates, engineSourcePresent, personalitySection, shape }),
        debug,
      })),
    writeBoxCardDocs({ boxRoot, debug, boxCardSchemas }),
    pruneEngineDocs(boxRoot),
  ]);
}

/**
 * Generate all agent documentation for a box.
 */
export async function generateDocs(boxRoot: string, options?: GenerateDocsOptions): Promise<void> {
  options = options ?? {};
  // TEMPORARY — diagnose unexpected writes to the beebox source repo
  // (`.beebox/` and `_content/docs/generated/` showing up here as untracked).
  // Remove once the caller is identified.
  if (boxRoot.endsWith("/callback/beebox") || boxRoot.endsWith("/src/callback/beebox")) {
    console.warn(`[generateDocs:DIAG] called with boxRoot=${boxRoot}`);
    console.warn(new GenerateDocsAgainstSourceError().stack);
  }

  // The package's own reference docs come first and are not behind the box
  // cache: they depend on the engine alone, and a deleted or never-written
  // directory must heal on any activity, not only when this box's inputs move.
  await ensureEngineDocs();

  // Fast path: skip if no input files changed and source code unchanged.
  // Skipped entirely when force is set — see GenerateDocsOptions.force for why.
  const markerPath = join(boxRoot, GENERATE_MARKER);
  const inputMtime = await newestInputMtime(boxRoot);
  const currentCommit = await getBeeBoxVersion();
  if (await canSkipGeneration({ markerPath, inputMtime, currentCommit, force: options.force ?? false })) {
    return; // Nothing changed — skip regeneration
  }

  // Sync templates from upstream beebox source. Idempotent — only
  // writes files where the box's copy differs (and emits .orig-*.card
  // entries when the user modified a template). Runs before doc generation
  // so newly-installed procedures are picked up by scanProcedures().
  await syncTemplatesFromSource(boxRoot);

  const debug = options.docIdDebug ?? await hasDocIdMarker(boxRoot);

  await mkdir(join(boxRoot, AGENT_GUIDE_DIR), { recursive: true });
  await mkdir(join(boxRoot, DOCS_DIR), { recursive: true });

  const procedures = await scanProcedures(boxRoot);

  // Load box-local frontmatter schemas alongside built-in ones.
  const boxSchemas = await loadBoxSchemas(boxRoot);
  const boxCardSchemas = boxSchemas.cardSchemas;
  const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
  // loadBoxSchemas registered this box's `template` exports under its root.
  const boxTemplates = getTemplatesOwnedBy(boxRoot);
  const engineSourcePresent = await fileExists(join(PACKAGE_ROOT, "src", "cli", "index.ts"));

  // Determines whether the agent guide teaches the package-layout code
  // location rules — see "boxCodeLocationSection" in agent-guide/box-shape.ts.
  const shape = await getBoxShape(boxRoot);

  // Compile personality first so we can include it in the agent guide
  const personalitySection = await compilePersonalities(boxRoot, debug);

  await writeStaticDocs({ boxRoot, debug, procedures, allCardSchemas, boxCardSchemas, boxTemplates, engineSourcePresent, personalitySection, shape });

  // Compile guides and generate job-type rules
  const guides = await compileGuides(boxRoot, debug);

  // Compile each course's exposition-plan `rules` into a path-loaded box rule.
  await compileExpositionRules(boxRoot);

  // Rewrite agent guide now that we have guide summaries
  await writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
    withDocId({
      relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`,
      content: generateAgentGuide({ procedures, allCardSchemas, boxCardSchemas, boxTemplates, engineSourcePresent, personalitySection, guides, shape }),
      debug,
    }));

  // Compile briefing cards to .md files
  const briefingPaths = await compileBriefings(boxRoot, debug);

  await ensureAgentContext(boxRoot, briefingPaths);

  // Write marker so next call can skip if nothing changed
  const commitLine = currentCommit ? `\n${currentCommit}` : "";
  await writeFile(markerPath, new Date().toISOString() + commitLine);
}
