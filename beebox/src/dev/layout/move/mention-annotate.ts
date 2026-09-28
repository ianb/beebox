/**
 * `--annotate-from-git <base>`: for moves that already happened before this
 * tool's rewrite passes existed, `--mentions-from-git` fixes every
 * confidently-resolvable non-import mention live but deliberately leaves
 * history documents and ambiguous hits untouched. This mode instead
 * ANNOTATES the ~770 old-path mentions the rewrite pass skipped, appending
 * a trailing note — `` `old/path.ts:12` (moved to `new/path.ts`) `` — so the
 * old path stays exactly as written. Reuses `mention-forms.ts`'s literal
 * forms and `mention-apply.ts`'s boundary-token matching (same rules the
 * rewrite pass uses), scoped to tracked Markdown files, skipping fenced
 * code blocks (`markdown-fence.ts`) so runnable examples stay untouched.
 *
 * Frozen/generated prefixes mirror `doc-check.ts`'s `FROZEN_SCAN_PREFIXES`
 * and `GENERATED_NO_SCAN` — this mode must not annotate a snapshot that's
 * frozen on purpose or a file doc-check itself regenerates.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isWithin } from "../graph.js";
import { computeRenamesFromGit, type RejectedRename } from "./git-renames.js";
import { gitGrepFilesAny, gitLines } from "./git-ops.js";
import type { TokenKind } from "./mention-apply.js";
import { matchTokenRanges } from "./mention-apply.js";
import { surveyDirectoryRenames, type DirectoryRename } from "./mention-directories.js";
import { directoryForms, fileForms } from "./mention-forms.js";
import type { PlannedMove } from "./list.js";
import { fencedRanges, isInsideRanges } from "./markdown-fence.js";

export type AnnotateArea = "plans" | "implemented-plans" | "issues-closed" | "issues-open" | "research" | "other";

export const ANNOTATE_AREAS: AnnotateArea[] = ["plans", "implemented-plans", "issues-closed", "issues-open", "research", "other"];

export interface MentionAnnotateResult {
  /** Path -> new content, only for files that gained at least one note. */
  fileEdits: Map<string, string>;
  countsByArea: Map<AnnotateArea, number>;
  total: number;
}

// Mirrors `doc-check.ts`'s `FROZEN_SCAN_PREFIXES`: point-in-time snapshots
// whose old-path mentions are frozen on purpose, not decayed references.
const FROZEN_ANNOTATE_PREFIXES = ["beebox/docs/reports/", "beebox/docs/user-stories/catalog/"];

// Mirrors `doc-check.ts`'s `GENERATED_NO_SCAN`: emitted output that quotes
// other files' content verbatim; regenerate it instead of annotating it.
const GENERATED_NO_ANNOTATE = new Set(["beebox/docs/doc-graph.md", "beebox/docs/prompts.md"]);

