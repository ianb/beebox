/**
 * `--rewrite-mentions`: rewrites every confidently-resolvable non-import
 * mention of a moved path (or uniformly-renamed directory) across tracked
 * text files, and reports whatever mention text is still left afterward
 * (an ambiguous match we deliberately didn't touch, or one out of scope)
 * as "needs review". Pure computation over in-memory file contents — the
 * caller decides whether to persist `fileEdits`, so the same pass serves
 * both a real run and `--dry-run`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { containsToken, knipWorkspaceBlockRange, replaceDirectoryToken, replaceToken, type TokenKind } from "./mention-apply.js";
import { surveyDirectoryRenames } from "./mention-directories.js";
import { directoryForms, fileForms, type FormKind, type LiteralForm } from "./mention-forms.js";
import { isRelativeMentionCandidateFile, relativeCandidates } from "./mention-relative.js";
import { isExcludedFromMentionRewrite } from "./mention-history.js";
import { gitGrep, gitGrepFilesAny, gitLines } from "./git-ops.js";
import type { PlannedMove } from "./list.js";
import { mentionPatterns, owningRoot, type MentionGroup } from "./mentions.js";
import { baseOf, dirOf, isWithin } from "../graph.js";

export interface MentionRewriteResult {
  /** Path -> new content, only for files that actually changed. */
  fileEdits: Map<string, string>;
  countsByForm: Map<FormKind | "relative", number>;
  needsReview: MentionGroup[];
}

const TSCONFIG_PATTERN = /^tsconfig.*\.json$/;

function isPackageRelativeScope(params: { path: string; root: string }): boolean {
  if (isWithin(params.path, params.root)) return true;
  if (params.path === `${params.root}/package.json`) return true;
  if (params.path === `${params.root}/eslint.config.ts`) return true;
  if (dirOf(params.path) === params.root && TSCONFIG_PATTERN.test(baseOf(params.path))) return true;
  if (params.path === "knip.ts") return true; // scoped further to its workspace block below
  return false;
}

function applyForm(params: { text: string; form: LiteralForm; path: string }): { text: string; count: number } {
  const isDirectory = params.form.kind.startsWith("directory-");
  const replacer = isDirectory ? replaceDirectoryToken : replaceToken;
  if (params.form.scopeRoot !== null && params.path === "knip.ts") {
    const range = knipWorkspaceBlockRange(params.text, baseOf(params.form.scopeRoot));
    if (range === null) return { text: params.text, count: 0 };
    const before = params.text.slice(0, range.start);
    const inner = params.text.slice(range.start, range.end);
    const after = params.text.slice(range.end);
    const result = replacer({ text: inner, oldToken: params.form.old, newToken: params.form.new });
    return { text: before + result.text + after, count: result.count };
  }
  return replacer({ text: params.text, oldToken: params.form.old, newToken: params.form.new });
}

function orderRank(kind: FormKind): number {
  return kind === "repo-relative" || kind === "directory-repo-relative" ? 0 : 1;
}

function directoryPatterns(dir: string, roots: string[]): string[] {
  const patterns = new Set([dir]);
  const root = owningRoot(dir, roots);
  if (root !== null) patterns.add(dir.slice(root.length + 1));
  return [...patterns];
}

/** `git grep -n`'s `path:lineNumber:content` — content may itself contain colons, so only the first two are structural. */
function splitGrepLine(line: string): { path: string; content: string } {
  const firstColon = line.indexOf(":");
  const secondColon = line.indexOf(":", firstColon + 1);
  return { path: line.slice(0, firstColon), content: secondColon === -1 ? "" : line.slice(secondColon + 1) };
}

function leftoverLines(params: {
  repoRoot: string;
  patterns: string[];
  fileEdits: ReadonlyMap<string, string>;
  excluded: (path: string) => boolean;
  kind: TokenKind;
}): string[] {
  const lines = new Set<string>();
  for (const pattern of params.patterns) {
    for (const line of gitGrep({ repoRoot: params.repoRoot, pattern })) {
      const { path, content } = splitGrepLine(line);
      if (params.excluded(path) || params.fileEdits.has(path)) continue;
      // `git grep -F` matches the bare substring; re-check the boundary rule so a
      // needs-review hit means the same thing a rewrite candidate would have.
      if (!containsToken({ text: content, literal: pattern, kind: params.kind })) continue;
      lines.add(line);
    }
  }
  for (const [path, text] of params.fileEdits) {
    if (params.excluded(path)) continue;
    for (const [idx, lineText] of text.split("\n").entries()) {
      for (const pattern of params.patterns) {
        if (containsToken({ text: lineText, literal: pattern, kind: params.kind })) {
          lines.add(`${path}:${idx + 1}:${lineText}`);
          break;
        }
      }
    }
  }
  return [...lines].toSorted();
}

