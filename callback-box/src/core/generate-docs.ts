/**
 * Generate agent documentation for a callback box.
 *
 * Produces two categories of docs:
 * 1. `.callback-box/agent-guide.md` — compact, always-loaded via @-include in CLAUDE.md
 * 2. `docs/generated/*.md` — detailed reference docs, read on demand by agents
 *
 * Called by `cb init` and at the start of `cb reactor`.
 */

import { join } from "node:path";
import { execFile } from "node:child_process";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
import { generateViewsDoc } from "./views-doc.js";
import { generateChatVoiceDoc } from "./chat-voice-doc.js";
import { generateNarrationModeDoc } from "./narration-mode-doc.js";
import { generatePythonToolsDoc } from "./python-tools-doc.js";
import { generateAgentGuide } from "./agent-guide/index.js";
import { CONTAINS_DOC_APPENDIX } from "./agent-guide/search.js";
import {
  installProcedures,
  installGuides,
  installPersonality,
  installBriefing,
  installSchedules,
} from "./box.js";
import { installSchemasGuide } from "./box-templates.js";
import { pruneStaleTemplateUpdates } from "./install-template-file.js";
import { generateRules } from "./init-rules.js";
import { installValidationHooks } from "./install-validation-hooks.js";
import { isRepo, hasCommits, getStatus, stageFiles, commitPaths } from "../cli/lib/git.js";
import { AGENT_GUIDE_DIR, AGENT_GUIDE_FILE, DOCS_DIR, withDocId } from "./generate-docs-shared.js";
import { generateCbCommands } from "./generate-docs-cb-commands.js";
import { generateCardDoc, generateConnectorsDocs } from "./generate-docs-content.js";
import { generateProcedureGuide } from "./generate-docs-procedure-guide.js";
import {
  scanProcedures,
  compileBriefings,
  compileGuides,
  compilePersonalities,
} from "./generate-docs-compile.js";
import type { ProcedureSummary } from "./generate-docs-compile.js";
import { ensureClaudeMdIncludes } from "./generate-docs-claude-md.js";

export type { ProcedureSummary, GuideSummary } from "./generate-docs-compile.js";

const execFileAsync = promisify(execFile);

/**
 * Diagnostic marker — constructed (never thrown) only to capture a stack
 * trace when generateDocs is mistakenly called against the callback-box
 * source repo instead of a box. See the DIAG block in generateDocs().
 */
class GenerateDocsAgainstSourceError extends Error {
  constructor() {
    super("generateDocs called against the callback-box repo");
    this.name = "GenerateDocsAgainstSourceError";
  }
}

const GENERATE_MARKER = ".callback-box/docs-generated-at";

const DOCID_DEBUG_MARKER = ".callback-box/docid-debug";

/**
 * Get the current git commit hash of the callback-box repo.
 * Returns null if git is unavailable or this isn't a git repo.
 */
async function getCallbackBoxCommit(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: PACKAGE_ROOT,
    });
    return stdout.trim();
  } catch (e) {
    console.warn("[generate-docs] git rev-parse HEAD failed; treating commit as unknown:", e);
    return null;
  }
}

export interface GenerateDocsOptions {
  /** Add DOCID markers to each generated file for debugging prompt inclusion.
   *  If not specified, checks for a `.callback-box/docid-debug` marker file. */
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
      const { unlink } = await import("node:fs/promises");
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
  await checkDir(join(boxRoot, "config"), /\.(guide|personality)\.card$/);
  await checkDir(join(boxRoot, "config/procedures"), /\.procedure\.card$/);
  await checkDir(join(boxRoot, "config/schemas"), /\.ts$/);

