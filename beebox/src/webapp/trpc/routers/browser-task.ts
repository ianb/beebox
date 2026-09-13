/**
 * Browser-task procedures: the boxholder's controls on a task card that the
 * executor must never touch. Today that is one thing — opening and closing
 * the task from its own view. Closing stops the submission route (409) and
 * the form; reopening reverses it. Same locked read-modify-write and commit
 * shape as `card.setTheme`.
 */

import * as fs from "node:fs/promises";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Document, isMap, parseDocument } from "yaml";
import { router, ownerProcedure, publicProcedure } from "../trpc.js";
import { listBrowserTasks } from "../../../core/browser-task/list.js";
import { getBoxTime } from "../../../lib/time.js";
import { splitCardContent } from "../../../cards/index.js";
import { typeFromFilename } from "../../../core/card-io.js";
import { resolveBoxNamespacePathOnDisk } from "../../../lib/box-namespace-resolve.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { BrowserTaskStatus } from "../../../schemas/browser-task.js";

export const browserTaskRouter = router({
  /** Every browser-task card with its derived state; the dashboard's "due" list reads this. */
  list: publicProcedure.query(async ({ ctx }) => {
    return { items: await listBrowserTasks(ctx.boxRoot, getBoxTime().getTime()) };
  }),

  setStatus: ownerProcedure
    .input(z.object({ path: z.string().min(1), status: BrowserTaskStatus }))
    .mutation(async ({ input, ctx }) => {
      const ns = await resolveBoxNamespacePathOnDisk({ boxRoot: ctx.boxRoot, rawPath: input.path, mode: "write" });
      if (!ns.ok) {
        throw new TRPCError({ code: ns.reason === "display-form" ? "BAD_REQUEST" : "FORBIDDEN", message: ns.reason === "display-form" ? ns.message : "Access denied" });
      }
      if (typeFromFilename(ns.relativePath) !== "browser-task") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a browser-task card has a task status" });
      }
      return withCardLock(ns.resolved, async () => {
        let raw: string;
        try {
          raw = await fs.readFile(ns.resolved, "utf-8");
        } catch (e) {
          if (errnoCode(e) === "ENOENT") throw new TRPCError({ code: "NOT_FOUND", message: `Card not found: ${ns.relativePath}` });
          throw e;
        }
        const split = splitCardContent(raw);
        if (!split.hasFrontmatter) throw new TRPCError({ code: "BAD_REQUEST", message: "Card has no frontmatter block" });
        const document = split.frontmatterText.trim() === "" ? new Document({}) : parseDocument(split.frontmatterText);
        if (document.errors.length > 0 || !isMap(document.contents)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Card frontmatter is not a valid YAML mapping" });
        }
        document.set("status", input.status);
        const yaml = String(document);
        await writeFileAtomic(ns.resolved, { content: `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${split.body}` });
        try {
          const commit = await stageAndCommitPaths(ctx.boxRoot, {
            paths: [ns.relativePath],
            message: `${input.status === "closed" ? "Close" : "Reopen"} browser task: ${ns.relativePath}`,
            trailers: { "Source": "webapp", "Endpoint": "browserTask.setStatus" },
          });
          return { status: input.status, commit, commitWarning: null };
        } catch (_error) {
          return { status: input.status, commit: null, commitWarning: "Saved, but the Git commit failed." };
        }
      });
    }),
});
