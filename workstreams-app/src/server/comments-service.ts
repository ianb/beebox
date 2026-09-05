// The app's half of the comment channel (`docs/plans/document-comments.md`).
//
// IT SHELLS OUT RATHER THAN REACHING INTO THE STORE. `bin/comments` owns where
// a comment lives — the root derivation, the two namespaces, containment, the
// YAML, the locking — and this invokes it, following the precedent
// `bin/CLAUDE.md` records for this very app: "the app invokes the stable
// bin/workstreams CLI instead of reimplementing lifecycle guards."
//
// The alternative was a second implementation of the same write protocol on the
// other side of a package boundary the app does not cross. Duplication is
// usually controllable; two writers to one file format, with one lock protocol
// between them, is the case where it is not.
//
// The cost is a subprocess per call. That is fine here: comments are written
// one at a time by a human reading a document, not in a loop.

import path from "node:path";

import { execa } from "execa";
import { z } from "zod";

import { commentSchema, type Comment } from "../shared/comments.js";

/** What `bin/comments <cmd> --json` emits. Parsed, not trusted. */
const cliEntrySchema = z.object({
  subject: z.object({
    scope: z.enum(["tracked", "worktree"]),
    worktree: z.string().optional(),
    relPath: z.string(),
  }).nullable(),
  storePath: z.string().optional(),
  problem: z.string().nullable().optional(),
  comments: z.array(commentSchema),
});
const cliOutputSchema = z.object({ entries: z.array(cliEntrySchema) });
const cliAddSchema = z.object({ id: z.string() });

export class CommentsCliError extends Error {
  constructor(detail: string) {
    super(`bin/comments failed: ${detail}`);
    this.name = "CommentsCliError";
  }
}

export interface CommentsService {
  /**
   * Every comment on one document, newest first, across both namespaces.
   *
   * `worktree` names which checkout's untracked namespace to look in. The app
   * runs from MAIN while the developer reads another workstream's file through
   * a lens, so without it a comment on an untracked file would be filed and
   * sought under `main` and the agent who needs it would never see it.
   */
  forDocument(input: { relPath: string; worktree: string | null }): Promise<Comment[]>;
  /** Everything waiting, optionally narrowed to what is addressed to one workstream. */
  waiting(workstream: string | null): Promise<Array<{ relPath: string; comments: Comment[] }>>;
  add(input: {
    relPath: string;
    body: string;
    origin: "typed" | "voice";
    workstream: string | null;
    /** Which checkout's namespace an UNTRACKED file belongs to. */
    worktree: string | null;
    // `exactOptionalPropertyTypes` is on, so an ABSENT optional and an
    // explicit `undefined` are different types — and Zod hands back the latter.
    quoted?: string | undefined;
    section?: string | undefined;
    fragment?: string | undefined;
  }): Promise<{ id: string }>;
  clear(input: { relPath: string; worktree: string | null; id?: string | undefined }): Promise<void>;
}

export function createCommentsService(options: { repoRoot: string }): CommentsService {
  const cli = path.join(options.repoRoot, "bin", "comments");

  async function run(args: string[]): Promise<string> {
    const result = await execa(cli, args, { cwd: options.repoRoot, reject: false });
    if (result.exitCode !== 0) {
      // The CLI already phrases refusals for a human; passing its message
      // through beats inventing a second, vaguer one here.
      throw new CommentsCliError(result.stderr.trim() || `exit ${String(result.exitCode)}`);
    }
    return result.stdout;
  }

  /** A flag with an empty value would be read as the next flag; omit it instead. */
  function optional(name: string, value: string | undefined): string[] {
    return value === undefined || value === "" ? [] : [`--${name}`, value];
  }

  return {
    async forDocument({ relPath, worktree }): Promise<Comment[]> {
      const args = ["show", relPath, "--json", ...optional("worktree", worktree ?? undefined)];
      const parsed = cliOutputSchema.parse(JSON.parse(await run(args)));
      return parsed.entries.flatMap((entry) => entry.comments);
    },
    async waiting(workstream): Promise<Array<{ relPath: string; comments: Comment[] }>> {
      const args = ["list", "--json", ...optional("workstream", workstream ?? undefined)];
      const parsed = cliOutputSchema.parse(JSON.parse(await run(args)));
      return parsed.entries
        .filter((entry) => entry.subject !== null)
        .map((entry) => ({ relPath: entry.subject?.relPath ?? "", comments: entry.comments }));
    },
    async add(input): Promise<{ id: string }> {
      const args = [
        "add",
        input.relPath,
        "--body", input.body,
        "--origin", input.origin,
        "--json",
        ...optional("workstream", input.workstream ?? undefined),
        ...optional("worktree", input.worktree ?? undefined),
        ...optional("quoted", input.quoted),
        ...optional("section", input.section),
        ...optional("fragment", input.fragment),
      ];
      return cliAddSchema.parse(JSON.parse(await run(args)));
    },
    async clear(input): Promise<void> {
      await run([
        "clear",
        input.relPath,
        ...optional("worktree", input.worktree ?? undefined),
        ...optional("id", input.id),
      ]);
    },
  };
}