export function computeMentionRewrite(params: {
  repoRoot: string;
  moves: PlannedMove[];
  roots: string[];
  rewrittenFiles: ReadonlySet<string>;
}): MentionRewriteResult {
  const moveMap = new Map(params.moves.map((m) => [m.from, m.to] as const));
  const { renames: directoryRenames, nonUniform: nonUniformDirs } = surveyDirectoryRenames({
    repoRoot: params.repoRoot,
    moves: params.moves,
  });
  const excluded = (path: string): boolean => isExcludedFromMentionRewrite(path) || params.rewrittenFiles.has(path);

  const literalForms = [
    ...params.moves.flatMap((move) => fileForms({ move, roots: params.roots })),
    ...directoryRenames.flatMap((rename) => directoryForms({ rename, roots: params.roots })),
  ].toSorted((a, b) => orderRank(a.kind) - orderRank(b.kind));

  const literalCandidates = gitGrepFilesAny({ repoRoot: params.repoRoot, patterns: literalForms.map((f) => f.old) }).filter(
    (path) => !excluded(path),
  );
  const allTracked = gitLines({ repoRoot: params.repoRoot, args: ["ls-files", "-z"] });
  const relativeCandidates_ = allTracked.filter((path) => isRelativeMentionCandidateFile(path) && !excluded(path));

  const countsByForm = new Map<FormKind | "relative", number>();
  const bump = (kind: FormKind | "relative", n: number): void => {
    if (n === 0) return;
    countsByForm.set(kind, (countsByForm.get(kind) ?? 0) + n);
  };

  const fileEdits = new Map<string, string>();
  const isLiteralCandidate = new Set(literalCandidates);
  const isRelativeCandidate = new Set(relativeCandidates_);
  for (const path of new Set([...literalCandidates, ...relativeCandidates_])) {
    const original = readFileSync(join(params.repoRoot, path), "utf8");
    let text = original;
    if (isLiteralCandidate.has(path)) {
      for (const form of literalForms) {
        if (form.scopeRoot !== null && !isPackageRelativeScope({ path, root: form.scopeRoot })) continue;
        const result = applyForm({ text, form, path });
        text = result.text;
        bump(form.kind, result.count);
      }
    }
    if (isRelativeCandidate.has(path)) {
      for (const move of params.moves) {
        for (const candidate of relativeCandidates({ move, mentioningPath: path, moveMap })) {
          if (!containsToken({ text, literal: candidate.old })) continue;
          const result = replaceToken({ text, oldToken: candidate.old, newToken: candidate.new });
          text = result.text;
          bump("relative", result.count);
        }
      }
    }
    if (text !== original) fileEdits.set(path, text);
  }

  const needsReview: MentionGroup[] = [
    ...params.moves.map((move) => ({
      movedPath: move.from,
      lines: leftoverLines({
        repoRoot: params.repoRoot,
        patterns: mentionPatterns({ oldPath: move.from, roots: params.roots }),
        fileEdits,
        excluded,
        kind: "file" as const,
      }),
    })),
    ...directoryRenames.map((rename) => ({
      movedPath: `${rename.from}/`,
      lines: leftoverLines({
        repoRoot: params.repoRoot,
        patterns: directoryPatterns(rename.from, params.roots),
        fileEdits,
        excluded,
        kind: "directory" as const,
      }),
    })),
    ...nonUniformDirs.map((dir) => ({
      movedPath: `${dir}/`,
      lines: leftoverLines({
        repoRoot: params.repoRoot,
        patterns: directoryPatterns(dir, params.roots),
        fileEdits,
        excluded,
        kind: "directory" as const,
      }),
    })),
  ];

  return { fileEdits, countsByForm, needsReview };
}
