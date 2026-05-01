import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import ky, { type HTTPError } from "ky";
import { router, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import {
  loadTranscriptionConfig,
  type TranscriptionService,
} from "../../../core/transcription.js";
import { getDeepgramCredentials } from "../../../core/deepgram-key.js";

const TEMP_KEY_TTL_SECONDS = 20 * 60; // 20 minutes

const serviceSchema = z.enum(["voxtral", "deepgram", "whisper"]);

export const transcriptionRouter = router({
  config: publicProcedure.query(async ({ ctx }) => {
    const cfg = await loadTranscriptionConfig(ctx.boxRoot);
    return { service: cfg.service };
  }),

  setService: publicProcedure
    .input(z.object({ service: serviceSchema }))
    .mutation(async ({ ctx, input }) => {
      const service: TranscriptionService = input.service;
      const configPath = path.join(ctx.boxRoot, "config/transcription.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ service }, null, 2) + "\n"
      );
      return { service };
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
