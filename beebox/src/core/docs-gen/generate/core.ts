/**
 * Generate agent documentation for a Bee Box.
 *
 * Produces two categories of docs in the box:
 * 1. `.beebox/agent-guide.md` — compact, always-loaded via @-include in AGENTS.md
 * 2. `_content/docs/generated/*.md` — docs compiled from THIS box's content
 *    (guides, personality, box-local card types), read on demand by agents
 *
 * The reference docs about beebox itself (card types, `bbx` commands,
 * connectors, views, …) are NOT written into the box: they live in the
 * installed package (`package-docs.ts`, `ensurePackageDocs`), which this
 * module keeps current on every run.
 *
 * Called by `bbx engine init` and at the start of `bbx reactor`.
 */

import { join } from "node:path";
import { execFile } from "node:child_process";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { fileExists } from "../../../lib/file-exists.js";
import { promisify } from "node:util";
import { lstat, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { z } from "zod";
import { cardSchemas, loadBoxSchemas } from "../../../schemas.js";
import type { CardSchema } from "../../../exports/cards.js";
import { generateAgentGuide } from "../../agent-guide/guide/core.js";
import {
  installProcedures,
  installGuides,
  installPersonality,
  installBriefing,
  installSchedules,
} from "../../box/structure/core.js";
import { syncBoxGuidance } from "../../box/guidance-sync/core.js";
import { guidanceSurfaceFor } from "../../box/guidance-surfaces.js";
import { pruneStaleTemplateUpdates, isTemplateManagedPath } from "../../install-template-file.js";
import { installValidationHooks } from "../../install-validation-hooks.js";
import { getBoxShape, type BoxShape } from "../../../lib/box-shape.js";
import { getBoxDir } from "../../../lib/paths/core.js";
import { isRepo, hasCommits, getStatus, stageFiles, commitPaths, withBoxGitLock } from "../../../lib/git/core/operations.js";
import { AGENT_GUIDE_DIR, AGENT_GUIDE_FILE, DOCS_DIR, withDocId } from "../shared.js";
import { getTemplatesOwnedBy, type TemplateDefinition } from "../../../templates-registry.js";
import { ensureEngineDocs, writeBoxCardDocs } from "../box-docs.js";
import {
  scanProcedures,
  compileBriefings,
  compileGuides,
  compilePersonalities,
} from "../compile/core.js";
import type { ProcedureSummary } from "../compile/core.js";
import { ensureAgentContext } from "./agents-md.js";
import { AGENTS_MD, instructionFileName } from "../../agent-instruction-files.js";

export type { ProcedureSummary } from "../compile/core.js";
export type { GuideSummary } from "../config-cards/core.js";

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
  /** Let the maintenance controller commit only measured output paths. */
  commit?: boolean | undefined;
  /** Bypass the input-mtime / source-commit cache and regenerate everything.
   *  Use during dev when source has uncommitted changes that affect output,
   *  or in test infrastructure where stale docs would invalidate results. */
  force?: boolean | undefined;
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
 * It does not commit: `generateDocs` writes more tracked output after it
 * (guides, the briefing, agent mirrors) and commits all of
 * it once at the end.
 */
async function syncTemplatesFromSource(boxRoot: string): Promise<void> {
  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installPersonality(boxRoot);
  await installBriefing(boxRoot);
  await installSchedules(boxRoot);
  // Every guidance surface the registry walks: the tracked nested guides, the
  // card rules, and the managed skills. `initBox` runs the same walk, so a
  // surface added to `GUIDANCE_SURFACES` reaches new and existing boxes alike.
  await syncBoxGuidance(boxRoot, { generators: true });
  await installValidationHooks(boxRoot);
  await pruneStaleTemplateUpdates(boxRoot);
}

/**
 * Commit any template-managed paths one `generateDocs` run dirtied (the
 * template sync and the tracked output written after it), leaving user work in
 * progress (in other paths) alone. One commit, so a box's working tree doesn't
 * accumulate drift on hosts that don't routinely run `bbx tick` (which would
 * otherwise sweep the changes via its post-script housekeeping commit).
 *
 * shapeVersion 3 has one root, so `boxRoot` IS the repo root and every
 * git-status path `getStatus`/`stageFiles`/`commitPaths` report or accept is
 * already box-root-relative — no prefix normalization needed.
 *
 * `keepUncommitted` names paths that were already dirty before the run
 * started (see {@link uncommittedPaths}). Template-managed patterns also match
 * hand-authored files such as `.claude/rules/<name>.md`, so without it a
 * boxholder's unfinished edit there would ride along in this commit. A
 * pre-existing dirty path that generation also rewrote stays uncommitted too;
 * the next housekeeping commit picks it up.
 *
 * Exported (rather than only reachable through `generateDocs`) so doctests
 * can exercise the sync commit directly against a minimal fixture, without
 * also going through `installValidationHooks` + a real, executable
 * `.git/hooks/pre-commit` that shells out to a `bbx` binary — an unrelated
 * hazard in a repo-in-a-repo dev/test environment.
 */
export async function commitTemplateSyncChanges(
  boxRoot: string,
  options?: { keepUncommitted?: ReadonlySet<string> },
): Promise<void> {
  const keep = options?.keepUncommitted ?? new Set<string>();
  const shape = await getBoxShape(boxRoot);
  const { boxRoot: repoRoot } = shape;
  if (!(await isRepo(repoRoot))) return;
  if (!(await hasCommits(repoRoot))) return;

  await withBoxGitLock(repoRoot, async () => {
    const status = await getStatus(repoRoot);
    const candidates = [...status.staged, ...status.modified, ...status.untracked];
    const managed = candidates.filter((p) => isTemplateManagedPath(p) && !keep.has(p));
    const authored = await Promise.all(managed.map((p) => isAuthoredAgentsMd(repoRoot, p)));
    const toCommit = managed.filter((_p, i) => authored[i] !== true);
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
 * A regular-file `AGENTS.md` is the box's own instruction file, not mirror
 * output. The `**\/AGENTS.md` mirror row still matches it until the legacy
 * mirror is retired, so the template commit must not sweep it up. The tracked
 * guides (`src/schemas/AGENTS.md` and the rest) are engine-installed output and
 * stay in the commit.
 */
async function isAuthoredAgentsMd(repoRoot: string, relPath: string): Promise<boolean> {
  if (relPath !== AGENTS_MD && !relPath.endsWith(`/${AGENTS_MD}`)) return false;
  if (guidanceSurfaceFor(relPath)?.class === "tracked") return false;
  try {
    return (await lstat(join(repoRoot, relPath))).isFile();
  } catch (_e) {
    // Deleted or unreadable: a removed mirror symlink, which the commit owns.
    return false;
  }
}

/**
 * Every path `git status` reports as staged, modified, or untracked; empty
 * when the box is not a repository with commits. Read before generation writes
 * anything, so the final commit can leave these paths alone.
 */
async function uncommittedPaths(boxRoot: string): Promise<ReadonlySet<string>> {
  if (!(await isRepo(boxRoot)) || !(await hasCommits(boxRoot))) return new Set();
  const status = await getStatus(boxRoot);
  return new Set([...status.staged, ...status.modified, ...status.untracked]);
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
  procedures: ProcedureSummary[];
  allCardSchemas: CardSchema[];
  boxCardSchemas: CardSchema[];
  boxTemplates: TemplateDefinition[];
  engineSourcePresent: boolean;
  personalitySection: string | undefined;
  shape: BoxShape;
  instructionFile: string;
}

/**
 * Write the agent guide and the box-local card docs (which first clear out any
 * engine docs an older engine left in the box's docs dir — they live in the
 * package now, `package-docs.ts`).
 */
async function writeStaticDocs(plan: DocWritePlan): Promise<void> {
  const { boxRoot, procedures, allCardSchemas, boxCardSchemas, boxTemplates, engineSourcePresent, personalitySection, shape, instructionFile } = plan;
  await Promise.all([
    writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
      withDocId({
        relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`,
        content: generateAgentGuide({ procedures, allCardSchemas, boxCardSchemas, boxTemplates, engineSourcePresent, personalitySection, shape, instructionFile }),
      })),
    writeBoxCardDocs({ boxRoot, boxCardSchemas, boxTemplates }),
  ]);
}

/** Read-only cache check before taking a maintenance recovery snapshot. */
export async function generatedDocsAreCurrent(boxRoot: string): Promise<boolean> {
  return canSkipGeneration({ markerPath: join(boxRoot, GENERATE_MARKER), inputMtime: await newestInputMtime(boxRoot), currentCommit: await getBeeBoxVersion(), force: false });
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

  // Read before the first write: what is dirty now is the boxholder's work.
  const shouldCommit = options.commit !== false;
  const dirtyBefore = shouldCommit ? await uncommittedPaths(boxRoot) : new Set<string>();

  // Sync templates from upstream beebox source. Idempotent — only
  // writes files where the box's copy differs (and emits .orig-*.card
  // entries when the user modified a template). Runs before doc generation
  // so newly-installed procedures are picked up by scanProcedures().
  await syncTemplatesFromSource(boxRoot);

  await mkdir(join(boxRoot, AGENT_GUIDE_DIR), { recursive: true });
  await mkdir(join(boxRoot, DOCS_DIR), { recursive: true });

  const procedures = await scanProcedures(boxRoot);

  // Load box-local frontmatter schemas alongside built-in ones.
  const boxSchemas = await loadBoxSchemas(boxRoot);
  const boxCardSchemas = boxSchemas.cardSchemas;
  const allCardSchemas = [...cardSchemas.list, ...boxCardSchemas];
  // loadBoxSchemas registered this box's `template` exports under its root.
  const boxTemplates = getTemplatesOwnedBy(boxRoot);
  const engineSourcePresent = await fileExists(join(PACKAGE_ROOT, "src", "cli", "index.ts"));

  // Decides the paths the agent guide's BOX_CODE table names — see
  // "boxCodeRows" in agent-guide/box-shape.ts.
  const shape = await getBoxShape(boxRoot);
  // The instruction-file name the guide's text uses: `AGENTS.md` once the box
  // is converted, `CLAUDE.md` before.
  const instructionFile = await instructionFileName(boxRoot);

  // Compile personality first so we can include it in the agent guide
  const personalitySection = await compilePersonalities(boxRoot);

  await writeStaticDocs({ boxRoot, procedures, allCardSchemas, boxCardSchemas, boxTemplates, engineSourcePresent, personalitySection, shape, instructionFile });

  // Compile guides and generate job-type rules
  const guides = await compileGuides(boxRoot);

  // Rewrite agent guide now that we have guide summaries
  await writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
    withDocId({
      relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`,
      content: generateAgentGuide({ procedures, allCardSchemas, boxCardSchemas, boxTemplates, engineSourcePresent, personalitySection, guides, shape, instructionFile }),
    }));

  // Compile briefing cards to .md files
  const briefingPaths = await compileBriefings(boxRoot);

  await ensureAgentContext(boxRoot, briefingPaths);

  // Every tracked output above lands in one commit, after the last writer.
  if (shouldCommit) await commitTemplateSyncChanges(boxRoot, { keepUncommitted: dirtyBefore });

  // Write marker so next call can skip if nothing changed
  const commitLine = currentCommit ? `\n${currentCommit}` : "";
  await writeFile(markerPath, new Date().toISOString() + commitLine);
}
