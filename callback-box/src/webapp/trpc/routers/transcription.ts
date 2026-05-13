import { z } from "zod";
import ky, { type HTTPError } from "ky";
import { router, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import {
  loadTranscriptionConfig,
  updateTranscriptionConfig,
} from "../../../core/transcription.js";
import { getDeepgramCredentials } from "../../../core/deepgram-key.js";

const TEMP_KEY_TTL_SECONDS = 20 * 60; // 20 minutes

const serviceSchema = z.enum(["voxtral", "deepgram", "whisper"]);
const hqServiceSchema = z.enum(["whisper", "voxtral"]);

export const transcriptionRouter = router({
  config: publicProcedure.query(async ({ ctx }) => {
    const cfg = await loadTranscriptionConfig(ctx.boxRoot);
    return { service: cfg.service, hqService: cfg.hqService };
  }),

  setService: publicProcedure
    .input(z.object({ service: serviceSchema }))
    .mutation(async ({ ctx, input }) => {
      const cfg = await updateTranscriptionConfig(ctx.boxRoot, { service: input.service });
      return { service: cfg.service };
    }),

  setHqService: publicProcedure
    .input(z.object({ hqService: hqServiceSchema }))
    .mutation(async ({ ctx, input }) => {
      const cfg = await updateTranscriptionConfig(ctx.boxRoot, { hqService: input.hqService });
      return { hqService: cfg.hqService };
    }),

  deepgramTempKey: publicProcedure.mutation(async ({ ctx }) => {
    const creds = await getDeepgramCredentials(ctx.boxRoot);
    if (!creds) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Deepgram not configured (need apiKey + projectId in config/connectors/deepgram.secret.json or CALLBACK_DEEPGRAM_API_KEY + CALLBACK_DEEPGRAM_PROJECT)",
      });
    }
    try {
      const result = await ky
        .post(
          `https://api.deepgram.com/v1/projects/${encodeURIComponent(creds.projectId)}/keys`,
          {
            json: {
              comment: "callback-box browser realtime",
              scopes: ["usage:write"],
              time_to_live_in_seconds: TEMP_KEY_TTL_SECONDS,
            },
            headers: {
              Authorization: `Token ${creds.apiKey}`,
            },
            retry: 1,
            timeout: 15_000,
          }
        )
        .json<{ key: string; api_key_id: string }>();
      return {
        key: result.key,
        ttlSeconds: TEMP_KEY_TTL_SECONDS,
      };
    } catch (e) {
      const httpErr = e as HTTPError;
      let detail = (e as Error).message;
      if (httpErr.response) {
        try {
          detail = await httpErr.response.text();
        } catch (_inner) {
          // ignore
        }
      }
      console.error("[deepgramTempKey] failed:", detail);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to mint Deepgram temp key: ${detail}`,
      });
    }
  }),
});
