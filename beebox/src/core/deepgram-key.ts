/**
 * Resolve the Deepgram management credentials for a box: the machine store's
 * `deepgram` entry at `server` access
 * (`docs/implemented-plans/secret-custody.md`). Deepgram needs TWO fields, so
 * the entry's value is a JSON string `{"apiKey": "…", "projectId": "…"}` that
 * this module parses (see `secrets/json-secret.ts` for why the store keeps
 * values opaque).
 *
 * The store is the only source; the transition window's
 * `_config/connectors/deepgram.secret.json` file and
 * `BBX_DEEPGRAM_API_KEY`/`BBX_DEEPGRAM_PROJECT` env pair are gone. A box with
 * no grant degrades exactly as an unconfigured box always did.
 *
 * The "apiKey" here is the long-lived management key — used server-side to mint
 * short-TTL temp keys for the browser (`trpc/routers/transcription.ts`, which
 * logs each mint), and to call Deepgram's prerecorded endpoint.
 */

import { z } from "zod";
import { parseJsonSecret } from "./secrets/json-secret.js";
import { resolveSecret, type SecretRead } from "./secrets/resolve.js";

/** The store name this connector's credentials live under. */
export const DEEPGRAM_SECRET_NAME = "deepgram";

export interface DeepgramCredentials {
  apiKey: string;
  projectId: string;
}

/** The shape of the store's JSON-string value. */
const deepgramSecretSchema = z.object({
  apiKey: z.string().optional(),
  projectId: z.string().optional(),
});

function completeOrNull(fields: z.infer<typeof deepgramSecretSchema>): DeepgramCredentials | null {
  const { apiKey, projectId } = fields;
  if (apiKey === undefined || apiKey === "" || projectId === undefined || projectId === "") return null;
  return { apiKey, projectId };
}

export async function getDeepgramCredentials(
  boxRoot: string | undefined,
  read: SecretRead,
): Promise<DeepgramCredentials | null> {
  if (boxRoot === undefined) return null;
  const resolved = await resolveSecret({
    boxRoot,
    name: DEEPGRAM_SECRET_NAME,
    purpose: "transcription",
    access: "server",
    observe: read.observe,
  });
  if (!resolved.ok) return null;
  if (resolved.value.suspect) {
    console.warn("[deepgram-key] the stored Deepgram key last failed a probe — it may be expired.");
  }
  // A malformed stored value is "not configured": the boxholder put something
  // there deliberately and needs the warning `parseJsonSecret` already printed.
  const fields = parseJsonSecret({
    name: DEEPGRAM_SECRET_NAME,
    value: resolved.value.value,
    schema: deepgramSecretSchema,
  });
  if (fields === null) return null;
  return completeOrNull(fields);
}
