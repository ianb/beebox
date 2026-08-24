/**
 * `bin/comments` — read the document-comment store from a terminal.
 *
 * Comments are the boxholder talking to an agent about a document: a remark
 * anchored to a span, written from the browser, waiting in a store outside git.
 * This is the agent's half of that channel, and for now the whole of it — the
 * store and this CLI are useful before any UI exists.
 *
 * Two questions, one store:
 *   comments show <path>              what is on this document (the reader's question)
 *   comments list [--workstream <w>]  what is waiting / what is addressed to me
 *
 * Plus `clear`, which is how a comment stops waiting: an agent reads it, acts,
 * and clears it. Nothing expires on its own — and `add`, which the workstreams
 * app calls when the boxholder writes a comment in the browser.
 *
 * THIS CLI IS THE ONLY WRITER. The app shells out to it rather than reaching
 * into the store itself, following the precedent bin/CLAUDE.md records for the
 * same app: "the app invokes the stable bin/workstreams CLI instead of
 * reimplementing lifecycle guards." Two implementations of one write protocol —
 * the same YAML, the same locking, the same containment — is where duplication
 * stops being controllable, so there is one.
 *
 * `--json` on any command emits machine-readable output for that caller.
 *
 * Design: callback-box/docs/plans/document-comments.md
 * Store:  bin/lib/comments-store.ts (root derivation, namespaces, containment)
 */

import * as path from "node:path";
import { execa } from "execa";

import {
  appendComment,
  byNewest,
  clearComments,
  commentSchema,
  defaultStoreRoot,
  initStore,
  listAll,
  newCommentId,
  readComments,
  type Comment,
  type StoreEntry,
  type Subject,
} from "./lib/comments-store.js";

const USAGE = `usage: bin/comments <command>

  show <path>                     Comments on one document. Accepts an absolute,
                                  repository-relative, or worktree-relative path.
  list [--workstream <name>]      Every document with comments waiting, newest
                                  first. --workstream narrows to what is
                                  addressed to that workstream.
  clear <path> [--id <id>]        Remove handled comments. Without --id, clears
                                  the document.
  add <path> --body <text>        Write a comment. --origin typed|voice,
                                  --workstream <name> (who it is FOR),
                                  --worktree <name> (which checkout's namespace,
                                  for untracked files; defaults to this one),
                                  --quoted/--section/--fragment <text>.

  --json                          Machine-readable output (any command).

Comments never reach git. Read them, act, then clear them.
`;

/** Where the repository is, and which worktree we are standing in. */
interface Context {
  repoRoot: string;
  mainRoot: string;
  worktree: string;
}

/**
 * `git rev-parse --show-toplevel` gives this checkout; `--path-format=absolute
 * --git-common-dir` gives the shared `.git`, whose parent is the MAIN checkout
 * even from inside a worktree. The store hangs off main, so both are needed.
 */