function isExcludedFromAnnotate(path: string): boolean {
  if (path.endsWith(".doctest.md")) return true;
  if (GENERATED_NO_ANNOTATE.has(path)) return true;
  return FROZEN_ANNOTATE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Every tracked Markdown file in scope for annotation. */
export function annotateCandidateFiles(repoRoot: string): string[] {
  return gitLines({ repoRoot, args: ["ls-files", "-z", "--", "*.md"] }).filter((path) => !isExcludedFromAnnotate(path));
}

export function areaOf(path: string): AnnotateArea {
  if (path.startsWith("beebox/docs/plans/")) return "plans";
  if (path.startsWith("beebox/docs/implemented-plans/")) return "implemented-plans";
  if (path.startsWith("issues/closed/")) return "issues-closed";
  if (path.startsWith("issues/")) return "issues-open";
  if (path.startsWith("research/")) return "research";
  return "other";
}

interface AnnotationTarget {
  /** The literal old-path text a mention could spell (repo-relative, package-relative, or an extension variant). */
  old: string;
  /** The canonical new REPO-RELATIVE path to embed in the note — never a package-relative or extension-swapped spelling. */
  newRepoRelative: string;
  kind: TokenKind;
  /** The package root a package-relative form is scoped to; `null` for a repo-relative form (any file). */
  scopeRoot: string | null;
}

function targetsForMove(move: PlannedMove, roots: string[]): AnnotationTarget[] {
  return fileForms({ move, roots }).map((form) => ({
    old: form.old,
    newRepoRelative: move.to,
    kind: "file",
    scopeRoot: form.scopeRoot,
  }));
}

function targetsForDirectory(rename: DirectoryRename, roots: string[]): AnnotationTarget[] {
  return directoryForms({ rename, roots }).map((form) => ({
    old: form.old,
    newRepoRelative: rename.to,
    kind: "directory",
    scopeRoot: form.scopeRoot,
  }));
}

const LINE_SUFFIX = /^:\d+(?:-\d+)?/;

/** A trailing `:line` or `:line-line` suffix belongs to the token — the note goes after it, not before. */
function extendForLineSuffix(text: string, end: number): number {
  const match = LINE_SUFFIX.exec(text.slice(end, end + 32));
  return match === null ? end : end + match[0].length;
}

/**
 * A mention closed by an inline-code backtick or a Markdown link's `)` keeps
 * the note outside that closing marker, per the boxholder's example
 * (`` `path:12` (moved to `...`) `` — not inside the code span).
 */
function extendPastClosingMarker(text: string, end: number): number {
  const ch = text[end];
  return ch === "`" || ch === ")" ? end + 1 : end;
}

const ALREADY_ANNOTATED = " (moved to";

function isAlreadyAnnotated(text: string, pos: number): boolean {
  return text.startsWith(ALREADY_ANNOTATED, pos);
}

function noteFor(newRepoRelative: string): string {
  return ` (moved to \`${newRepoRelative}\`)`;
}

interface Insertion {
  pos: number;
  note: string;
}

function computeInsertions(params: { text: string; targets: AnnotationTarget[]; path: string }): Insertion[] {
  const fenced = fencedRanges(params.text);
  const byPosition = new Map<number, string>();
  for (const target of params.targets) {
    if (target.scopeRoot !== null && !isWithin(params.path, target.scopeRoot)) continue;
    for (const range of matchTokenRanges({ text: params.text, literal: target.old, kind: target.kind })) {
      if (isInsideRanges(range.start, fenced)) continue;
      let end = extendForLineSuffix(params.text, range.end);
      end = extendPastClosingMarker(params.text, end);
      if (isAlreadyAnnotated(params.text, end)) continue;
      if (!byPosition.has(end)) byPosition.set(end, noteFor(target.newRepoRelative));
    }
  }
  return [...byPosition.entries()].map(([pos, note]) => ({ pos, note }));
}

function applyInsertions(text: string, insertions: Insertion[]): string {
  let result = text;
  for (const { pos, note } of insertions.toSorted((a, b) => b.pos - a.pos)) {
    result = result.slice(0, pos) + note + result.slice(pos);
  }
  return result;
}

export interface MentionAnnotateComputation {
  result: MentionAnnotateResult;
  rejected: RejectedRename[];
}

export function computeMentionAnnotate(params: { repoRoot: string; base: string; roots: string[] }): MentionAnnotateComputation {
  const { moves, rejected } = computeRenamesFromGit({ repoRoot: params.repoRoot, base: params.base });
  const { renames: directoryRenames } = surveyDirectoryRenames({ repoRoot: params.repoRoot, moves });

  const targets: AnnotationTarget[] = [
    ...moves.flatMap((move) => targetsForMove(move, params.roots)),
    ...directoryRenames.flatMap((rename) => targetsForDirectory(rename, params.roots)),
  ];

  const candidateFiles = new Set(annotateCandidateFiles(params.repoRoot));
  const literalCandidates = gitGrepFilesAny({ repoRoot: params.repoRoot, patterns: targets.map((t) => t.old) }).filter((path) =>
    candidateFiles.has(path),
  );

  const fileEdits = new Map<string, string>();
  const countsByArea = new Map<AnnotateArea, number>();
  let total = 0;
  for (const path of literalCandidates) {
    const original = readFileSync(join(params.repoRoot, path), "utf8");
    const insertions = computeInsertions({ text: original, targets, path });
    if (insertions.length === 0) continue;
    fileEdits.set(path, applyInsertions(original, insertions));
    total += insertions.length;
    const area = areaOf(path);
    countsByArea.set(area, (countsByArea.get(area) ?? 0) + insertions.length);
  }
  return { result: { fileEdits, countsByArea, total }, rejected };
}
