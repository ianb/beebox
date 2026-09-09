/** Small per-tab metadata only. Transcript content stays in chat.history. */
import { z } from "zod";
import { EMPTY_ATTENTION, type AmbientAttention } from "./projection";

// Keep projection.ts dependency-free for its pure doctest; this annotation
// still makes the storage schema prove it returns the domain type it validates.
const attentionSchema: z.ZodType<AmbientAttention> = z.object({
  initialized: z.boolean(), lastCompletion: z.string().nullable().default(null), lastReply: z.string().nullable(),
  attention: z.boolean(), dismissedReply: z.string().nullable(),
});

export function readAttention(key: string): AmbientAttention {
  try {
    const parsed = attentionSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null"));
    return parsed.success ? parsed.data : EMPTY_ATTENTION;
  } catch (error) {
    console.warn("Ambient reply attention could not be loaded", error);
    return EMPTY_ATTENTION;
  }
}

export function writeAttention(key: string, state: AmbientAttention): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.warn("Ambient reply attention could not be saved for reload", error);
  }
}
