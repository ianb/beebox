/**
 * `*.landmark.card`: give every `navigation.links[]` target inside the
 * landmark's own pruned subtree (`core/landmark/prominence-index.ts`,
 * `prunedSubtree`) an explicit `prominence: primary`, when the target has
 * none written yet — `docs/implemented-plans/card-prominence.md`, Track D. CLI entry
 * point and usage: `landmark-links-prominence-run.ts`.
 *
 * A landmark's list predates `prominence`. Without this, a curated link and
 * the field disagree: the target reads as `ordinary` (nothing shown by the
 * compact Browse fold) even though the landmark already says "this
 * matters". The migration is additive only:
 *
 *   - The landmark itself is never written — no link is added, removed, or
 *     reordered, and the file comes out byte-identical.
 *   - A target gets `prominence: primary` only when it has NO `prominence`
 *     field at all. Any existing value (even `background`) is left alone.
 *   - Only targets `prunedSubtree`'s walk would actually reach: the
 *     landmark's own directory or a descendant one, stopping at any nested
 *     landmark and never entering an owned `.attach/` scope unless that
 *     scope holds its own landmark (which is walked separately, as its own
 *     `*.landmark.card` match).
 *   - `category: "system"` targets are skipped: their default is a type
 *     property, not a per-card editorial call this migration should make.
 *
 * The target edit is the same surgical technique as `landmark-symbol.ts`:
 * parse only the frontmatter block with `yaml`'s `Document` API and `set()`
 * the one new key, so every untouched key keeps its formatting.
 *
 * Not built on `_harness.ts`'s per-file `convert()`: that harness assumes
 * one matched file both decides AND receives the edit. Here the match
 * (`*.landmark.card`) and the write (an arbitrary target elsewhere in the
 * subtree) are different files, and the walk needs the landmark's OWN box
 * root to resolve refs and compute the subtree — `document-to-pdf.ts` is
 * the precedent for a migrator shaped this way: a testable
 * `migrateBox(absRoot, apply)` returning a report, with a thin CLI wrapper.
 *
 * Idempotent: a second run finds every previously-marked target already
 * carrying `prominence`, so it reports zero marked and the same trim
 * candidates (nothing on disk changes).
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { parseDocument } from "yaml";
import { errnoCode, errorMessage } from "../../src/lib/error-guards.js";
import { fileExists } from "../../src/lib/file-exists.js";
import { parseFrontmatterObject, splitCardContent } from "../../src/cards/frontmatter.js";
import { parseLandmarkFields, type LandmarkLinkData } from "../../src/schemas/landmark.js";
import { prunedSubtree, type PrunedSubtree } from "../../src/core/landmark/prominence-index.js";
import { normalizeLandmarkDir } from "../../src/core/landmark/root-dir.js";
import { typeFromFilename } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";
import { parseRef, resolveRefPath } from "../../src/shared/ref-path.js";
import { Prominence, type ProminenceLevel } from "../../src/shared/prominence.js";
import type { CardSchema } from "../../src/cards/index.js";

export interface MarkedEntry {
  landmark: string;
  ref: string;
  target: string;
}

export interface SkippedEntry {
  landmark: string;
  ref: string;
  /** null when the ref itself doesn't resolve to an in-box path. */
  target: string | null;
  reason: string;
}

export interface TrimCandidate {
  landmark: string;
  ref: string;
  target: string;
  level: "primary" | "entry-point";
}

export interface MigrationReport {
  landmarksScanned: number;
  marked: MarkedEntry[];
  skipped: SkippedEntry[];
  trimCandidates: TrimCandidate[];
  failed: Array<{ file: string; error: string }>;
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

async function findLandmarkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".landmark.card")) out.push(full);
    }
  }
  await walk(root);
  return out;
}

function relSlash(absRoot: string, absPath: string): string {
  return relative(absRoot, absPath).split(sep).join("/");
}

/** What the frontmatter block says about `prominence`, loosely — no schema validation. */
interface FrontmatterProbe {
  hasFrontmatter: boolean;
  /** False when the block exists but doesn't parse as a YAML mapping. */
  frontmatterParses: boolean;
  hasProminenceField: boolean;
  /** Only set when the written value is one of the three recognized levels. */
  declaredLevel: ProminenceLevel | undefined;
}