async function resolveContext(): Promise<Context> {
  const { stdout: top } = await execa("git", ["rev-parse", "--show-toplevel"]);
  const { stdout: common } = await execa("git", [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const repoRoot = top.trim();
  const mainRoot = path.dirname(common.trim());
  return { repoRoot, mainRoot, worktree: path.basename(repoRoot) };
}

/** Is this path tracked by git? Decides which namespace holds its comments. */
async function isTracked(repoRoot: string, relPath: string): Promise<boolean> {
  const result = await execa("git", ["ls-files", "--error-unmatch", "--", relPath], {
    cwd: repoRoot,
    reject: false,
  });
  return result.exitCode === 0;
}

/**
 * Accept a path in any spelling the developer or agent has to hand — absolute,
 * repository-relative, or relative to the current directory. Refusing a
 * plausible spelling is the kind of friction that stops a tool being used.
 */
function toRepoRelative(context: Context, input: string): string {
  const absolute = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  const relative = path.relative(context.repoRoot, absolute);
  if (relative === "" || relative.startsWith("..")) {
    // Not under this checkout; treat it as already repository-relative.
    return path.normalize(input);
  }
  return relative;
}

/**
 * BOTH namespaces a path could hold comments in, current-status-first.
 *
 * `worktree` names the UNTRACKED namespace. It defaults to the checkout this
 * CLI is running in, which is right for an agent at a terminal — but the app
 * runs from the MAIN checkout while the developer reads another workstream's
 * file through a lens, so it passes the lens explicitly. Without that, a
 * comment on `scratch/foo.md` viewed as `dev-comments` would be filed under
 * `worktree/main/` and the agent in `dev-comments` would never see it.
 *
 * Tracked status is not stable: a `scratch/notes.md` commented while untracked
 * and later committed would, if we consulted only its CURRENT namespace, report
 * "no comments" for remarks sitting on disk — and `clear` could not reach them
 * by path. So every read and every clear considers both, and the ordering only
 * decides which one a NEW comment would be written to.
 */
async function subjectsFor(
  context: Context,
  target: { path: string; worktree?: string | undefined },
): Promise<Subject[]> {
  const relPath = toRepoRelative(context, target.path);
  const worktree = target.worktree === undefined || target.worktree === ""
    ? context.worktree
    : target.worktree;
  const tracked: Subject = { scope: "tracked", relPath };
  const local: Subject = { scope: "worktree", worktree, relPath };
  return (await isTracked(context.repoRoot, relPath)) ? [tracked, local] : [local, tracked];
}

function describeSubject(subject: Subject | null, storePath: string): string {
  if (subject === null) return `${storePath} (unreadable entry)`;
  return subject.scope === "tracked" ? subject.relPath : `${subject.relPath} (${subject.worktree})`;
}

function renderComment(comment: Comment): string {
  const lines: string[] = [];
  const routed = comment.workstream === null ? "unrouted" : `→ ${comment.workstream}`;
  lines.push(`  ${comment.at}  ${comment.origin}  ${routed}  [${comment.id}]`);
  if (comment.section !== undefined) lines.push(`    § ${comment.section}`);
  if (comment.quoted !== undefined) lines.push(`    > ${comment.quoted}`);
  for (const line of comment.body.split("\n")) lines.push(`    ${line}`);
  return lines.join("\n");
}

function renderEntry(entry: StoreEntry): string {
  const head = `${describeSubject(entry.subject, entry.storePath)}  (${String(entry.comments.length)})`;
  const problem = entry.problem === null ? [] : [`  ! ${entry.problem}`];
  return [head, ...problem, ...byNewest(entry.comments).map(renderComment)].join("\n");
}

/**
 * Flags that take a value, which they consume UNCONDITIONALLY.
 *
 * A parser that skips a value beginning with `--` cannot carry the boxholder's
 * own words: a comment body of "-- actually, no" would arrive empty. These
 * values are user text, so the flag name is the only thing that decides.
 */
const VALUE_FLAGS = new Set(["body", "origin", "workstream", "worktree", "quoted", "section", "fragment", "id"]);

/** Read `--flag value` pairs without pulling in an argument parser. */
function flags(args: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (!VALUE_FLAGS.has(name)) continue;
    const next = args[i + 1];
    if (next === undefined) {
      found.set(name, "");
      continue;
    }
    found.set(name, next);
    i += 1;
  }
  return found;
}

function wantsJson(args: string[]): boolean {
  return args.includes("--json");
}

/**
 * Write one comment. The caller supplies what it knows; the store validates.
 * `--workstream` absent means unrouted, which is a real state — commenting on a
 * file nobody is working on is how new work starts.
 */
async function commandAdd(context: Context, args: string[]): Promise<number> {
  const [target] = args;
  if (target === undefined || target.startsWith("--")) {
    process.stderr.write("comments add: needs a path\n");
    return 2;
  }
  const options = flags(args);
  const body = options.get("body");
  if (body === undefined || body === "") {
    process.stderr.write("comments add: --body is required\n");
    return 2;
  }
  const origin = options.get("origin") ?? "typed";
  if (origin !== "typed" && origin !== "voice") {
    process.stderr.write(`comments add: --origin must be typed or voice, got '${origin}'\n`);
    return 2;
  }

  const storeRoot = defaultStoreRoot(context.mainRoot);
  await initStore(storeRoot);
  const [subject] = await subjectsFor(context, { path: target, worktree: options.get("worktree") });
  if (subject === undefined) {
    process.stderr.write("comments add: could not resolve a subject\n");
    return 2;
  }
  const workstream = options.get("workstream");
  const comment = commentSchema.parse({
    id: newCommentId(),
    at: new Date().toISOString(),
    origin,
    body,
    workstream: workstream === undefined || workstream === "" ? null : workstream,
    worktree: context.worktree,
    ...(options.get("quoted") === undefined ? {} : { quoted: options.get("quoted") }),
    ...(options.get("section") === undefined ? {} : { section: options.get("section") }),
    ...(options.get("fragment") === undefined ? {} : { fragment: options.get("fragment") }),
  });
  await appendComment(storeRoot, { subject, comment });
  if (wantsJson(args)) {
    process.stdout.write(`${JSON.stringify({ id: comment.id, subject })}\n`);
    return 0;
  }
  process.stdout.write(`Added ${comment.id} on ${describeSubject(subject, target)}.\n`);
  return 0;
}

async function commandShow(context: Context, args: string[]): Promise<number> {
  const [target] = args;
  if (target === undefined) {
    process.stderr.write("comments show: needs a path\n");
    return 2;
  }
  const storeRoot = defaultStoreRoot(context.mainRoot);
  const subjects = await subjectsFor(context, { path: target, worktree: flags(args).get("worktree") });
  const found: StoreEntry[] = [];
  for (const subject of subjects) {
    const read = await readComments(storeRoot, subject);
    // A file we could not parse is NOT "no comments" — saying so would hide the
    // boxholder's words behind a shrug.
    if (read.problem !== null) {
      process.stderr.write(`comments show: ${read.problem}\n`);
      return 1;
    }
    if (read.comments.length > 0) {
      found.push({ subject, storePath: "", comments: read.comments, problem: null });
    }
  }
  if (wantsJson(args)) {
    process.stdout.write(`${JSON.stringify({ entries: found.map((entry) => ({ subject: entry.subject, comments: byNewest(entry.comments) })) })}\n`);
    return 0;
  }
  if (found.length === 0) {
    process.stdout.write(`No comments on ${describeSubject(subjects[0] ?? null, target)}.\n`);
    return 0;
  }
  process.stdout.write(`${found.map(renderEntry).join("\n\n")}\n`);
  return 0;
}

async function commandList(context: Context, args: string[]): Promise<number> {
  let workstream: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--workstream") {
      const value = args[i + 1];
      if (value === undefined) {
        process.stderr.write("comments list: --workstream needs a name\n");
        return 2;
      }
      workstream = value;
      i += 1;
    }
  }
  const storeRoot = defaultStoreRoot(context.mainRoot);
  const entries = await listAll(storeRoot);
  const filtered = workstream === null
    ? entries
    : entries
        .map((entry) => ({
          ...entry,
          comments: entry.comments.filter((comment) => comment.workstream === workstream),
        }))
        .filter((entry) => entry.comments.length > 0 || entry.problem !== null);
  if (wantsJson(args)) {
    process.stdout.write(`${JSON.stringify({
      entries: filtered.map((entry) => ({
        subject: entry.subject,
        storePath: entry.storePath,
        problem: entry.problem,
        comments: byNewest(entry.comments),
      })),
    })}\n`);
    return 0;
  }
  if (filtered.length === 0) {
    const scope = workstream === null ? "" : ` for ${workstream}`;
    process.stdout.write(`Nothing waiting${scope}.\n`);
    return 0;
  }
  // Newest document first, so "what did I just say" is at the top.
  const ordered = [...filtered].sort((a, b) => {
    const latest = (entry: StoreEntry): string => byNewest(entry.comments)[0]?.at ?? "";
    return latest(b).localeCompare(latest(a));
  });
  process.stdout.write(`${ordered.map(renderEntry).join("\n\n")}\n`);
  return 0;
}

