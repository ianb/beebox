/**
 * The issue next-action store: what the developer wants done next about an
 * issue, kept on this machine and outside git.
 *
 * A next action is a request from the developer to whichever agent picks the
 * queue (`bbx-issue-actions`), not a property of the issue. It used to be a
 * `next-action:` frontmatter field, which made every click in the issue browser
 * an "Update issue metadata" commit, and those commits stranded on whichever
 * worktree branch held the issue. Here it is one JSON file beside the main
 * checkout, like `dev-comments/`: it survives worktree culls, every checkout
 * reads the same file, and the app writes it the moment the developer chooses.
 *
 * Entries are keyed by `<visibility>/<slug>`, not by path, so a request follows
 * its issue when the issue moves to `closed/` or changes category. A slug with
 * no matching issue stays in the store and is reported as an orphan; it holds
 * the developer's words and is never dropped silently.
 *
 * This module is the only reader and writer. `bin/issues` imports it the same
 * way it imports the rest of this directory.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { execa } from "execa";
import { z } from "zod";

import { requestScopedLock, withFileLock } from "../../../../beebox/src/lib/file-lock.js";
import { errnoCode } from "../../../../beebox/src/shared/error-guards.js";
import { issueNextActionStateSchema, type IssueNextAction, type IssueNextActionState } from "../../shared/documents.js";
import type { Visibility } from "./issue-domain.js";

/** Written when the store root is created; nothing writes to an unmarked directory. */
export const NEXT_ACTIONS_MARKER = ".dev-issue-actions";
const STORE_FILE = "next-actions.json";
const STORE_VERSION = 1;
const LOCK_WAIT_MS = 5_000;

const storeFileSchema = z.object({
  version: z.literal(STORE_VERSION),
  actions: z.record(z.string(), issueNextActionStateSchema),
});

/** The store file exists but is not the shape this module writes. */
export class UnreadableNextActionStoreError extends Error {
  constructor(public readonly file: string, public readonly detail: string) {
    super("the issue next-action store does not parse");
    this.name = "UnreadableNextActionStoreError";
  }
}

/** The store root exists, holds files, and lacks the marker: not ours to write. */
export class UnmarkedNextActionStoreError extends Error {
  constructor(public readonly root: string) {
    super(`the next-action store root exists without ${NEXT_ACTIONS_MARKER}; refusing to adopt it`);
    this.name = "UnmarkedNextActionStoreError";
  }
}

export class InvalidNextActionKeyError extends Error {
  constructor(public readonly key: string) {
    super("invalid next-action key; expected <public|private>/<slug>");
    this.name = "InvalidNextActionKeyError";
  }
}

/** `public/2026-08-24-slug`. A slug is unique within one queue. */
export function nextActionKey(visibility: Visibility, slug: string): string {
  return `${visibility}/${slug}`;
}

/** The inverse of {@link nextActionKey}; null for a key this store never writes. */
export function parseNextActionKey(key: string): { visibility: Visibility; slug: string } | null {
  const match = /^(?<visibility>public|private)\/(?<slug>[A-Za-z0-9][A-Za-z0-9._-]*)$/u.exec(key);
  const visibility = match?.groups?.["visibility"];
  const slug = match?.groups?.["slug"];
  if ((visibility !== "public" && visibility !== "private") || slug === undefined) return null;
  return { visibility, slug };
}

/**
 * Where the store lives: `BBX_ISSUE_ACTIONS_ROOT`, else `dev-issue-actions/`
 * beside the MAIN checkout. From a worktree, git's common dir names main.
 * Null when `repoRoot` is not a git checkout and no override is set: such a
 * tree has no main checkout and therefore no store.
 */
export async function nextActionsRoot(repoRoot: string): Promise<string | null> {
  const override = process.env["BBX_ISSUE_ACTIONS_ROOT"];
  if (override !== undefined && override !== "") return path.resolve(override);
  const result = await execa("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: repoRoot, reject: false,
  });
  if (result.exitCode !== 0) return null;
  const mainRoot = path.dirname(result.stdout.trim());
  return path.join(path.dirname(mainRoot), "dev-issue-actions");
}

/**
 * Every stored next action. A missing store is empty. A store that does not
 * parse is an error: reading it as empty would hide the developer's requests.
 */
export async function readNextActions(root: string | null): Promise<Map<string, IssueNextActionState>> {
  if (root === null) return new Map();
  let text: string;
  try {
    text = await fs.readFile(path.join(root, STORE_FILE), "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return new Map();
    throw error;
  }
  const parsed = storeFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new UnreadableNextActionStoreError(path.join(root, STORE_FILE), parsed.error.message);
  }
  return new Map(Object.entries(parsed.data.actions));
}

async function ensureStore(root: string): Promise<void> {
  const marker = path.join(root, NEXT_ACTIONS_MARKER);
  const marked = await fs.lstat(marker).then((stats) => stats.isFile(), () => false);
  if (marked) return;
  const exists = await fs.lstat(root).then(() => true, () => false);
  if (exists && (await fs.readdir(root)).length > 0) {
    throw new UnmarkedNextActionStoreError(root);
  }
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(marker, `${String(STORE_VERSION)}\n`, "utf8");
}

/** What a caller asks for. Null, or neither field set, removes the entry. */
export interface NextActionRequest {
  action: IssueNextAction | null;
  message: string | null;
}

/** Set or clear one issue's next action. Returns the stored state, or null when cleared. */
export async function writeNextAction(input: {
  root: string;
  key: string;
  request: NextActionRequest | null;
  now?: () => Date;
}): Promise<IssueNextActionState | null> {
  if (parseNextActionKey(input.key) === null) throw new InvalidNextActionKeyError(input.key);
  await ensureStore(input.root);
  const file = path.join(input.root, STORE_FILE);
  return withFileLock({
    lockPath: requestScopedLock(`${file}.lock`),
    metadata: { purpose: "issue-next-actions" },
    waitMs: LOCK_WAIT_MS,
  }, async () => {
    const actions = await readNextActions(input.root);
    const message = input.request?.message?.trim() ?? "";
    const action = input.request?.action ?? null;
    let stored: IssueNextActionState | null = null;
    if (action === null && message === "") {
      actions.delete(input.key);
    } else {
      stored = {
        ...(action === null ? {} : { action }),
        ...(message === "" ? {} : { message }),
        at: (input.now ?? (() => new Date()))().toISOString(),
      };
      actions.set(input.key, stored);
    }
    const sorted = Object.fromEntries([...actions.entries()].toSorted(([a], [b]) => a.localeCompare(b)));
    const temporary = `${file}.${String(process.pid)}.${String(Date.now())}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ version: STORE_VERSION, actions: sorted }, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
    return stored;
  });
}
