/**
 * The mechanical half of the cross-box leak scan: a text/regex sweep over
 * beebox's HTTP surface for the recurring leak shape — a caller-supplied
 * path-like input joined onto `boxRoot` without going through a containment
 * helper. See `schedules/cross-box-leak-scan/run.ts` for how this fits with
 * the host audit and the dynamic probe, and `prompt.md` for how a finding
 * here gets adjudicated.
 *
 * Deliberately NOT a TypeScript AST parse — line/regex with a small
 * multi-line "gather the chain" pass is enough to find candidates, and false
 * positives are fine: the agent adjudicates, and the baseline in `run.ts`
 * suppresses repeats. Correctness here is checked against fixture strings
 * modeled on the real source lines (`cross-box-leak-scan.test.ts`), since the
 * source these matchers were modeled on keeps changing shape as it gets
 * fixed — see the doc comments below for the known cases as of authoring.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface StaticFinding {
  /** Path relative to the repo root, forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The verbatim, trimmed source line the finding is about. */
  text: string;
}

/** Field names this sweep treats as path-like: an exact match against this
 *  list (singular or trivially pluralized), or anything ending `Path`/`Dir`. */
const FIELD_NAME_EXACT =
  /^(path|dir|file|root|contextDir|cardPath|questionPath|targetDir|href)s?$/;
const FIELD_NAME_SUFFIX = /(Path|Dir)$/;

function isPathLikeName(name: string): boolean {
  return FIELD_NAME_EXACT.test(name) || FIELD_NAME_SUFFIX.test(name);
}

/** Containment helpers whose presence in a file means "this file already
 *  contains its path inputs" — matcher (ii) and (iii) both stand down when
 *  any of these is called anywhere in the file. `TaskOutput\w*\(` is a second,
 *  looser net for the helper `beebox/src/core/chat/session/transcript-paths.ts`
 *  is gaining under a name that contains "TaskOutput" (see run.ts's doc
 *  comment) — it keeps this list from silently going stale if that helper is
 *  renamed within the family. */
