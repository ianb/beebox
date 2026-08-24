/**
 * Shared logic for installing template-managed files into a box.
 *
 * The bookkeeping problem this solves: callback-box ships templates
 * (procedures, guides, schedules, the personality seed, the root
 * landmark, the briefing). When a template changes upstream, we want to
 * push the new version into boxes — but only if the local copy hasn't
 * been customised. If it has, the new version goes into
 * `config/_template-updates/<path>` for the boxholder to review.
 *
 * "Has it been customised" is tracked via `config/template-versions.json`:
 * a hash of every template we have ever written cleanly. If the local
 * file's hash matches the last recorded hash, the user hasn't touched
 * it since we installed it — so it's safe to overwrite with the new
 * template. If the local file's hash diverges from the recorded one,
 * the user (or some agent) edited it, and we park the new version.
 *
 * For files with volatile content (timestamps regenerated each install
 * — guides, personality), pass a `normalize` function. Hashing the
 * normalized form makes "did the user edit it" comparison stable
 * across reinstalls that only differ in timestamp.
 *
 * For card templates with fields the box owns as per-box STATE rather than
 * definition (a schedule's `enabled` toggle), pass `boxOwnedFields`. Those keys
 * are stripped before the customised-or-not comparison — so a box that only
 * flipped `enabled` still reads as unmodified stock and takes definition
 * updates — and the box's own values for them are carried onto the written
 * template. See `TemplateMergePolicy` in `src/cards/schema.ts`, which is how a
 * schema declares them.
 *
 * **v2 (package-layout) boxes**: `relPath` is normally resolved against
 * `boxRoot` (the operational root, `content/` for a v2 box). Some templates a
 * v2 box owns live one level up, at the package root's `src/` (the schemas,
 * views, and tricks CLAUDE.md guides) — outside `boxRoot` entirely. Rather
 * than invent a second tracker section or a `packageRoot` option, a `relPath`
 * that starts with `../` is simply resolved the normal way: `path.join`
 * already walks it up to the package root (`content/../src/... ===
 * src/...`), and `git status` run from `boxRoot` already reports changes
 * there the same way (see the callers in `box-templates.ts`) — so this is the
 * least-magic option: no new path space, just letting relative-path
 * resolution do what it already does. The one place this needs help is the
 * parked-update mirror (`config/_template-updates/`), which must stay INSIDE
 * `boxRoot` (it's tracked box content) — see `mirrorRelPath` below, which
 * strips a leading `../` there only, since `content/` is always exactly one
 * level under the package root.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { renderFrontmatterBlock, splitCardContent } from "../cards/index.js";
import { errnoCode } from "../lib/error-guards.js";
import { isRecord } from "./card-io.js";

const VERSIONS_FILE = "config/template-versions.json";
const TEMPLATE_UPDATES_DIR = "config/_template-updates";

/**
 * Box-relative paths that callback-box owns as template output (the `install*`,
 * `generateRules`, and `generateSkills` helpers write them).
 * `syncTemplatesFromSource` uses this to commit just their output without
 * sweeping up unrelated user work. Simple regex over relative paths — no
 * globbing needed for what we generate.
 *
 * Deliberately matched by directory, not by managed-file name: a hand-authored
 * rule or skill sitting in `.claude/rules/` / `.claude/skills/` is committed
 * alongside ours rather than left dirty. That is the pre-existing convention
 * for `.claude/rules/`, and the alternative — importing the managed skill list
 * here — would drag the whole skill-content module into every consumer.
 */
