/**
 * Todo writes from the web UI (`docs/plans/todos-ui.md`, Track 3).
 *
 * `todos.setStatus` ticks one todo off, or reopens it. The client addresses
 * the todo by card path + locator, and also sends the text and status it
 * showed: a locator is a line number and is not stable across edits, so the
 * write re-extracts the card under `withCardLock` and refuses (`CONFLICT`,
 * nothing written) unless the todo at that locator still reads the same and
 * still has the status the boxholder saw. Only `open ↔ done`; a todo that is
 * now `parked` or `dropped` is always a conflict, since the checkbox cannot
 * express those.
 *
 * The edit itself is `setTodoStatus` (`core/todo/set-status.ts`), which also
 * records the accepted cross-process race. The write/commit/`file-change`
 * shape follows `card.setTheme`.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc.js";
import { resolveCardPath } from "./card.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { extractCardTodos } from "../../../core/todo/extract.js";
import { formatTodoLocation, type TodoLocator } from "../../../core/todo/collect-types.js";
import { TodoLocatorSchema } from "../../../shared/todo-locators.js";
import { setTodoStatus, TodoLocatorNotFoundError, type TodoWriteStatus } from "../../../core/todo/set-status.js";

const WriteStatusSchema = z.enum(["open", "done"]);

const SetStatusInputSchema = z.object({
  path: z.string().min(1),
  locator: TodoLocatorSchema,
  text: z.string(),
  expectedStatus: WriteStatusSchema,
  status: WriteStatusSchema,
}).refine((input) => input.expectedStatus !== input.status, {
  message: "status must differ from expectedStatus",
});

/** The one message every stale-address refusal carries; the client has already refreshed, or will, from `file-change`. */
const CHANGED_MESSAGE = "This card changed since it was shown — it has been reloaded";

const COMMIT_TEXT_MAX = 60;

function commitMessage({ text, status }: { text: string; status: TodoWriteStatus }): string {
  const short = text.length > COMMIT_TEXT_MAX ? `${text.slice(0, COMMIT_TEXT_MAX - 1)}…` : text;
  return status === "done" ? `Mark todo done: ${short}` : `Reopen todo: ${short}`;
}

/** The body text or `null` for a missing file; any other read failure propagates. */
async function readCard(fullPath: string): Promise<string | null> {
  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch (error) {
    if (errorMessage(error).includes("ENOENT")) return null;
    throw error;
  }
}

/**
 * Refuse unless the todo at `locator` still reads `text` and still has
 * `expectedStatus`. A card that no longer extracts (bad frontmatter, a body
 * that fails to parse) has no todo there either, so it is the same refusal.
 */
function assertUnchanged(input: {
  relPath: string;
  content: string;
  cardSchemas: Awaited<ReturnType<typeof createCardSchemaMap>>;
  locator: TodoLocator;
  text: string;
  expectedStatus: TodoWriteStatus;
}): void {
  const { relPath, content, cardSchemas, locator, text, expectedStatus } = input;
  const wanted = formatTodoLocation({ path: relPath, locator });
  const { items } = extractCardTodos({ relPath, content, ctx: { cardSchemas } });
  const current = items.find((item) => formatTodoLocation(item) === wanted);
  if (current === undefined || current.text !== text || current.status !== expectedStatus) {
    throw new TRPCError({ code: "CONFLICT", message: CHANGED_MESSAGE });
  }
}

export const todosRouter = router({
  // Anyone the box admits may tick a todo, as they may edit the card it is
  // written in; owner-only is for box settings, not document content.
  setStatus: authedProcedure
    .input(SetStatusInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { relPath, fullPath } = await resolveCardPath({ boxRoot: ctx.boxRoot, inputPath: input.path, mode: "write" });
      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
      const saved = await withCardLock(fullPath, async () => {
        const content = await readCard(fullPath);
        if (content === null) throw new TRPCError({ code: "CONFLICT", message: CHANGED_MESSAGE });
        assertUnchanged({ relPath, content, cardSchemas, locator: input.locator, text: input.text, expectedStatus: input.expectedStatus });
        let next: string;
        try {
          next = setTodoStatus(content, { locator: input.locator, status: input.status });
        } catch (error) {
          // Extraction found the todo, so the edit finding none means the two
          // disagree about the card — still a refusal, never a partial write.
          if (error instanceof TodoLocatorNotFoundError) {
            console.error(`[todos.setStatus] ${relPath}: extracted todo not found by setTodoStatus: ${error.message}`);
            throw new TRPCError({ code: "CONFLICT", message: CHANGED_MESSAGE, cause: error });
          }
          throw error;
        }
        await writeFileAtomic(fullPath, { content: next });
        try {
          const commit = await stageAndCommitPaths(ctx.boxRoot, {
            paths: [relPath],
            message: commitMessage({ text: input.text, status: input.status }),
            trailers: { "Source": "webapp", "Endpoint": "todos.setStatus" },
          });
          return { commit, commitWarning: null };
        } catch (error) {
          console.error(`[todos.setStatus] ${relPath}: saved, but the commit failed: ${errorMessage(error)}`);
          return { commit: null, commitWarning: "Saved, but the Git commit failed." };
        }
      });
      ctx.eventBus.emitTransient("file-change", {
        event: "change",
        path: relPath,
        timestamp: new Date().toISOString(),
      });
      return { status: input.status, ...saved };
    }),
});
