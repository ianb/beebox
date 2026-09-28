/**
 * Text-level mechanics for rewriting a mention: the path-token boundary
 * rule (a match's neighbor characters must not themselves be path
 * characters, so `src/core/foo.ts` doesn't match inside `src/core/foo.tsx`
 * or `xsrc/core/foo.ts`), and the one structural special case —
 * `knip.ts`'s per-package workspace blocks — where a package-relative
 * mention must be scoped to its own package's block, not the whole file.
 */
const PATH_CHAR = "[A-Za-z0-9_./@-]";
/**
 * A directory token's forbidden continuations: another bare path character
 * directly (`scripts/migrated` doesn't match `scripts/migrate`), or `/`
 * followed by a further plain path segment (`scripts/migrate/sub/two.ts`
 * mentions a SPECIFIC file, already `fileForms`'s job — matching it here
 * too would flag or rewrite every untouched file that merely shares the
 * directory, which is most of them). `/` is still allowed when it ends the
 * token (a bare `scripts/migrate/` mention) or continues into a glob
 * (`scripts/migrate/**\/*.ts`), both real directory-level mentions.
 */
const DIRECTORY_FORBIDDEN_AFTER = "(?:[A-Za-z0-9_.@-]|/[A-Za-z0-9_.@-])";

export type TokenKind = "file" | "directory";

function escapeRegExp(literal: string): string {
  return literal.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}

function tokenRegex(params: { literal: string; kind: TokenKind }): RegExp {
  const after = params.kind === "directory" ? DIRECTORY_FORBIDDEN_AFTER : PATH_CHAR;
  // eslint-disable-next-line security/detect-non-literal-regexp -- built from `literal` with every metacharacter escaped above; only the boundary lookarounds are fixed text.
  return new RegExp(`(?<!${PATH_CHAR})${escapeRegExp(params.literal)}(?!${after})`, "g");
}

/** True when `text` contains `literal` as a full path token (the boundary rule), ignoring position. */
export function containsToken(params: { text: string; literal: string; kind?: TokenKind }): boolean {
  const kind = params.kind ?? "file";
  if (!params.text.includes(params.literal)) return false;
  return tokenRegex({ literal: params.literal, kind }).test(params.text);
}

/**
 * Every path-token match of `literal` in `text`, as character ranges —
 * `annotate-from-git`'s counterpart to `replaceToken`, which needs match
 * positions to insert a trailing note rather than substitute text.
 */
export function matchTokenRanges(params: { text: string; literal: string; kind?: TokenKind }): Array<{ start: number; end: number }> {
  const kind = params.kind ?? "file";
  if (!params.text.includes(params.literal)) return [];
  const regex = tokenRegex({ literal: params.literal, kind });
  const ranges: Array<{ start: number; end: number }> = [];
  let match = regex.exec(params.text);
  while (match !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
    match = regex.exec(params.text);
  }
  return ranges;
}

/**
 * Replaces every path-token match of `oldToken` with `newToken` in `text`.
 * Returns the replaced text and how many occurrences were rewritten.
 */
export function replaceToken(params: {
  text: string;
  oldToken: string;
  newToken: string;
  kind?: TokenKind;
}): { text: string; count: number } {
  const kind = params.kind ?? "file";
  if (!params.text.includes(params.oldToken)) return { text: params.text, count: 0 };
  const matches = params.text.match(tokenRegex({ literal: params.oldToken, kind }));
  if (matches === null || matches.length === 0) return { text: params.text, count: 0 };
  return { text: params.text.replace(tokenRegex({ literal: params.oldToken, kind }), params.newToken), count: matches.length };
}

/**
 * The character range of `knip.ts`'s `"<packageName>": { ... }` workspace
 * block, found by brace counting from the key. `null` when the file has no
 * block for that package (the mention isn't scoped there, so the caller
 * leaves it alone rather than risk rewriting a same-named path that
 * belongs to a different package's block).
 */
export function knipWorkspaceBlockRange(text: string, packageName: string): { start: number; end: number } | null {
  // eslint-disable-next-line security/detect-non-literal-regexp -- built from `packageName` with every metacharacter escaped above.
  const keyPattern = new RegExp(`"${escapeRegExp(packageName)}"\\s*:\\s*\\{`);
  const match = keyPattern.exec(text);
  if (match === null) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    i++;
  }
  return { start, end: i };
}

const GLOB_METACHARACTERS = /[*?[\]{}]/;

/**
 * Line-wise `replaceToken` for a directory rename: a directory mention
 * inside a glob pattern (`src/schemas/**\/*.list-entry.tsx`) shares its
 * text with the directory's own path, but the glob may cover more or
 * fewer files than the uniform rename does, so it's reported (left alone,
 * to surface in "needs review") rather than rewritten. Any line with a
 * glob metacharacter is skipped on that basis.
 */
export function replaceDirectoryToken(params: { text: string; oldToken: string; newToken: string }): { text: string; count: number } {
  let count = 0;
  const lines = params.text.split("\n").map((line) => {
    if (!line.includes(params.oldToken) || GLOB_METACHARACTERS.test(line)) return line;
    const result = replaceToken({ text: line, oldToken: params.oldToken, newToken: params.newToken, kind: "directory" });
    count += result.count;
    return result.text;
  });
  return { text: lines.join("\n"), count };
}

/** Applies `replaceToken` only within `[start, end)` of `text`, leaving the rest untouched. */
export function replaceTokenInRange(params: {
  text: string;
  oldToken: string;
  newToken: string;
  range: { start: number; end: number };
}): { text: string; count: number } {
  const before = params.text.slice(0, params.range.start);
  const inner = params.text.slice(params.range.start, params.range.end);
  const after = params.text.slice(params.range.end);
  const result = replaceToken({ text: inner, oldToken: params.oldToken, newToken: params.newToken });
  return { text: before + result.text + after, count: result.count };
}
