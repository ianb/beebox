// Reading one browsable path out of a checkout, for the general browser
// (beebox/docs/plans/general-browser.md).
//
// THE ADDRESS IS THE FILE. A path is repository-relative and a workstream is a
// LENS over it (`workstream: null` reads main), never a segment you enter
// first. That is the boxholder's constraint — "enter a universal view, then
// filter by workstream if I care to, as opposed to going into a workstream
// like the current workstream-name/dev/ does" — and it is why this module
// takes `{ relPath, workstream }` rather than a rooted path.
//
// This is an untrusted boundary: `relPath` arrives from a URL. Containment is
// re-checked after realpath, and it deliberately reimplements the shape of
// issue-path.ts rather than importing it — the resident-app precedent is to
// share patterns, not source (see exhibits/store.ts:9-12), and these two roots
// have different vocabularies.

import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import type { BrowsedDocument, DirectoryEntry, DocumentKind } from "../shared/documents.js";
import { emptyChanges, workstreamsForPath, type WorkstreamChanges } from "./workstream-changes.js";

export class InvalidDocumentPathError extends Error {
  constructor(relPath: string) {
    super(`invalid document path: ${relPath}`);
    this.name = "InvalidDocumentPathError";
  }
}

export class DocumentNotFoundError extends Error {
  constructor(relPath: string) {
    super(`no such path: ${relPath}`);
    this.name = "DocumentNotFoundError";
  }
}

export class UnknownWorkstreamError extends Error {
  constructor(name: string) {
    super(`no worktree named ${name}`);
    this.name = "UnknownWorkstreamError";
  }
}

/**
 * Read at most this much text. A browser that streams a 40 MB minified bundle
 * into a React tree helps nobody; past the cap the document reports why rather
 * than hanging.
 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const PAGE_EXTENSIONS = new Set([".html", ".htm"]);
const DATA_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".csv"]);

/**
 * Extension-driven, because that is what the developer sees in the path. A
 * file with no extension reads as code — the common case is a shell script or
 * a dotfile, and code is the renderer that degrades best.
 */
export function kindForPath(relPath: string): DocumentKind {
  const ext = path.extname(relPath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (PAGE_EXTENSIONS.has(ext)) return "page";
  if (DATA_EXTENSIONS.has(ext)) return "data";
  return "code";
}

function assertContained(options: { root: string; target: string; relPath: string }): void {
  const relative = path.relative(options.root, options.target);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new InvalidDocumentPathError(options.relPath);
  }
}

/**
 * Resolve a repository-relative path inside a checkout, refusing traversal and
 * symlink escape rather than clamping. `""` is legal and means the repository
 * root, which is a directory listing.
 */
export async function resolveDocumentPath(root: string, relPath: string): Promise<string> {
  if (relPath.includes("\0")) throw new InvalidDocumentPathError(relPath);
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, relPath);
  assertContained({ root: resolvedRoot, target: resolvedTarget, relPath });

  // realpath both sides: a symlink anywhere along the path could otherwise
  // point outside the checkout while the lexical check above still passes.
  const canonicalRoot = await fs.realpath(resolvedRoot);
  const canonicalTarget = await fs.realpath(resolvedTarget).catch((e: unknown) => {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw e;
  });

  // "You asked for something outside this checkout" and "that path is not
  // here" are different answers and must not arrive as the same one — the
  // first is a refusal, the second is a 404 the browser can render. A path
  // that does not exist still has to prove it WOULD have been contained, so
  // the nearest existing ancestor is canonicalized and checked; otherwise
  // `../../etc/nonexistent` would report as a plain miss.
  if (canonicalTarget === null) {
    await assertMissingPathWouldBeContained({ canonicalRoot, resolvedTarget, relPath });
    throw new DocumentNotFoundError(relPath);
  }
  assertContained({ root: canonicalRoot, target: canonicalTarget, relPath });
  return canonicalTarget;
}

/**
 * Walk up from a non-existent path to the nearest ancestor that does exist,
 * canonicalize THAT, and require it to be inside the checkout. Without this a
 * traversal that happens to name a missing file would be reported as a plain
 * 404 and the refusal would go unsaid.
 */
