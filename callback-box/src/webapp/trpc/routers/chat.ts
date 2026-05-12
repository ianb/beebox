/**
 * tRPC router for chat session metadata — directory associations,
 * lookup helpers. Streaming send + history live as raw Fastify routes
 * (see src/webapp/routes/chat.ts) since they don't fit tRPC's shape.
 */

import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import {
  getDirectoryForSession,
  getLastSessionForDirectory,
} from "../../../core/chat-session-history.js";

export const chatRouter = router({
  /**
   * Most-recently-created session associated with a directory, or null
   * if no chat has been started for that directory.
   */
  lastSessionForDirectory: publicProcedure
    .input(z.object({ contextDir: z.string() }))
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
});
