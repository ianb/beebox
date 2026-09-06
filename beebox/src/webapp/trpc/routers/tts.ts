/**
 * The box's speaking-voice backend, read by anyone and set by the boxholder.
 *
 * Same split, and the same reason, as `transcription.ts`: choosing which
 * provider the box spends against is credential-adjacent, so the write is
 * `ownerProcedure` — any box-auth'd caller could otherwise repoint the box at a
 * different provider's key. Reading stays public because the chat UI shows the
 * current backend to everyone who can see the chat.
 */

import { z } from "zod";
import { router, ownerProcedure, publicProcedure } from "../trpc.js";
import { loadTtsConfig, updateTtsConfig } from "../../../core/tts/config.js";
import { TTS_BACKENDS } from "../../../shared/tts-backends.js";

// Derived, never re-typed — a hand-copied list is how the transcription
// vocabulary drifted out of sync with the engine.
const backendSchema = z.enum(TTS_BACKENDS);

export const ttsRouter = router({
  config: publicProcedure.query(async ({ ctx }) => {
    const cfg = await loadTtsConfig(ctx.boxRoot);
    return { backend: cfg.backend };
  }),

  setBackend: ownerProcedure
    .input(z.object({ backend: backendSchema }))
    .mutation(async ({ ctx, input }) => {
      const cfg = await updateTtsConfig(ctx.boxRoot, { backend: input.backend });
      return { backend: cfg.backend };
    }),
});
