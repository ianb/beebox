/**
 * The document-comments store — where a comment lives, and the ONLY module that
 * decides that.
 *
 * Comments are a communication medium, not repository state: the boxholder
 * leaves a remark on a document, an agent reads it, acts, and clears it. They
 * never reach git, and they must survive a worktree cull — the third
 * persistence class the exhibits store established
 * (`callback-box/docs/plans/workstream-exhibits.md`), so the root derivation,
 * marker guard, and containment posture here deliberately mirror
 * `workstreams-app/src/server/exhibits/store.ts` without importing it (the
 * resident-app precedent is to share patterns, not source, and `bin/` and the
 * app do not import across their package boundary at all).
 *
 * Design: `callback-box/docs/plans/document-comments.md`.
 *
 * TWO NAMESPACES, because a repository-relative path is not a unique document:
 *   tracked/<repo-relative>.comments.yaml            — follows the file everywhere
 *   worktree/<name>/<repo-relative>.comments.yaml    — stays where it was written
 * A tracked file is the same file in every checkout, so a comment on it should
 * be found wherever it is next opened. An untracked one is not: two worktrees
 * routinely hold entirely different `scratch/notes.md`, and one namespace would
 * silently merge their comments.
 *
 * The store is untrusted input (an agent, a human, and an app all write here),
 * so every segment is validated, every resolved path is re-checked after
 * realpath, and a file that does not parse is REPORTED rather than read as
 * empty — claiming "no comments" would hide the boxholder's words.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

// The canonical guards, rather than an `as` cast on a caught `unknown`
// (`callback-box/code-style.md`). bin/ already imports from callback-box —
// see bin/router-auth.ts.
import { errnoCode, errorMessage } from "../../callback-box/src/lib/error-guards.js";

/** Written when the store root is created; nothing writes to an unmarked directory. */
export const STORE_MARKER = ".dev-comments";

/** Suffix of every comments file, mirroring the document it belongs to. */
export const COMMENTS_SUFFIX = ".comments.yaml";

/** The current on-disk shape. Bumped only for a change old readers cannot handle. */
export const STORE_VERSION = 1;

/**
 * How the text arrived. Deliberately the same field and values as callback-box's
 * interactive input (`src/frontend/src/input/emission.ts:44`, and the wire
 * contract at `docs/mobile-contract.md:262`) — this tool does not share that
 * schema, but a developer reading both should not hold two words for one idea.
 * `voice` records how the text arrived, not that it is verbatim: the boxholder
 * may have edited the transcript before submitting.
 */
export const commentOriginSchema = z.enum(["typed", "voice"]);

export const commentSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  origin: commentOriginSchema,
  /** What the boxholder said. */
  body: z.string().min(1),
  /** The selected text, verbatim. Absent for a whole-document comment. */
  quoted: z.string().optional(),
  /** The enclosing heading, as plain text. */
  section: z.string().optional(),
  /** Which workstream this remark is for; null when nothing has touched the file. */
  workstream: z.string().nullable(),
  /** Where it was written. Not the same question as `workstream`. */
  worktree: z.string(),
  /** Serialized text fragment, when one could be generated. Best-effort by design. */
  fragment: z.string().optional(),
});

export const commentsFileSchema = z.object({
  version: z.literal(STORE_VERSION),
  comments: z.array(commentSchema),
});

export type Comment = z.infer<typeof commentSchema>;
export type CommentsFile = z.infer<typeof commentsFileSchema>;

/** Which namespace a document lives in, and its repository-relative path. */
export type Subject =
  | { scope: "tracked"; relPath: string }
  | { scope: "worktree"; worktree: string; relPath: string };

export class InvalidCommentPathError extends Error {
  constructor(detail: string) {
    super(`invalid comment path: ${detail}`);
    this.name = "InvalidCommentPathError";
  }
}

export class UninitializedCommentStoreError extends Error {
  constructor(public readonly storeRoot: string) {
    super(`comment store ${storeRoot} is missing its ${STORE_MARKER} marker`);
    this.name = "UninitializedCommentStoreError";
  }
}

/**
 * The store sits beside the MAIN checkout, matching how the exhibits store
 * derives its root. `CALLBACK_COMMENTS_ROOT` overrides, for tests and for a
 * non-standard layout.
 */
export function defaultStoreRoot(mainRoot: string): string {
  const override = process.env["CALLBACK_COMMENTS_ROOT"];
  if (override !== undefined && override !== "") return path.resolve(override);
  return path.join(path.dirname(path.resolve(mainRoot)), "dev-comments");
}