const TEMPLATE_MANAGED_PATTERNS: readonly RegExp[] = [
  /^config\/procedures\/.+\.(?:procedure|orig-procedure)\.card$/,
  /^config\/schedules\/.+\.(?:scheduled-script|orig-scheduled-script)\.card$/,
  /^config\/.+\.(?:guide|orig-guide)\.card$/,
  /^config\/.+\.(?:personality|orig-personality)\.card$/,
  /^store\/plate\.todo-view\.card$/,
  /^config\/_template-updates\/.+$/,
  // The install tracker: installTemplateFile rewrites it when it records a
  // hash, so it commits with the template change instead of leaving dirt.
  /^config\/template-versions\.json$/,
  /^config\/schemas\/CLAUDE\.md$/,
  /^config\/cb-validate\.ignore$/,
  /^views\/CLAUDE\.md$/,
  // v2 (package-layout) equivalents of the two guides above — see the
  // "v2 (package-layout) boxes" note on `InstallTemplateOptions.relPath`.
  // These patterns are written in `installTemplateFile`'s own relPath
  // convention (this file): normally boxRoot-relative, `../...` for the
  // package-root-level templates below. `isTemplateManagedPath`'s callers
  // see `git status` output relative to the *repo* root instead — for a v2
  // box that's the package root, not `boxRoot` (`content/`) — so
  // `commitTemplateSyncChanges` (generate-docs.ts) normalizes each
  // git-reported path into this same boxRoot-relative convention before
  // filtering. `cb upgrade`'s own commit step still stages everything (`git
  // add -A`) rather than relying on this selective list.
  /^\.\.\/src\/schemas\/CLAUDE\.md$/,
  /^\.\.\/src\/views\/CLAUDE\.md$/,
  /^\.\.\/src\/tricks\/scripts\/CLAUDE\.md$/,
  /^briefing\.(?:briefing|orig-briefing)\.card$/,
  /^briefing\.md$/,
  // `.claude/` lives at the box's PACKAGE root. For a legacy box that is
  // `boxRoot` itself; for a v2 box `commitTemplateSyncChanges` normalizes the
  // git-reported path to `../.claude/...` (it sits outside `content/`) — so
  // both forms have to match or a v2 box's regenerated rules/skills stay
  // uncommitted and leave the tree permanently dirty.
  /^(?:\.\.\/)?\.claude\/rules\/.+\.md$/,
  /^(?:\.\.\/)?\.claude\/settings\.json$/,
  // Managed box skills (`generateSkills`), including each skill's
  // supplementary files.
  /^(?:\.\.\/)?\.claude\/skills\/.+$/,
  /^\.\.\/AGENTS\.md$/,
  /^AGENTS\.md$/,
  /^.+\/AGENTS\.md$/,
  /^(?:\.\.\/)?\.agents\/skills\/.+$/,
  /^\.\.\/\.codex\/hooks\.json$/,
];

/** Whether `relPath` is callback-box template output (see {@link TEMPLATE_MANAGED_PATTERNS}). */
export function isTemplateManagedPath(relPath: string): boolean {
  return TEMPLATE_MANAGED_PATTERNS.some((re) => re.test(relPath));
}

const versionsFileSchema = z.record(
  z.string(),
  z.object({
    /** sha256 of the (normalized) template content as we last installed it. */
    sha256: z.string(),
    "installed-at": z.string(),
  }),
);
type VersionsFile = z.infer<typeof versionsFileSchema>;

export interface InstallTemplateOptions {
  /** Box root absolute path. */
  boxRoot: string;
  /** Path under boxRoot, e.g. `config/calendar.guide.card`. */
  relPath: string;
  /** New template content to install. */
  templateContent: string;
  /**
   * Optional normalizer for content with volatile fields (timestamps).
   * Both the local file and the template are normalized before hashing
   * so timestamp-only differences don't read as "user modified."
   */
  normalize?: (content: string) => string;
  /**
   * sha256 hashes (of the normalized content) of prior stock versions we
   * shipped before this file was tracked in template-versions.json. A local
   * file matching one of these is recognized as our own unmodified output and
   * overwritten with the new template — the bootstrap path for files that were
   * installed create-if-missing before adopting the tracker. A local file
   * matching none of them (and lacking a recorded hash) is treated as
   * user-edited and parked.
   *
   * These hashes are of the CANONICAL form — normalized and with any
   * {@link boxOwnedFields} stripped — so they still recognise a box that has
   * only toggled a box-owned field.
   */
  priorStockHashes?: string[];
  /**
   * Frontmatter keys the box owns as per-box state rather than template
   * definition (a schema's {@link TemplateMergePolicy.boxOwnedFields}; the
   * canonical case is a schedule's `enabled`). They are stripped before every
   * hash comparison — so a box copy that differs from stock ONLY in these keys
   * still reads as unmodified and takes the update — and the box's own values
   * for them are carried onto the template when it's written. Divergence in any
   * other key or the body still parks. Empty/omitted = strict whole-file match.
   */
  boxOwnedFields?: readonly string[];
}

export type InstallOutcome =
  | "fresh"               // file didn't exist; wrote template
  | "unchanged"           // local already matches template (modulo normalization); no write
  | "overwritten"         // local matched the last recorded version; safely overwrote
  | "parked"              // local diverged; new version sat in _template-updates/ for review
  | "skipped";            // file exists but template content also unchanged from last install