function probeFrontmatter(text: string): FrontmatterProbe {
  const split = splitCardContent(text);
  if (!split.hasFrontmatter) {
    return { hasFrontmatter: false, frontmatterParses: false, hasProminenceField: false, declaredLevel: undefined };
  }
  const fields = parseFrontmatterObject(text);
  if (fields === null) {
    return { hasFrontmatter: true, frontmatterParses: false, hasProminenceField: false, declaredLevel: undefined };
  }
  const hasProminenceField = Object.hasOwn(fields, "prominence");
  const parsed = Prominence.safeParse(fields["prominence"]);
  return {
    hasFrontmatter: true,
    frontmatterParses: true,
    hasProminenceField,
    declaredLevel: parsed.success ? parsed.data : undefined,
  };
}

/**
 * Surgical edit: parse only the frontmatter block, `set()` the one new key,
 * keep everything else's formatting. `lineWidth: 0` disables yaml's default
 * ~80-column scalar wrapping (`renderFrontmatterBlock`'s convention) — without
 * it, `toString()` reflows every long scalar in the block it re-serializes,
 * turning a one-line insert into a whole-file diff on hand-authored prose.
 */
function markPrimary(text: string): string {
  const split = splitCardContent(text);
  const doc = parseDocument(split.frontmatterText);
  doc.set("prominence", "primary");
  return `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n${split.body}`;
}

/** A trim candidate: no label, and the target's effective level (after this migration) is already surfaced by derivation. */
function trimCandidateLevel(
  { declared, typeDefault, label }: { declared: ProminenceLevel | undefined; typeDefault: ProminenceLevel | "ordinary"; label: string | undefined },
): "primary" | "entry-point" | null {
  if (label !== undefined && label !== "") return null;
  const effective = declared ?? typeDefault;
  return effective === "primary" || effective === "entry-point" ? effective : null;
}

interface LinkContext {
  absRoot: string;
  landmarkRelPath: string;
  landmarkDisplay: string;
  subtree: PrunedSubtree;
  cardSchemas: Map<string, CardSchema>;
  apply: boolean;
  markedThisRun: Set<string>;
  report: MigrationReport;
}

function skip(ctx: LinkContext, { ref, target, reason }: { ref: string; target: string | null; reason: string }): void {
  ctx.report.skipped.push({ landmark: ctx.landmarkDisplay, ref, target, reason });
}

function recordTrimCandidate(
  ctx: LinkContext,
  { ref, target, declared, schema, label }: { ref: string; target: string; declared: ProminenceLevel | undefined; schema: CardSchema; label: string | undefined },
): void {
  const level = trimCandidateLevel({ declared, typeDefault: schema.defaultProminence, label });
  if (level === null) return;
  ctx.report.trimCandidates.push({ landmark: ctx.landmarkDisplay, ref, target, level });
}

/**
 * Resolve one `links:` entry against its landmark and, if it names an
 * eligible in-subtree target with no `prominence` yet, mark it. Every path
 * out of this function either records a skip reason or a mark/trim result —
 * nothing is silently dropped.
 */