/** A worktree name is one path segment — the same rule `wt_paths_valid_name` enforces. */
function validWorktreeName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/u.test(name);
}

/**
 * Reject anything that is not a plain repository-relative path BEFORE it is
 * joined to a root. An unchecked `..` here is a write outside the store.
 */
function assertRelPath(relPath: string): void {
  if (relPath === "") throw new InvalidCommentPathError("empty path");
  if (path.isAbsolute(relPath)) throw new InvalidCommentPathError(`absolute path: ${relPath}`);
  const normalized = path.normalize(relPath);
  if (normalized.startsWith("..") || normalized.split(path.sep).includes("..")) {
    throw new InvalidCommentPathError(`path escapes the repository: ${relPath}`);
  }
  if (normalized !== relPath) {
    throw new InvalidCommentPathError(`path is not normalized: ${relPath}`);
  }
}

/** The store-relative path of a subject's comments file. */
export function subjectKey(subject: Subject): string {
  assertRelPath(subject.relPath);
  if (subject.scope === "tracked") {
    return path.join("tracked", `${subject.relPath}${COMMENTS_SUFFIX}`);
  }
  if (!validWorktreeName(subject.worktree)) {
    throw new InvalidCommentPathError(`not a worktree name: ${subject.worktree}`);
  }
  return path.join("worktree", subject.worktree, `${subject.relPath}${COMMENTS_SUFFIX}`);
}

/**
 * Resolve a subject to an absolute path, re-checking containment after the join.
 * The `..` guard above is the first line; this is the one that holds if the
 * guard is ever loosened.
 */
export function commentsFilePath(storeRoot: string, subject: Subject): string {
  const root = path.resolve(storeRoot);
  const resolved = path.resolve(root, subjectKey(subject));
  const relative = path.relative(root, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new InvalidCommentPathError(`resolves outside the store: ${subject.relPath}`);
  }
  return resolved;
}

/** Create the store root and its marker. Idempotent. */
export async function initStore(storeRoot: string): Promise<void> {
  const root = path.resolve(storeRoot);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, STORE_MARKER), `${STORE_VERSION}\n`, "utf8");
}

/**
 * Refuse to write to a directory that is not a comment store. Without this, a
 * mistyped `CALLBACK_COMMENTS_ROOT` scatters files into an unrelated tree.
 */
export async function assertStoreInitialized(storeRoot: string): Promise<void> {
  const marker = path.join(path.resolve(storeRoot), STORE_MARKER);
  const exists = await fs.stat(marker).then(() => true, () => false);
  if (!exists) throw new UninitializedCommentStoreError(path.resolve(storeRoot));
}

/**
 * What a read found. `problem` is set when the file exists but could not be
 * used — a parse error, a schema mismatch, a symlink. `comments` is empty in
 * that case, and callers MUST surface `problem` rather than reporting "none".
 */
export interface CommentsRead {
  comments: Comment[];
  problem: string | null;
}

const EMPTY: CommentsRead = { comments: [], problem: null };

function readProblem(detail: string): CommentsRead {
  return { comments: [], problem: detail };
}

/**
 * Read one subject's comments. Never throws for a bad file: a store written by
 * three different writers will eventually contain something malformed, and the
 * useful response is to name it.
 */
export async function readComments(storeRoot: string, subject: Subject): Promise<CommentsRead> {
  const file = commentsFilePath(storeRoot, subject);
  const isSymlink = await fs.lstat(file).then((stats) => stats.isSymbolicLink(), () => false);
  if (isSymlink) return readProblem(`${file} is a symlink; refused rather than followed`);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    const code = errnoCode(e);
    if (code === "ENOENT" || code === "ENOTDIR") return EMPTY;
    return readProblem(`${file} could not be read: ${errorMessage(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    return readProblem(`${file} is not valid YAML: ${errorMessage(e)}`);
  }
  const result = commentsFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return readProblem(`${file} does not match the comments schema — ${issues.join("; ")}`);
  }
  return { comments: result.data.comments, problem: null };
}

/**
 * In-process serialization of read-modify-write on one file. Two browser tabs
 * commenting on one document land in the same process, and a lost update there
 * is invisible to any file lock — the same problem `card-lock.ts` solves in
 * callback-box, kept separate from cross-process locking because it is a
 * different problem.
 */
const writeChains = new Map<string, Promise<unknown>>();

function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(file) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  writeChains.set(file, next.catch(() => undefined));
  return next;
}

/** Replace a file's whole contents without a window where it is truncated. */
async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${String(Math.floor(performance.now() * 1000))}.tmp`;
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, file);
}