export interface InstallResult {
  outcome: InstallOutcome;
  /** Relative path that was written (the original relPath or the parked path). */
  writtenAt?: string;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Parse a card's frontmatter into an object + body, or null if it isn't a card. */
function parseCard(content: string): { fm: Record<string, unknown>; body: string } | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  const parsed: unknown = parseYaml(split.frontmatterText);
  if (!isRecord(parsed)) return null;
  return { fm: parsed, body: split.body };
}

function serializeCard(fm: Record<string, unknown>, body: string): string {
  return renderFrontmatterBlock(fm, body);
}

/**
 * Drop box-owned frontmatter keys for the divergence decision (hashing only,
 * never written). A box that has only toggled such a key thus hashes the same
 * as the stock it came from. No-ops when there are no owned fields or the
 * content isn't a card.
 */
function stripBoxOwnedFields(content: string, fields: readonly string[]): string {
  if (fields.length === 0) return content;
  const card = parseCard(content);
  if (card === null) return content;
  for (const f of fields) delete card.fm[f];
  // Always re-serialize (not only when a key was dropped) so both sides of a
  // comparison pass through identical YAML normalization — the box's copy and
  // the freshly-generated template then hash the same modulo owned fields,
  // regardless of incidental frontmatter formatting differences.
  return serializeCard(card.fm, card.body);
}

/**
 * Carry the box's values for box-owned keys onto the upstream template — so a
 * definition update is applied while the box keeps its own state (e.g. its
 * `enabled` toggle). A key absent from the box is removed from the result (the
 * box chose the template default). No-ops when there are no owned fields or
 * either side isn't a card.
 */
function applyBoxOwnedFields(
  { upstream, box }: { upstream: string; box: string },
  fields: readonly string[],
): string {
  if (fields.length === 0) return upstream;
  const up = parseCard(upstream);
  const bx = parseCard(box);
  if (up === null || bx === null) return upstream;
  let changed = false;
  for (const f of fields) {
    if (f in bx.fm) {
      if (!(f in up.fm) || !Object.is(up.fm[f], bx.fm[f])) changed = true;
      up.fm[f] = bx.fm[f];
    } else if (f in up.fm) {
      delete up.fm[f];
      changed = true;
    }
  }
  return changed ? serializeCard(up.fm, up.body) : upstream;
}

/**
 * Where a `relPath`'s parked mirror lives under `config/_template-updates/`.
 * Identical to `relPath` except a leading `../` (the packageRoot-relative
 * marker — see the "v2 (package-layout) boxes" note above) is stripped, so
 * the mirror always stays inside `boxRoot` instead of trying to escape
 * `config/_template-updates/` itself. Only one level is stripped —
 * `content/` is always exactly one level under the package root, so a
 * v2-owned template never needs more than one `../`.
 */
