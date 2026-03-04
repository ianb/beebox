import * as fs from "node:fs/promises";
import * as path from "node:path";
import { router, publicProcedure } from "../trpc.js";

export const chatRouter = router({
  history: publicProcedure.query(async ({ ctx }) => {
    return ctx.chatSession.getHistory();
  }),

  status: publicProcedure.query(async ({ ctx }) => {
    return {
      sessionId: ctx.chatSession.getSessionId(),
      running: ctx.chatSession.isRunning(),
      busy: ctx.chatSession.isBusy(),
    };
  }),

  interrupt: publicProcedure.mutation(async ({ ctx }) => {
    ctx.chatSession.interrupt();
    return { ok: true };
  }),

  reset: publicProcedure.mutation(async ({ ctx }) => {
    ctx.chatSession.resetSession();
    return { ok: true };
  }),

  voiceConfig: publicProcedure.query(async ({ ctx }) => {
    try {
      const voicePath = path.join(ctx.boxRoot, "docs/generated/speaking-voice.json");
      const content = await fs.readFile(voicePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { model: undefined, instructions: [] };
    }
  }),

  // TTS is a mutation because it returns binary audio (proxied response).
  // But tRPC can't stream binary — so this stays as a REST route.
  // We include only the JSON-returning procedures here.
});