async function assertMissingPathWouldBeContained(params: {
  canonicalRoot: string;
  resolvedTarget: string;
  relPath: string;
}): Promise<void> {
  const { canonicalRoot, resolvedTarget, relPath } = params;
  let ancestor = path.dirname(resolvedTarget);
  for (;;) {
    const canonical = await fs.realpath(ancestor).catch(() => null);
    if (canonical !== null) {
      assertContained({ root: canonicalRoot, target: canonical, relPath });
      return;
    }
    const parent = path.dirname(ancestor);
    // Reached the filesystem root without finding anything real: nothing here
    // can be proven contained, so refuse rather than guess.
    if (parent === ancestor) throw new InvalidDocumentPathError(relPath);
    ancestor = parent;
  }
}

/** Which checkout a lens reads from. `null` is the main checkout. */
export interface CheckoutRoots {
  mainRoot: string;
  worktreeRoots: Map<string, string>;
}

export function rootForWorkstream(roots: CheckoutRoots, workstream: string | null): string {
  if (workstream === null) return roots.mainRoot;
  const root = roots.worktreeRoots.get(workstream);
  if (root === undefined) throw new UnknownWorkstreamError(workstream);
  return root;
}

async function isTracked(root: string, relPath: string): Promise<boolean> {
  if (relPath === "") return false;
  const result = await execa("git", ["ls-files", "--error-unmatch", "-z", "--", relPath], {
    cwd: root,
    reject: false,
  });
  return result.exitCode === 0;
}

/**
 * A NUL byte in the first few KB is the standard "this is not text" heuristic,
 * and it is the right one here: we are deciding whether to hand bytes to a
 * renderer, not identifying a format.
 */
function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

async function readDirectory(
  absolute: string,
  listing: { relPath: string },
): Promise<DirectoryEntry[]> {
  const { relPath } = listing;
  const dirents = await fs.readdir(absolute, { withFileTypes: true });
  return dirents
    .filter((dirent) => !dirent.name.startsWith("."))
    .map((dirent) => ({
      name: dirent.name,
      relPath: relPath === "" ? dirent.name : `${relPath}/${dirent.name}`,
      kind: dirent.isDirectory() ? ("directory" as const) : kindForPath(dirent.name),
    }))
    .toSorted((a, b) => {
      if ((a.kind === "directory") !== (b.kind === "directory")) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Read one path as a document. Never returns partially-true content: when the
 * bytes are not served, `text` is null and `problem` says why, so a caller can
 * render the reason instead of an empty pane.
 */
export async function readDocument(
  roots: CheckoutRoots,
  request: { relPath: string; workstream: string | null; changes?: WorkstreamChanges },
): Promise<BrowsedDocument> {
  const { relPath, workstream } = request;
  const changes = request.changes ?? emptyChanges();
  const lens = {
    changedIn: workstreamsForPath(changes, relPath),
    changesUnavailable: [...changes.unavailable.keys()],
  };
  const root = rootForWorkstream(roots, workstream);
  const absolute = await resolveDocumentPath(root, relPath);
  const stats = await fs.stat(absolute);

  if (stats.isDirectory()) {
    return {
      relPath,
      workstream,
      kind: "directory",
      tracked: false,
      text: null,
      entries: await readDirectory(absolute, { relPath }),
      bytes: 0,
      problem: null,
      ...lens,
    };
  }

  const kind = kindForPath(relPath);
  const tracked = await isTracked(root, relPath);
  const base = { relPath, workstream, kind, tracked, entries: [], bytes: stats.size, ...lens };

  if (stats.size > MAX_TEXT_BYTES) {
    const mb = (stats.size / (1024 * 1024)).toFixed(1);
    return { ...base, text: null, problem: `${mb} MB is past the ${String(MAX_TEXT_BYTES / (1024 * 1024))} MB read limit` };
  }

  const buffer = await fs.readFile(absolute);
  if (looksBinary(buffer)) {
    return { ...base, text: null, problem: "not text — download it rather than reading it here" };
  }
  return { ...base, text: buffer.toString("utf8"), problem: null };
}