function mirrorRelPath(relPath: string): string {
  return relPath.startsWith("../") ? relPath.slice(3) : relPath;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Remove the parked mirror for `relPath` (if any) and sweep now-empty parent
 * dirs under `config/_template-updates/`. Called whenever the box's on-disk
 * copy converges to the current template (fresh / unchanged / overwritten):
 * the parked "update available" is then obsolete, and leaving it behind is
 * exactly what kept the drift count stuck above the real divergence. Silent
 * and idempotent — a missing mirror is the common case.
 */
async function removeParkedMirror(boxRoot: string, relPath: string): Promise<void> {
  const mirrorAbs = path.join(boxRoot, TEMPLATE_UPDATES_DIR, mirrorRelPath(relPath));
  try {
    await fs.unlink(mirrorAbs);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return;
    throw e;
  }
  // Sweep empty parents up to (but not including) the updates root.
  const rootAbs = path.join(boxRoot, TEMPLATE_UPDATES_DIR);
  let dir = path.dirname(mirrorAbs);
  while (dir.length > rootAbs.length && dir.startsWith(rootAbs)) {
    try {
      await fs.rmdir(dir);
    } catch (e) {
      const code = errnoCode(e);
      if (code === "ENOTEMPTY" || code === "ENOENT") break;
      throw e;
    }
    dir = path.dirname(dir);
  }
}

async function readVersions(boxRoot: string): Promise<VersionsFile> {
  const abs = path.join(boxRoot, VERSIONS_FILE);
  try {
    const text = await fs.readFile(abs, "utf-8");
    return versionsFileSchema.parse(JSON.parse(text));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return {};
    throw e;
  }
}

async function writeVersions(boxRoot: string, versions: VersionsFile): Promise<void> {
  const abs = path.join(boxRoot, VERSIONS_FILE);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  // Sorted keys for stable diffs.
  const sorted: VersionsFile = {};
  for (const [k, v] of Object.entries(versions).toSorted(([a], [b]) => a.localeCompare(b))) {
    sorted[k] = v;
  }
  await fs.writeFile(abs, JSON.stringify(sorted, null, 2) + "\n");
}

/**
 * Install one template file into a box. See module docstring.
 */
export async function installTemplateFile(opts: InstallTemplateOptions): Promise<InstallResult> {
  const { boxRoot, relPath, templateContent } = opts;
  const normalize = opts.normalize ?? ((s) => s);
  const boxOwnedFields = opts.boxOwnedFields ?? [];
  // Canonical form for every hash comparison: normalized (volatile fields out)
  // AND box-owned state stripped, so a box that only toggled an owned field
  // still hashes as the stock it came from. When neither applies this is just
  // the raw content, so existing callers are unaffected.
  const canonicalize = (content: string): string =>
    stripBoxOwnedFields(normalize(content), boxOwnedFields);
  const targetAbs = path.join(boxRoot, relPath);

  await fs.mkdir(path.dirname(targetAbs), { recursive: true });

  let localContent: string | null = null;
  try {
    localContent = await fs.readFile(targetAbs, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
  }

  const templateHash = sha256(canonicalize(templateContent));

  if (localContent === null) {
    await fs.writeFile(targetAbs, templateContent);
    const versions = await readVersions(boxRoot);
    versions[relPath] = { sha256: templateHash, "installed-at": new Date().toISOString() };
    await writeVersions(boxRoot, versions);
    await removeParkedMirror(boxRoot, relPath);
    return { outcome: "fresh", writtenAt: relPath };
  }

  const localHash = sha256(canonicalize(localContent));

  // Local is already what we'd write — no-op (avoids dirtying the working
  // tree on every install with no semantic change).
  if (localHash === templateHash) {
    // Record the hash even on no-op so a box installed at version V1 by
    // an older callback-box (before this tracker existed) gets bootstrapped.
    const versions = await readVersions(boxRoot);
    if (versions[relPath]?.sha256 !== templateHash) {
      versions[relPath] = { sha256: templateHash, "installed-at": new Date().toISOString() };
      await writeVersions(boxRoot, versions);
    }
    await removeParkedMirror(boxRoot, relPath);
    return { outcome: "unchanged" };
  }

  const versions = await readVersions(boxRoot);
  const lastInstalledHash = versions[relPath]?.sha256;
  const priorStockHashes = opts.priorStockHashes ?? [];

  // Local matches the version we last installed (or a known prior stock
  // version shipped before this file was tracked) → it's our own unmodified
  // output. Safe to overwrite with the new template.
  if (
    (lastInstalledHash !== undefined && lastInstalledHash === localHash)
    || priorStockHashes.includes(localHash)
  ) {
    // Write the new definition, but carry over any box-owned state (e.g. the
    // box's `enabled` toggle) so updating the schedule doesn't silently
    // re-enable/disable it. With no owned fields this is the template verbatim.
    const merged = applyBoxOwnedFields({ upstream: templateContent, box: localContent }, boxOwnedFields);
    await fs.writeFile(targetAbs, merged);
    versions[relPath] = { sha256: templateHash, "installed-at": new Date().toISOString() };
    await writeVersions(boxRoot, versions);
    await removeParkedMirror(boxRoot, relPath);
    return { outcome: "overwritten", writtenAt: relPath };
  }

  // Local differs from both the new template and our last-installed
  // record. Either the user edited it, or the file predates the
  // tracker. Park the new template under `_template-updates/` mirroring
  // the original relpath verbatim (e.g. `config/foo.guide.card` →
  // `config/_template-updates/config/foo.guide.card`) so the
  // copy-back-to-accept path is obvious. Don't update the recorded
  // hash — if the user later accepts the new template by copying it
  // into place, the next install will recognise it as the current
  // template and overwrite cleanly.
  const updateAbs = path.join(boxRoot, TEMPLATE_UPDATES_DIR, mirrorRelPath(relPath));
  await fs.mkdir(path.dirname(updateAbs), { recursive: true });
  // Park the new definition carrying the box's owned state, so copying the
  // mirror into place to accept keeps that state. With no owned fields this is
  // the template verbatim.
  await fs.writeFile(updateAbs, applyBoxOwnedFields({ upstream: templateContent, box: localContent }, boxOwnedFields));
  return { outcome: "parked", writtenAt: path.relative(boxRoot, updateAbs) };
}

/**
 * Default stale threshold for parked template updates: 30 days.
 *
 * Rationale: if the boxholder hasn't reviewed a parked template update in a
 * month, they're not going to. Either they actively want their version (in
 * which case the parked copy is noise) or they missed the prompt (in which
 * case it'll re-park on the next template change). Sweeping prevents
 * `config/_template-updates/` from accumulating cruft indefinitely.
 */
export const STALE_TEMPLATE_UPDATE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete parked template-update files under `config/_template-updates/` that are
 * either **stale** (mtime older than `maxAgeMs`, default 30 days) or **orphaned**
 * (no on-disk `<relpath>` for the mirror to update). Empty parent directories are
 * removed too. Returns the relative paths of removed files.
 *
 * The orphan case matters because a mirror is only ever parked when an on-disk
 * copy existed and diverged; if that copy is later deleted or renamed (e.g. a
 * relpath-scheme migration moves `procedures/X` → `config/procedures/X`), the
 * mirror points at nothing and is pure drift-count noise. `installTemplateFile`
 * clears mirrors for files that converge back to the template, but it never sees
 * a relpath that's no longer installed — this sweep is what reaps those.
 *
 * Idempotent and silent — safe to call from `syncTemplatesFromSource` every
 * cycle. Doesn't touch anything outside `config/_template-updates/`.
 */
export async function pruneStaleTemplateUpdates(
  boxRoot: string,
  options?: { maxAgeMs?: number; now?: number },
): Promise<string[]> {
  options = options ?? {};
  const maxAgeMs = options.maxAgeMs ?? STALE_TEMPLATE_UPDATE_MS;
  const now = options.now ?? Date.now();
  const rootAbs = path.join(boxRoot, TEMPLATE_UPDATES_DIR);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true, recursive: true });
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Node 20.12+: Dirent.parentPath is the directory containing the entry.
    const fileAbs = path.join(entry.parentPath, entry.name);
    const relPath = path.relative(rootAbs, fileAbs);
    const orphaned = !(await fileExists(path.join(boxRoot, relPath)));
    if (!orphaned) {
      const stat = await fs.stat(fileAbs);
      if (now - stat.mtimeMs < maxAgeMs) continue;
    }
    await fs.unlink(fileAbs);
    removed.push(path.relative(boxRoot, fileAbs));
  }

  // Sweep empty directories from deepest first so parents become empty too.
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(e.parentPath, e.name))
    .toSorted((a, b) => b.length - a.length);
  for (const dir of dirs) {
    try {
      await fs.rmdir(dir);
    } catch (e) {
      const code = errnoCode(e);
      // Not empty (still holds non-stale files) or already gone — both are
      // expected outcomes of best-effort sweeping, not errors to report.
      if (code === "ENOTEMPTY" || code === "ENOENT") continue;
      throw e;
    }
  }

  return removed;
}

/**
 * List the box-relative paths of template files that have a **parked** update —
 * i.e. a newer stock template sits in `config/_template-updates/<relpath>` while
 * a divergent copy remains in place. Returns the ORIGINAL relpaths (the parked
 * mirror's `<relpath>`, with the `config/_template-updates/` prefix stripped), so
 * a caller can say "these guides/procedures have an update waiting."
 *
 * This is the observable signal for template drift — a box that has diverged from
 * upstream stock (either boxholder-edited, or on a version whose hash isn't in the
 * template's `priorStockHashes`). Surfaced by `cb status` and `/healthz` so drift
 * is seen rather than discovered by SSHing into a server box.
 */
export async function listParkedTemplateUpdates(boxRoot: string): Promise<string[]> {
  const rootAbs = path.join(boxRoot, TEMPLATE_UPDATES_DIR);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true, recursive: true });
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const parked: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fileAbs = path.join(entry.parentPath, entry.name);
    // Strip the boxRoot + TEMPLATE_UPDATES_DIR prefix to recover the original relpath.
    parked.push(path.relative(rootAbs, fileAbs));
  }
  return parked.toSorted();
}