  // Briefing cards (root + any subdirectory)
  await check(join(boxRoot, "briefing.briefing.card"));

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
  const chatRoot = join(boxRoot, "store/chat");
  let connectors: string[];
  try {
    connectors = await readdir(chatRoot);
  } catch (_e) {
    // No store/chat directory — box has no chats yet. Expected; nothing to report.
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
 * Paths that the `install*` and `generateRules` helpers own. Used by
 * `syncTemplatesFromSource` to commit just their output without sweeping
 * up user work in progress. Glob-style globs avoided: simple regex over
 * relative paths is enough for what we generate.
 */
const TEMPLATE_MANAGED_PATTERNS: readonly RegExp[] = [
  /^config\/procedures\/.+\.(?:procedure|orig-procedure)\.card$/,
  /^config\/schedules\/.+\.(?:scheduled-script|orig-scheduled-script)\.card$/,
  /^config\/.+\.(?:guide|orig-guide)\.card$/,
  /^config\/.+\.(?:personality|orig-personality)\.card$/,
  /^config\/_template-updates\/.+$/,
  /^config\/schemas\/CLAUDE\.md$/,
  /^briefing\.(?:briefing|orig-briefing)\.card$/,
  /^briefing\.md$/,
  /^\.claude\/rules\/.+\.md$/,
  /^\.claude\/settings\.json$/,
];

function isTemplateManagedPath(relPath: string): boolean {
  return TEMPLATE_MANAGED_PATTERNS.some((re) => re.test(relPath));
}

/**
 * Re-install upstream templates (procedures, guides, schedules, personality,
 * briefing, card rules) into the box. Each install* helper is idempotent and
 * only writes when the upstream template differs from the box's copy. Runs
 * inside generateDocs's cache-invalidated path, so it fires when the
 * callback-box source has changed (typically right after a deploy) and is a
 * no-op otherwise.
 *
 * Any tracked-file changes the helpers leave behind get committed in a
 * single surgical commit so the box's working tree doesn't accumulate drift
 * on hosts that don't routinely run `cb tick` (which would otherwise sweep
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
  // just on an explicit `cb init`). Tracker-based, so user-edited guides are
  // parked, not clobbered.
  await installSchemasGuide(boxRoot);
  await generateRules(boxRoot);
  await installValidationHooks(boxRoot);
  await pruneStaleTemplateUpdates(boxRoot);

  await commitTemplateSyncChanges(boxRoot);
}

/**
 * Commit any template-managed paths the install/generateRules helpers
 * dirtied, leaving user work in progress (in other paths) alone.
 */
async function commitTemplateSyncChanges(boxRoot: string): Promise<void> {
  if (!(await isRepo(boxRoot))) return;
  if (!(await hasCommits(boxRoot))) return;

  const status = await getStatus(boxRoot);
  const candidates = [
    ...status.staged,
    ...status.modified,
    ...status.untracked,
  ];
  const toCommit = candidates.filter(isTemplateManagedPath);
  if (toCommit.length === 0) return;

  // Stage explicitly so untracked files are picked up by `commit -- <paths>`.
  await stageFiles(boxRoot, toCommit);
  await commitPaths(boxRoot, {
    paths: toCommit,
    message: "Sync templates from upstream",
    trailers: { "Triggered-By": "generateDocs" },
  });
}

/**
 * Decide whether doc generation can be skipped because nothing changed.
 * Returns true only when the input mtimes and source commit both match the
 * marker written by the previous run. Always false when force is set.
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
  personalitySection: string | undefined;
}

/**
 * Write the agent guide plus all static reference docs (cb commands,
 * connectors, views, voice, per-card-type, etc.) in parallel.
 */
async function writeStaticDocs(plan: DocWritePlan): Promise<void> {
  const { boxRoot, debug, procedures, allCardSchemas, personalitySection } = plan;
  await Promise.all([
    writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
      withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allCardSchemas, personalitySection }), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "cb-commands.md"),
      withDocId({ relativePath: `${DOCS_DIR}/cb-commands.md`, content: generateCbCommands(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "connectors.md"),
      withDocId({ relativePath: `${DOCS_DIR}/connectors.md`, content: generateConnectorsDocs(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "views.md"),
      withDocId({ relativePath: `${DOCS_DIR}/views.md`, content: generateViewsDoc(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "chat-voice.md"),
      withDocId({ relativePath: `${DOCS_DIR}/chat-voice.md`, content: generateChatVoiceDoc(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "narration-mode.md"),
      withDocId({ relativePath: `${DOCS_DIR}/narration-mode.md`, content: generateNarrationModeDoc(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "procedures.md"),
      withDocId({ relativePath: `${DOCS_DIR}/procedures.md`, content: generateProcedureGuide(), debug })),
    writeFile(join(boxRoot, DOCS_DIR, "python-tools.md"),
      withDocId({ relativePath: `${DOCS_DIR}/python-tools.md`, content: generatePythonToolsDoc(), debug })),
    // Per-schema generated docs: each frontmatter schema with an optional
    // `instructions` field gets a `card-<type>.md` doc.
    ...writeCardDocs({ boxRoot, debug, allCardSchemas }),
  ]);
}

/**
 * Build the per-schema card-doc writes for every frontmatter schema that
 * supplies `instructions`.
 */
function writeCardDocs(params: {
  boxRoot: string;
  debug: boolean;
  allCardSchemas: typeof cardSchemas;
}): Array<Promise<void>> {
  const { boxRoot, debug, allCardSchemas } = params;
  return [
    ...allCardSchemas.map((s) => ({
      name: s.type,
      // Searchable types get the canonical contains: writing rule appended.
      instructions:
        s.instructions !== undefined && s.searchable
          ? `${s.instructions}\n\n${CONTAINS_DOC_APPENDIX}`
          : s.instructions,
    })),
  ]
    .filter((s): s is { name: string; instructions: string } => s.instructions !== undefined)
    .map((s) => {
      const filename = `card-${s.name}.md`;
      return writeFile(join(boxRoot, DOCS_DIR, filename),
        withDocId({ relativePath: `${DOCS_DIR}/${filename}`, content: generateCardDoc(s.name, s.instructions), debug }));
    });
}

/**
 * Generate all agent documentation for a box.
 */
export async function generateDocs(boxRoot: string, options?: GenerateDocsOptions): Promise<void> {
  options = options ?? {};
  // TEMPORARY — diagnose unexpected writes to the callback-box source repo
  // (`.callback-box/` and `docs/generated/` showing up here as untracked).
  // Remove once the caller is identified.
  if (boxRoot.endsWith("/callback/callback-box") || boxRoot.endsWith("/src/callback/callback-box")) {
    console.warn(`[generateDocs:DIAG] called with boxRoot=${boxRoot}`);
    console.warn(new GenerateDocsAgainstSourceError().stack);
  }

  // Fast path: skip if no input files changed and source code unchanged.
  // Skipped entirely when force is set — see GenerateDocsOptions.force for why.
  const markerPath = join(boxRoot, GENERATE_MARKER);
  const inputMtime = await newestInputMtime(boxRoot);
  const currentCommit = await getCallbackBoxCommit();
  if (await canSkipGeneration({ markerPath, inputMtime, currentCommit, force: options.force ?? false })) {
    return; // Nothing changed — skip regeneration
  }

  // Sync templates from upstream callback-box source. Idempotent — only
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
  const allCardSchemas = [...cardSchemas, ...boxSchemas.cardSchemas];

  // Compile personality first so we can include it in the agent guide
  const personalitySection = await compilePersonalities(boxRoot, debug);

  await writeStaticDocs({ boxRoot, debug, procedures, allCardSchemas, personalitySection });

  // Compile guides and generate job-type rules
  const guides = await compileGuides(boxRoot, debug);

  // Rewrite agent guide now that we have guide summaries
  await writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
    withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allCardSchemas, personalitySection, guides }), debug }));

  // Compile briefing cards to .md files
  const briefingPaths = await compileBriefings(boxRoot, debug);

  await ensureClaudeMdIncludes(boxRoot, briefingPaths);

  // Write marker so next call can skip if nothing changed
  const commitLine = currentCommit ? `\n${currentCommit}` : "";
  await writeFile(markerPath, new Date().toISOString() + commitLine);
}