async function commandClear(context: Context, args: string[]): Promise<number> {
  const [target] = args;
  if (target === undefined || target.startsWith("--")) {
    process.stderr.write("comments clear: needs a path\n");
    return 2;
  }
  const options = flags(args);
  const rawId = options.get("id");
  if (options.has("id") && (rawId === undefined || rawId === "")) {
    process.stderr.write("comments clear: --id needs a value\n");
    return 2;
  }
  const id = rawId === "" ? undefined : rawId;
  const storeRoot = defaultStoreRoot(context.mainRoot);
  const subjects = await subjectsFor(context, { path: target, worktree: options.get("worktree") });
  let removed = 0;
  // Both namespaces: a file's tracked status may have changed since the comment
  // was written, and a comment you cannot clear by path is a comment that waits
  // forever.
  for (const subject of subjects) {
    removed += await clearComments(storeRoot, id === undefined ? { subject } : { subject, id });
  }
  const label = describeSubject(subjects[0] ?? null, target);
  if (removed === 0) {
    process.stdout.write(`Nothing to clear on ${label}.\n`);
    return 0;
  }
  process.stdout.write(`Cleared ${String(removed)} on ${label}.\n`);
  return 0;
}

async function dispatch(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }
  const context = await resolveContext();
  if (command === "add") return commandAdd(context, args);
  if (command === "show") return commandShow(context, args);
  if (command === "list") return commandList(context, args);
  if (command === "clear") return commandClear(context, args);
  process.stderr.write(`comments: unknown command '${command}'\n\n${USAGE}`);
  return 2;
}

/**
 * A refusal from the store is information, not a crash: an uninitialized store
 * or a path that escapes it should read as one sentence, not a Node stack
 * trace. `CB_COMMENTS_DEBUG=1` keeps the stack for the case where the message
 * is not enough.
 */
async function main(): Promise<number> {
  try {
    return await dispatch();
  } catch (e) {
    if (process.env["CB_COMMENTS_DEBUG"] === "1") throw e;
    process.stderr.write(`comments: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

process.exitCode = await main();