const CONTAINMENT_HELPERS = [
  "boxRelativePath",
  "containWithinBox",
  "resolveContainedRef",
  "realpathContained",
  "resolveCardPath",
  "resolveRefPath",
  "toRelativePath",
  "normalizePath",
  "normalizeHistoryPath",
  "parseSessionMediaRef",
  "resolveExternalRef",
  "resolveViewPath",
  "resolveSendTargetForRoute",
  "loadOwnedBulkSession",
  "readStagingSession",
  "isTaskOutputPathForBox",
  "taskOutputPathForBox",
];
// eslint-disable-next-line security/detect-non-literal-regexp -- built once, at module load, from the fixed CONTAINMENT_HELPERS literal above (never from input)
const CONTAINMENT_HELPER_RE = new RegExp(String.raw`\b(${CONTAINMENT_HELPERS.join("|")})\s*\(`);
const TASK_OUTPUT_HELPER_RE = /TaskOutput\w*\(/;

/** The inline containment idiom two routes (`api-browse.ts`, `figure.ts`) use
 *  today instead of calling a named helper: `path.resolve(...)` a candidate,
 *  then compare it with `.startsWith(root + path.sep)` (or the template-
 *  literal spelling) rather than a bare prefix check. Counts as "contained"
 *  the same as a helper call — once these two are consolidated onto
 *  `containWithinBox`, the helper-name match above covers them and this
 *  becomes dead weight, which is fine to delete then. */
const INLINE_RESOLVE_RE = /path\.resolve\(/;
const INLINE_STARTSWITH_PATH_SEP_RE = /\.startsWith\([^()]*path\.sep[^()]*\)/;

function fileHasInlineContainmentIdiom(content: string): boolean {
  return INLINE_RESOLVE_RE.test(content) && INLINE_STARTSWITH_PATH_SEP_RE.test(content);
}

function fileHasContainmentHelper(content: string): boolean {
  return CONTAINMENT_HELPER_RE.test(content) || TASK_OUTPUT_HELPER_RE.test(content) || fileHasInlineContainmentIdiom(content);
}

/** Matcher (ii) only fires when the file actually touches the filesystem with
 *  the value it read — `fs.`, `path.join(`, or `path.resolve(` appearing
 *  anywhere in the file. This is file-level, not tied to the specific match:
 *  it's a cheap "does this route do filesystem work at all" gate, not proof
 *  the flagged value is what reaches `fs`/`path`. `api-adapters.ts` forwards
 *  its param to an upstream URL and `history.ts`'s route hands its param to
 *  `simple-git`/`execFileSync` — cases this is meant to skip — but both files
 *  ALSO do unrelated `fs`/`path.join` work elsewhere (a local secret-file
 *  read, a git-object read), so this gate does not actually exclude them; see
 *  `run.ts`'s known-gaps note. */
const FS_USAGE_RE = /\bfs\.|path\.join\(|path\.resolve\(/;

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

function lineTextAt(content: string, lineNo: number): string {
  return (content.split("\n")[lineNo - 1] ?? "").trim();
}

/**
 * Whether the nearest enclosing `z.object({...})` before `fieldIndex`
 * continues, once its own `{...}` and `(...)` close, with `.refine(` or
 * `.superRefine(` — object-level validation that a per-field check like this
 * matcher can't see (`todos.ts`'s `list` procedure: `cardPath` is bare, but
 * `.input(z.object({...}).superRefine((val, ctx) => { ... })` validates it
 * alongside `glob`). Finds the object by scanning backward for the nearest
 * `z.object(`, then depth-tracks forward (treating `(` / `{` as +1 and `)` /
 * `}` as -1 — good enough since TS is always properly nested) to that call's
 * own close, and checks what follows it.
 */
function objectLevelRefinementFollows(content: string, fieldIndex: number): boolean {
  const objectStart = content.lastIndexOf("z.object(", fieldIndex);
  if (objectStart === -1) return false;
  let depth = 0;
  let i = objectStart + "z.object".length;
  const limit = Math.min(content.length, i + 20_000);
  for (; i < limit; i += 1) {
    const ch = content[i];
    if (ch === "(" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return /^\s*\.(?:refine|superRefine)\(/.test(content.slice(i, i + 200));
}

/**
 * (i) A zod object field whose name looks path-like and whose declaration is
 * a bare `z.string()` optionally followed by nothing but `.optional()`,
 * `.nullable()`, and/or `.default(...)` — no other chained call, refine
 * included. That last part is what excludes `path: z.string().min(1)`
 * (card.ts's `resolveCardPath` case): `.min(1)` is not one of the three
 * allowed suffixes, so the field does not read as "bare", regardless of
 * whether a refine is present. A field is also skipped when its enclosing
 * object is refined as a whole (see {@link objectLevelRefinementFollows}).
 *
 * The chain is gathered by depth-tracking parens from just after the literal
 * `z.string()` until a top-level (depth 0) comma, or an unmatched `)` that
 * belongs to the enclosing object — which is what lets a multi-line
 * `.refine(...)` chain (chat-control-procedures.ts's `newFeatures.contextDir`)
 * get read as one expression even though it spans lines.
 *
 * Known false positives left in the baseline on purpose (per-field, no
 * refine of any kind, so this matcher has no way to see they're validated
 * elsewhere): `clerk-contract.ts` `destinationDir` and `share-contract.ts`
 * `dir` are checked against a destination allowlist by their caller;
 * `views.ts` `basePath` goes through `resolveContainedRef`; `admin-google.ts`
 * `returnPath` is an OAuth redirect path, not a filesystem path.
 */
export function scanZodStringFields(content: string, filePath: string): StaticFinding[] {
  const findings: StaticFinding[] = [];
  const fieldRe = /([A-Z_a-z]\w*)\s*:\s*z\.string\(\)/g;
  // The trailing `[\s}]*` tolerates the enclosing object literal's own
  // closing `}` (or several, for a nested schema) landing in the gathered
  // chain when the field is the object's last one — `z.object({ dir:
  // z.string() })` terminates on the unmatched `)` after the space-then-`}`,
  // neither of which is part of the field's own chain.
  const allowedSuffixRe = /^(?:\s*\.(?:optional|nullable)\(\)|\s*\.default\([^()]*\))*[\s}]*$/;
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(content)) !== null) {
    const fieldName = match[1];
    if (fieldName === undefined || !isPathLikeName(fieldName)) continue;
    let depth = 0;
    let i = match.index + match[0].length;
    const limit = Math.min(content.length, i + 4000);
    for (; i < limit; i += 1) {
      const ch = content[i];
      if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (ch === "," && depth === 0) {
        break;
      }
    }
    const chainSuffix = content.slice(match.index + match[0].length, i);
    if (!allowedSuffixRe.test(chainSuffix)) continue;
    if (objectLevelRefinementFollows(content, match.index)) continue;
    const lineNo = lineNumberAt(content, match.index);
    findings.push({ file: filePath, line: lineNo, text: lineTextAt(content, lineNo) });
  }
  return findings;
}

/** How many lines past a raw request access still count as "the same fix" for
 *  {@link isContainedNearby}. A whole-file check (the matcher's first cut)
 *  let one early, unrelated helper call hide a second, later, unbounded
 *  access added anywhere else in a big route file — a window bounds the
 *  check to code that's plausibly guarding THIS access. */
const CONTAINMENT_WINDOW_LINES = 40;

/** Whether a containment helper (named or the inline idiom) appears within
 *  `CONTAINMENT_WINDOW_LINES` lines starting at `lineNo` (1-based, inclusive
 *  of the match's own line). `lines` is the file pre-split so repeated calls
 *  per file don't re-split it. */
function isContainedNearby(lines: string[], lineNo: number): boolean {
  const window = lines.slice(lineNo - 1, lineNo - 1 + CONTAINMENT_WINDOW_LINES + 1).join("\n");
  return CONTAINMENT_HELPER_RE.test(window) || TASK_OUTPUT_HELPER_RE.test(window) || fileHasInlineContainmentIdiom(window);
}

/**
 * (ii) `request.query.<name>` / `request.params.<name>` / a wildcard route
 * param (`request.params["*"]`), gated by {@link FS_USAGE_RE} at the file
 * level (does this route do filesystem work AT ALL) and then, per match, by
 * {@link isContainedNearby} — a containment helper (or the inline idiom) has
 * to appear within the following `CONTAINMENT_WINDOW_LINES` lines of THAT
 * access, not merely anywhere in the file. A file-wide containment check
 * would let one early `isTaskOutputPathForBox` call permanently hide a
 * second, unrelated, unbounded `request.query.x` added anywhere later in the
 * same route file — false negatives from the window being too narrow are why
 * the host audit and the dynamic probe are separate legs, not a reason to
 * widen this past what "the fix for this access" plausibly looks like.
 */
export function scanRawRequestAccess(content: string, filePath: string): StaticFinding[] {
  if (!FS_USAGE_RE.test(content)) return [];
  const lines = content.split("\n");
  const findings: StaticFinding[] = [];
  const accessRe = /request\.(query|params)\.([A-Z_a-z]\w*)|request\.params\["\*"]/g;
  let match: RegExpExecArray | null;
  while ((match = accessRe.exec(content)) !== null) {
    const name = match[2];
    if (name !== undefined && !isPathLikeName(name)) continue;
    const lineNo = lineNumberAt(content, match.index);
    if (isContainedNearby(lines, lineNo)) continue;
    findings.push({ file: filePath, line: lineNo, text: lineTextAt(content, lineNo) });
  }
  return findings;
}

/**
 * (iii) `path.join(boxRoot, contextDir)` / `path.resolve(boxRoot, contextDir)`
 * in a file with no containment-helper call anywhere in it. Restricted to the
 * single identifier `contextDir` — the one name that has twice carried
 * request-influenced input into `beebox/src/core/**` without containment
 * (`landmark/features.ts`, `chat/session/history.ts`). A broader identifier
 * set (`dir`, `relPath`, `cardPath`, `inputPath`, ...) was tried first and
 * was overwhelmingly internal walkers re-joining a `relPath` they produced
 * themselves (24 of the resulting lines) — noise the adjudicator would have
 * re-triaged every week for no new signal, not a second real leak shape.
 */
export function scanCoreBoxRootJoins(content: string, filePath: string): StaticFinding[] {
  if (fileHasContainmentHelper(content)) return [];
  const findings: StaticFinding[] = [];
  const joinRe = /path\.(?:join|resolve)\(\s*boxRoot\s*,\s*(contextDir)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = joinRe.exec(content)) !== null) {
    const lineNo = lineNumberAt(content, match.index);
    findings.push({ file: filePath, line: lineNo, text: lineTextAt(content, lineNo) });
  }
  return findings;
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".ts")).map((e) => path.join(dir, e.name));
  } catch (_e) {
    return [];
  }
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries: { name: string; parentPath: string; isFile: () => boolean; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  } catch (_e) {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.join(e.parentPath, e.name));
}

