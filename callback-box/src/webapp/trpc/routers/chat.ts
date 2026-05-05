/**
 * tRPC router for chat session metadata — directory associations,
 * lookup helpers. Streaming send + history live as raw Fastify routes
 * (see src/webapp/routes/chat.ts) since they don't fit tRPC's shape.
 */

import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import {
  appendHistory,
  getDirectoryForSession,
  getLastSessionForDirectory,
} from "../../../core/chat-session-history.js";

export const chatRouter = router({
  /**
   * Most-recently-created session associated with a directory, or null
   * if no chat has been started for that directory.
   */
  lastSessionForDirectory: publicProcedure
    .input(z.object({ contextDir: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const sessionId = await getLastSessionForDirectory(ctx.boxRoot, input.contextDir);
      return { sessionId };
    }),

  /**
   * Directory a session is associated with, or null if it isn't.
   */
  directoryFor: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const contextDir = await getDirectoryForSession(ctx.boxRoot, input.sessionId);
      return { contextDir };
    }),

  /**
   * Associate a session with a directory. Idempotent — a second call for
   * the same session is a no-op (the first contextDir wins; rebinding
   * isn't supported in v1).
   */
  recordContextDir: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      contextDir: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await appendHistory(ctx.boxRoot, {
        sessionId: input.sessionId,
        contextDir: input.contextDir,
      });
      return { success: true };
    }),
});

/**
 * Build the seed message sent as the first user turn of a chat started
 * from a landmark. The agent reads the directive on its first turn and
 * familiarises itself with the directory before the user speaks.
 *
 * Uses the standard ref="..." attribute convention (box-relative path,
 * no leading slash).
 */
export function buildContextDirectorySeed(contextDir: string): string {
  return `<context-directory ref="${contextDir}">Familiarize yourself with ${contextDir} before beginning</context-directory>`;
}