function serialize(comments: Comment[]): string {
  const file: CommentsFile = { version: STORE_VERSION, comments };
  return stringifyYaml(file, { lineWidth: 0 });
}

/**
 * Append one comment. Refuses when the existing file is unusable: overwriting a
 * file we could not read would destroy remarks the boxholder can still see on
 * disk.
 */
export async function appendComment(
  storeRoot: string,
  params: { subject: Subject; comment: Comment },
): Promise<void> {
  await assertStoreInitialized(storeRoot);
  const file = commentsFilePath(storeRoot, params.subject);
  const parsedComment = commentSchema.parse(params.comment);
  await withFileLock(file, async () => {
    const current = await readComments(storeRoot, params.subject);
    if (current.problem !== null) {
      throw new InvalidCommentPathError(
        `refusing to append over an unreadable file — ${current.problem}`,
      );
    }
    await writeFileAtomic(file, serialize([...current.comments, parsedComment]));
  });
}

/**
 * Remove handled comments. Without `id`, clears the subject entirely (the file
 * is removed rather than left as an empty list, so a listing shows nothing
 * waiting). Returns how many were removed.
 */
export async function clearComments(
  storeRoot: string,
  params: { subject: Subject; id?: string },
): Promise<number> {
  await assertStoreInitialized(storeRoot);
  const file = commentsFilePath(storeRoot, params.subject);
  return withFileLock(file, async () => {
    const current = await readComments(storeRoot, params.subject);
    if (current.problem !== null) {
      throw new InvalidCommentPathError(`refusing to clear an unreadable file — ${current.problem}`);
    }
    const { id } = params;
    if (id === undefined) {
      await fs.rm(file, { force: true });
      return current.comments.length;
    }
    const remaining = current.comments.filter((comment) => comment.id !== id);
    const removed = current.comments.length - remaining.length;
    if (removed === 0) return 0;
    if (remaining.length === 0) await fs.rm(file, { force: true });
    else await writeFileAtomic(file, serialize(remaining));
    return removed;
  });
}

/** One document's worth of comments, as a listing reports it. */
export interface StoreEntry {
  subject: Subject;
  comments: Comment[];
  problem: string | null;
}

async function walkCommentFiles(dir: string, found: string[]): Promise<void> {
  const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) await walkCommentFiles(full, found);
    else if (dirent.isFile() && dirent.name.endsWith(COMMENTS_SUFFIX)) found.push(full);
  }
}

function subjectFromStorePath(storeRelative: string): Subject | null {
  const segments = storeRelative.split(path.sep);
  const [namespace, ...rest] = segments;
  const strip = (parts: string[]): string => path.join(...parts).slice(0, -COMMENTS_SUFFIX.length);
  if (namespace === "tracked" && rest.length > 0) {
    return { scope: "tracked", relPath: strip(rest) };
  }
  if (namespace === "worktree" && rest.length > 1) {
    const [worktree, ...relParts] = rest;
    if (worktree === undefined) return null;
    return { scope: "worktree", worktree, relPath: strip(relParts) };
  }
  return null;
}

/**
 * Every document with comments waiting. The store holds a handful of small
 * files, so a full walk is the right answer — and it is what lets one
 * file-keyed store answer both "what is on this document" and "what is
 * addressed to this workstream".
 */
export async function listAll(storeRoot: string): Promise<StoreEntry[]> {
  const root = path.resolve(storeRoot);
  const files: string[] = [];
  await walkCommentFiles(root, files);
  const entries: StoreEntry[] = [];
  for (const file of files.sort()) {
    const subject = subjectFromStorePath(path.relative(root, file));
    if (subject === null) continue;
    const read = await readComments(root, subject);
    if (read.comments.length === 0 && read.problem === null) continue;
    entries.push({ subject, comments: read.comments, problem: read.problem });
  }
  return entries;
}

/** Newest first, by `at`. The order both readings of the store want. */
export function byNewest(comments: Comment[]): Comment[] {
  return [...comments].sort((a, b) => b.at.localeCompare(a.at));
}

/** A short, collision-resistant id. Not a UUID — these are read aloud in terminals. */
export function newCommentId(): string {
  return `c-${os.userInfo().username.slice(0, 2)}${Math.floor(performance.now() * 1000).toString(36).slice(-6)}`;
}