/** One line per candidate, `static  <file>:<line>  <text>`, `<file>` relative
 *  to `repoRoot` with forward slashes so the report is stable across
 *  checkouts. */
export function formatFinding(finding: StaticFinding): string {
  return `static  ${finding.file}:${String(finding.line)}  ${finding.text}`;
}

/** Run all three matchers over the fixed set of files this leak shape lives
 *  in, relative to `repoRoot` so this runs the same from any checkout
 *  (worktree, prod's `/opt/beebox/beebox`, ...). */
export async function runStaticSweep(repoRoot: string): Promise<string[]> {
  const routerRootFiles = await listFiles(path.join(repoRoot, "beebox", "src", "webapp"));
  const routeFiles = await listFiles(path.join(repoRoot, "beebox", "src", "webapp", "routes"));
  const trpcRouterFiles = await listFiles(path.join(repoRoot, "beebox", "src", "webapp", "trpc", "routers"));
  const coreFiles = await listFilesRecursive(path.join(repoRoot, "beebox", "src", "core"));

  const lines: string[] = [];
  for (const abs of [...routerRootFiles, ...routeFiles, ...trpcRouterFiles]) {
    const content = await fs.readFile(abs, "utf8");
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    for (const finding of scanZodStringFields(content, rel)) lines.push(formatFinding(finding));
    for (const finding of scanRawRequestAccess(content, rel)) lines.push(formatFinding(finding));
  }
  for (const abs of coreFiles) {
    const content = await fs.readFile(abs, "utf8");
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    for (const finding of scanCoreBoxRootJoins(content, rel)) lines.push(formatFinding(finding));
  }
  return lines;
}