async function processLink(ctx: LinkContext, link: LandmarkLinkData): Promise<void> {
  // `Bread.recipe.card#notes` names Bread: the path part is what resolves;
  // the fragment/query ride along in the report's `ref` only.
  const resolved = resolveRefPath({ fromPath: ctx.landmarkRelPath, ref: parseRef(link.ref).path, kind: "card" });
  if (resolved === null) {
    skip(ctx, { ref: link.ref, target: null, reason: "ref does not resolve to an in-box path" });
    return;
  }
  const targetBoxPath = `/${resolved}`;
  const absTarget = join(ctx.absRoot, resolved);

  if (!(await fileExists(absTarget))) {
    skip(ctx, { ref: link.ref, target: targetBoxPath, reason: "target does not exist (bbx validate already flags this ref)" });
    return;
  }
  if (!ctx.subtree.cardBoxPaths.has(targetBoxPath)) {
    skip(ctx, { ref: link.ref, target: targetBoxPath, reason: "target is outside the landmark's pruned subtree" });
    return;
  }
  const type = typeFromFilename(resolved);
  const schema = type === undefined ? undefined : ctx.cardSchemas.get(type);
  if (schema === undefined) {
    skip(ctx, { ref: link.ref, target: targetBoxPath, reason: "target is not a recognized card type" });
    return;
  }
  if (schema.category === "system") {
    skip(ctx, { ref: link.ref, target: targetBoxPath, reason: "target's card type is category: system" });
    return;
  }

  if (ctx.markedThisRun.has(absTarget)) {
    recordTrimCandidate(ctx, { ref: link.ref, target: targetBoxPath, declared: "primary", schema, label: link.label });
    skip(ctx, { ref: link.ref, target: targetBoxPath, reason: "target already has prominence: primary (marked earlier in this run)" });
    return;
  }

  const text = await readFile(absTarget, "utf8");
  const probe = probeFrontmatter(text);
  if (!probe.hasFrontmatter) {
    skip(ctx, { ref: link.ref, target: targetBoxPath, reason: "target has no frontmatter block" });
    return;
  }
  if (!probe.frontmatterParses) {
    skip(ctx, { ref: link.ref, target: targetBoxPath, reason: "target frontmatter does not parse as YAML" });
    return;
  }
  if (probe.hasProminenceField) {
    recordTrimCandidate(ctx, { ref: link.ref, target: targetBoxPath, declared: probe.declaredLevel, schema, label: link.label });
    skip(ctx, {
      ref: link.ref,
      target: targetBoxPath,
      reason: `target already has prominence${probe.declaredLevel === undefined ? "" : `: ${probe.declaredLevel}`}`,
    });
    return;
  }

  if (ctx.apply) await writeFile(absTarget, markPrimary(text), "utf8");
  ctx.markedThisRun.add(absTarget);
  ctx.report.marked.push({ landmark: ctx.landmarkDisplay, ref: link.ref, target: targetBoxPath });
  recordTrimCandidate(ctx, { ref: link.ref, target: targetBoxPath, declared: "primary", schema, label: link.label });
}

async function processLandmark(
  { absRoot, landmarkAbsPath, cardSchemas, apply, markedThisRun, report }: {
    absRoot: string;
    landmarkAbsPath: string;
    cardSchemas: Map<string, CardSchema>;
    apply: boolean;
    markedThisRun: Set<string>;
    report: MigrationReport;
  },
): Promise<void> {
  const landmarkRelPath = relSlash(absRoot, landmarkAbsPath);
  const text = await readFile(landmarkAbsPath, "utf8");
  const fields = parseLandmarkFields(text);
  const links = fields?.navigation?.links ?? [];
  if (links.length === 0) return;

  const dir = normalizeLandmarkDir(dirname(landmarkRelPath));
  const subtree = await prunedSubtree(absRoot, dir);
  const ctx: LinkContext = {
    absRoot,
    landmarkRelPath,
    landmarkDisplay: landmarkRelPath,
    subtree,
    cardSchemas,
    apply,
    markedThisRun,
    report,
  };
  for (const link of links) await processLink(ctx, link);
}

/** Runs the whole migration and returns the report without touching `process` — the CLI wrapper lives in `landmark-links-prominence-run.ts`. */
export async function migrateBox(absRoot: string, apply: boolean): Promise<MigrationReport> {
  const report: MigrationReport = { landmarksScanned: 0, marked: [], skipped: [], trimCandidates: [], failed: [] };
  const cardSchemas = await createCardSchemaMap(absRoot);
  const markedThisRun = new Set<string>();
  const landmarkFiles = (await findLandmarkFiles(absRoot)).toSorted();
  report.landmarksScanned = landmarkFiles.length;

  for (const landmarkAbsPath of landmarkFiles) {
    try {
      await processLandmark({ absRoot, landmarkAbsPath, cardSchemas, apply, markedThisRun, report });
    } catch (e) {
      report.failed.push({ file: relSlash(absRoot, landmarkAbsPath), error: errorMessage(e) });
    }
  }
  return report;
}
