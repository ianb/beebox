/** Small per-tab metadata only. Transcript content stays in chat.history. */
import { z } from "zod";
import { readSessionJson, writeSessionJson } from "../../../../lib/session-json";
import { EMPTY_ATTENTION, type AmbientAttention } from "../projection";

// Keep projection.ts dependency-free for its pure test; this annotation
// still makes the storage schema prove it returns the domain type it validates.
const attentionSchema: z.ZodType<AmbientAttention> = z.object({
  initialized: z.boolean(), lastCompletion: z.string().nullable().default(null), lastReply: z.string().nullable(),
  attention: z.boolean(), dismissedReply: z.string().nullable(),
});
const WHAT = "Ambient reply attention";

export function readAttention(key: string): AmbientAttention {
  return readSessionJson({ key, schema: attentionSchema, fallback: EMPTY_ATTENTION, what: WHAT });
}

export function writeAttention(key: string, state: AmbientAttention): void {
  writeSessionJson({ key, value: state, what: WHAT });
}
