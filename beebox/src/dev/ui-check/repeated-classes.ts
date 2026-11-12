/**
 * The second half of `pnpm ui-check`: a class string of six or more tokens
 * that styles an appearance and appears in two files is a copied look. Merge
 * it into a primitive, a shared component, or one exported class constant.
 * Lint rules see one file; this check compares them all.
 */
import * as ts from "../../lib/typescript/syntax.js";

/** Fewer tokens than this is too short to call a copied look. */
export const MIN_TOKENS = 6;

/**
 * A Tailwind-shaped token: optional variants (`hover:`, `md:`), an optional
 * `!` and `-`, a lowercase name, then arbitrary values (`-[3px]`), opacity
 * (`/15`) or further segments (`-0.5`, `-1/2`).
 */
const CLASS_TOKEN = /^(?:[\da-z-]+:)*!?-?[a-z][\da-z-]*(?:-\[[^\s\]]+]|\/[\d.]+|-[\d./a-z]+)*$/;
const HOOK_TOKEN = /^bbx-[\da-z-]+$/;

/**
 * `bg-`, `border`, `rounded`, `shadow`, `ring-`, or `text-` with a palette
 * role (primary, accent, info, danger, success, warning, coral, warm, card,
 * white, black, gray). A string with none of these is layout only.
 */
const APPEARANCE =
  /^(?:bg-|border|rounded|shadow|ring-|text-(?:primary|accent|info|danger|success|warning|coral|warm|card|white|black|gray)(?:$|[/-]))/;

/** A token with its variant chain and `!`/`-` prefixes removed: `hover:!-mt-1` → `mt-1`. */
function baseOf(token: string): string {
  return token.replace(/^(?:[\da-z-]+:)*/, "").replace(/^!?-?/, "");
}

export function isClassShaped(tokens: readonly string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => CLASS_TOKEN.test(token) || HOOK_TOKEN.test(token));
}

export function hasAppearanceToken(tokens: readonly string[]): boolean {
  return tokens.some((token) => APPEARANCE.test(baseOf(token)));
}

/**
 * The tokens of a candidate string. A template quasi drops a token that
 * touches a `${}` with no space between (`bg-${tone}` is partial).
 */
function tokensOf(text: string, opts: { partialStart: boolean; partialEnd: boolean }): string[] {
  const tokens = text.split(/\s+/);
  const kept = tokens.slice(opts.partialStart ? 1 : 0, opts.partialEnd ? -1 : undefined);
  return kept.filter((token) => token !== "");
}

/** The candidate strings of one file: string literals and template quasis, each as a token list. */
export function candidateStrings(sourceFile: ts.SourceFile): string[][] {
  const found: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(tokensOf(node.text, { partialStart: false, partialEnd: false }));
    } else if (ts.isTemplateHead(node)) {
      found.push(tokensOf(node.text, { partialStart: false, partialEnd: !/\s$/.test(node.text) }));
    } else if (ts.isTemplateMiddle(node)) {
      found.push(tokensOf(node.text, { partialStart: !/^\s/.test(node.text), partialEnd: !/\s$/.test(node.text) }));
    } else if (ts.isTemplateTail(node)) {
      found.push(tokensOf(node.text, { partialStart: !/^\s/.test(node.text), partialEnd: false }));
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

/** The comparable key of a class string: its sorted, deduplicated tokens, variants kept. */
export function classSetKey(tokens: readonly string[]): string | null {
  if (!isClassShaped(tokens) || !hasAppearanceToken(tokens)) return null;
  const set = [...new Set(tokens)].toSorted();
  return set.length >= MIN_TOKENS ? set.join(" ") : null;
}

/** A repeated set that stays: the set's key and why merging it would be wrong. */
export interface RepeatedClassAllowance {
  key: string;
  reason: string;
}

export interface RepeatedClassFile {
  /** Path shown in the report (relative to the frontend source root). */
  file: string;
  sourceFile: ts.SourceFile;
}

/**
 * One line per class set that appears in two or more files, sorted by the
 * set, with its files sorted. An allowed key that no longer repeats is
 * reported too, so the allowance list cannot go stale.
 */
export function repeatedClassProblems(
  files: readonly RepeatedClassFile[],
  allowed: readonly RepeatedClassAllowance[],
): string[] {
  const filesByKey = new Map<string, Set<string>>();
  for (const { file, sourceFile } of files) {
    for (const tokens of candidateStrings(sourceFile)) {
      const key = classSetKey(tokens);
      if (key === null) continue;
      const set = filesByKey.get(key) ?? new Set<string>();
      set.add(file);
      filesByKey.set(key, set);
    }
  }
  const allowedKeys = new Set(allowed.map((entry) => entry.key));
  const problems: string[] = [];
  for (const key of [...filesByKey.keys()].toSorted()) {
    const where = [...(filesByKey.get(key) ?? [])].toSorted();
    if (where.length < 2 || allowedKeys.has(key)) continue;
    problems.push(`repeated class string "${key}" in ${where.join(", ")}; share it through a primitive, a component or one exported constant`);
  }
  for (const key of [...allowedKeys].toSorted()) {
    if ((filesByKey.get(key)?.size ?? 0) < 2) problems.push(`allowed repeated class string "${key}" no longer repeats; remove its allowance`);
  }
  return problems;
}
