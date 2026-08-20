/**
 * Resolve the Deepgram management credentials for a box.
 *
 * Migrated onto the machine-level secret store following `mistral-key.ts`
 * (`docs/plans/secret-custody.md`, Track 3). Resolution order:
 *
 * 1. **The store** — `resolveSecret` with the name `deepgram` at `server`
 *    access. Deepgram needs TWO fields, so the entry's value is a JSON string
 *    `{"apiKey": "…", "projectId": "…"}` that this module parses (see
 *    `secrets/json-secret.ts` for why the store keeps values opaque).
 * 2. **The legacy per-box file** — `config/connectors/deepgram.secret.json`,
 *    kept for one transition window and warned about once per process.
 * 3. **`CALLBACK_DEEPGRAM_API_KEY` + `CALLBACK_DEEPGRAM_PROJECT`.**
 *
 * The "apiKey" here is the long-lived management key — used server-side to mint
 * short-TTL temp keys for the browser (`trpc/routers/transcription.ts`, which
 * logs each mint), and to call Deepgram's prerecorded endpoint.
 *
 * The return stays `DeepgramCredentials | null`: a box with neither field
 * degrades exactly as before, through the caller's "not configured" path.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { parseJsonSecret } from "./secrets/json-secret.js";
import { refusalAllowsLegacyFallback } from "./secrets/legacy-fallback.js";
import { resolveSecret, type SecretRead } from "./secrets/resolve.js";

/** The store name this connector's credentials live under. */
export const DEEPGRAM_SECRET_NAME = "deepgram";

export interface DeepgramCredentials {
  apiKey: string;
  projectId: string;
}

/** Both the store's JSON-string value and the legacy file share this shape. */
const deepgramSecretSchema = z.object({
  apiKey: z.string().optional(),
  projectId: z.string().optional(),
});

let warnedAboutLegacyFile = false;

/** Reset the once-per-process deprecation latch (tests only). */
export function resetDeepgramLegacyWarning(): void {
  warnedAboutLegacyFile = false;
}

function completeOrNull(fields: z.infer<typeof deepgramSecretSchema>): DeepgramCredentials | null {
  const { apiKey, projectId } = fields;
  if (apiKey === undefined || apiKey === "" || projectId === undefined || projectId === "") return null;
  return { apiKey, projectId };
}

/** The legacy in-tree secret file, or null when it is absent/unusable. */
async function readLegacySecretFile(boxRoot: string): Promise<DeepgramCredentials | null> {
  const secretPath = path.join(boxRoot, "config/connectors/deepgram.secret.json");
  let content: string;
  try {
    content = await fs.readFile(secretPath, "utf-8");
  } catch (_e) {
    // The overwhelmingly common case now: no stray file. Silent by design.
    return null;
  }
  let creds: DeepgramCredentials | null;
  try {
    creds = completeOrNull(deepgramSecretSchema.parse(JSON.parse(content)));
  } catch (e) {
    console.warn(`[deepgram-key] ignoring unreadable legacy secret file ${secretPath}:`, e);
    return null;
  }
  if (creds === null) return null;
  if (!warnedAboutLegacyFile) {
    warnedAboutLegacyFile = true;
    console.warn(
      `[deepgram-key] using the deprecated in-tree secret file ${secretPath}. ` +
        `Move it into the machine store (cb secrets set ${DEEPGRAM_SECRET_NAME} — the value is the ` +
        `JSON object itself, then cb secrets grant <box> ${DEEPGRAM_SECRET_NAME}) and delete the file.`,
    );
  }
  return creds;
}

export async function getDeepgramCredentials(
  boxRoot: string | undefined,
  read: SecretRead,
): Promise<DeepgramCredentials | null> {
  if (boxRoot !== undefined) {
    const resolved = await resolveSecret({
      boxRoot,
      name: DEEPGRAM_SECRET_NAME,
      purpose: "transcription",
      access: "server",
      observe: read.observe,
    });
    if (resolved.ok) {
      if (resolved.value.suspect) {
        console.warn("[deepgram-key] the stored Deepgram key last failed a probe — it may be expired.");
      }
      const fields = parseJsonSecret({
        name: DEEPGRAM_SECRET_NAME,
        value: resolved.value.value,
        schema: deepgramSecretSchema,
      });
      // A malformed stored value is "not configured", not a fall-through to a
      // stale file: the boxholder put something there deliberately and needs
      // the warning parseJsonSecret already printed, not silent shadowing.
      if (fields !== null) return completeOrNull(fields);
      return null;
    }
    // Only "no such secret on this machine" degrades to the legacy sources;
    // every other refusal is "not configured" (`secrets/legacy-fallback.ts`).
    if (!refusalAllowsLegacyFallback({ reader: "deepgram-key", refusal: resolved.error })) return null;
    const legacy = await readLegacySecretFile(boxRoot);
    if (legacy !== null) return legacy;
  }
  return completeOrNull({
    apiKey: process.env["CALLBACK_DEEPGRAM_API_KEY"],
    projectId: process.env["CALLBACK_DEEPGRAM_PROJECT"],
  });
}
