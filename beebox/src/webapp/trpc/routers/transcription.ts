import { z } from "zod";
import ky, { HTTPError } from "ky";
import { router, ownerProcedure, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import {
  loadTranscriptionConfig,
  updateTranscriptionConfig,
} from "../../../core/transcription/index.js";
import { DEEPGRAM_SECRET_NAME, getDeepgramCredentials } from "../../../core/deepgram-key.js";
import { getOpenAiThinkingKey, OPENAI_THINKING_SECRET_NAME } from "../../../core/openai-thinking-key.js";
import { recordSecretMint } from "../../../core/secrets/access-log.js";
import { errorMessage } from "../../../lib/error-guards.js";

const TEMP_KEY_TTL_SECONDS = 20 * 60; // 20 minutes

const serviceSchema = z.enum(["voxtral", "deepgram", "whisper", "openai-realtime"]);
const hqServiceSchema = z.enum(["whisper", "whisper-llm", "whisper-llm-mini", "voxtral", "voxtral-diarized"]);

export const transcriptionRouter = router({
  config: publicProcedure.query(async ({ ctx }) => {
    const cfg = await loadTranscriptionConfig(ctx.boxRoot);
    return { service: cfg.service, hqService: cfg.hqService };
  }),

  /**
   * Repointing which backend future transcriptions spend against is a
   * credential-adjacent decision, so it is the BOXHOLDER's (secret-custody plan,
   * Decision 6): any box-auth'd caller could otherwise switch the box onto a
   * different provider's key. Reading the config stays public — the chat UI
   * shows the current service to everyone who can see the chat.
   */
  setService: ownerProcedure
    .input(z.object({ service: serviceSchema }))
    .mutation(async ({ ctx, input }) => {
      const cfg = await updateTranscriptionConfig(ctx.boxRoot, { service: input.service });
      return { service: cfg.service };
    }),

  /** Same reasoning as `setService` (Decision 6): owner-only. */
  setHqService: ownerProcedure
    .input(z.object({ hqService: hqServiceSchema }))
    .mutation(async ({ ctx, input }) => {
      const cfg = await updateTranscriptionConfig(ctx.boxRoot, { hqService: input.hqService });
      return { hqService: cfg.hqService };
    }),

  /**
   * Mint a TTL'd, usage-scoped Deepgram key for the browser. This SPENDS the
   * box's stored management key without disclosing it — the derived-credential
   * pattern — so it is logged to the secrets access log as a `mint` event
   * (`docs/implemented-plans/secret-custody.md`, "operation surface"). Deliberately
   * uncapped (Decision 7): logged-and-visible, not throttled.
   */
  deepgramTempKey: publicProcedure.mutation(async ({ ctx }) => {
    const creds = await getDeepgramCredentials(ctx.boxRoot, { observe: true });
    if (!creds) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          'Deepgram not configured — ask the boxholder to grant the "deepgram" secret to this box',
      });
    }
    await recordSecretMint({
      boxRoot: ctx.boxRoot,
      slug: ctx.boxSlug,
      secret: DEEPGRAM_SECRET_NAME,
      purpose: "deepgram-temp-key",
    });
    try {
      const result = await ky
        .post(
          `https://api.deepgram.com/v1/projects/${encodeURIComponent(creds.projectId)}/keys`,
          {
            json: {
              comment: "beebox browser realtime",
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
      let detail = e instanceof Error ? e.message : String(e);
      if (e instanceof HTTPError) {
        try {
          detail = await e.response.text();
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

  /** Mints an OpenAI realtime client secret for the browser — the same
   *  spend-without-disclosing shape as `deepgramTempKey`, logged the same way. */
  openaiRealtimeKey: publicProcedure.mutation(async ({ ctx }) => {
    const apiKey = await getOpenAiThinkingKey(ctx.boxRoot, { observe: true });
    if (!apiKey) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          'OpenAI not configured — ask the boxholder to grant the "openai-thinking" secret to this box',
      });
    }
    await recordSecretMint({
      boxRoot: ctx.boxRoot,
      slug: ctx.boxSlug,
      secret: OPENAI_THINKING_SECRET_NAME,
      purpose: "openai-realtime-client-secret",
    });
    const requestBody = {
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "gpt-realtime-whisper" },
          },
        },
      },
    };
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (e) {
      const detail = errorMessage(e);
      console.error("[openaiRealtimeKey] network error:", detail);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to mint OpenAI realtime client secret: ${detail}`,
      });
    }
    const rawText = await response.text();
    if (!response.ok) {
      console.error(
        `[openaiRealtimeKey] HTTP ${response.status} ${response.statusText}: ${rawText}`,
      );
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to mint OpenAI realtime client secret (HTTP ${response.status}): ${rawText || response.statusText}`,
      });
    }
    let parsed: { value?: string; expires_at?: number; client_secret?: { value?: string; expires_at?: number } };
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      console.error(
        `[openaiRealtimeKey] non-JSON body (status ${response.status}, ${rawText.length} bytes):`,
        rawText.slice(0, 500),
      );
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `OpenAI returned non-JSON response (${response.status}): ${errorMessage(e)}`,
      });
    }
    // Handle both flat and nested response shapes — the docs show flat
    // (`{ value, expires_at }`) but some clients have reported nested
    // (`{ client_secret: { value, expires_at } }`).
    const value = parsed.value ?? parsed.client_secret?.value;
    const expiresAt = parsed.expires_at ?? parsed.client_secret?.expires_at;
    if (!value || !expiresAt) {
      console.error("[openaiRealtimeKey] missing value/expires_at in response:", rawText.slice(0, 500));
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `OpenAI client_secrets response missing value/expires_at: ${rawText.slice(0, 200)}`,
      });
    }
    const ttlSeconds = Math.max(10, expiresAt - Math.floor(Date.now() / 1000));
    return { key: value, ttlSeconds };
  }),
});
