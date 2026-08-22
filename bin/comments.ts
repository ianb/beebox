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
 * and clears it. Nothing expires on its own.
 *
 * Design: callback-box/docs/plans/document-comments.md
 * Store:  bin/lib/comments-store.ts (root derivation, namespaces, containment)
 */

import * as path from "node:path";
import { execa } from "execa";

import {
  byNewest,
  clearComments,
  defaultStoreRoot,
  listAll,
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

async function subjectFor(context: Context, input: string): Promise<Subject> {
  const relPath = toRepoRelative(context, input);
  if (await isTracked(context.repoRoot, relPath)) return { scope: "tracked", relPath };
  return { scope: "worktree", worktree: context.worktree, relPath };
}

function describeSubject(subject: Subject): string {
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
  const head = `${describeSubject(entry.subject)}  (${String(entry.comments.length)})`;
  const problem = entry.problem === null ? [] : [`  ! ${entry.problem}`];
  return [head, ...problem, ...byNewest(entry.comments).map(renderComment)].join("\n");
}

async function commandShow(context: Context, args: string[]): Promise<number> {
  const [target] = args;
  if (target === undefined) {
    process.stderr.write("comments show: needs a path\n");
    return 2;
  }
  const storeRoot = defaultStoreRoot(context.mainRoot);
  const subject = await subjectFor(context, target);
  const read = await readComments(storeRoot, subject);
  // A file we could not parse is NOT "no comments" — saying so would hide the
  // boxholder's words behind a shrug.
  if (read.problem !== null) {
    process.stderr.write(`comments show: ${read.problem}\n`);
    return 1;
  }
  if (read.comments.length === 0) {
    process.stdout.write(`No comments on ${describeSubject(subject)}.\n`);
    return 0;
  }
  process.stdout.write(`${renderEntry({ subject, comments: read.comments, problem: null })}\n`);
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
  const [target, ...rest] = args;
  if (target === undefined) {
    process.stderr.write("comments clear: needs a path\n");
    return 2;
  }
  const idFlag = rest.indexOf("--id");
  const id = idFlag === -1 ? undefined : rest[idFlag + 1];
  if (idFlag !== -1 && id === undefined) {
    process.stderr.write("comments clear: --id needs a value\n");
    return 2;
  }
  const storeRoot = defaultStoreRoot(context.mainRoot);
  const subject = await subjectFor(context, target);
  const removed = await clearComments(storeRoot, id === undefined ? { subject } : { subject, id });
  if (removed === 0) {
    process.stdout.write(`Nothing to clear on ${describeSubject(subject)}.\n`);
    return 0;
  }
  process.stdout.write(`Cleared ${String(removed)} on ${describeSubject(subject)}.\n`);
  return 0;
}

async function dispatch(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }
  const context = await resolveContext();
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
