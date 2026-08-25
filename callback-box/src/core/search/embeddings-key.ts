/**
 * Load the OpenAI embeddings API key — the key-resolution shape
 * `mistral-key.ts` established, but STRICTER at the boundary (see
 * docs/plans/semantic-search.md § Direction).
 *
 * Order (`docs/plans/secret-custody.md`, Track 3): the machine store's
 * `openai` entry at `server` access — the name matches the legacy file
 * `openai.secret.json`, so the migration script dedupes the two obviously —
 * then that legacy in-tree file with a once-per-process deprecation warning,
 * then `CALLBACK_OPENAI_API_KEY`.
 *
 * `openai` is the box's GENERAL OpenAI key (embeddings, and the
 * `/api/adapters/openai` pass-through). It is deliberately distinct from
 * `openai-thinking` (`core/openai-thinking-key.ts`, the
 * `THINKING_OPENAI_API_KEY` var behind TTS/Whisper/realtime): a transcription
 * key is not consent to pay for embeddings, and that separation predates the
 * store.
 *
 * The file arm keeps its strictness: an ABSENT file falls through silently
 * (the designed not-configured state), but a file that EXISTS and is
 * unreadable, unparseable, or missing/non-string `apiKey` is a loud typed
 * error — a box that tried to configure paid embeddings must know it failed
 * (never-implicit-key / principle #3-#4).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { refusalAllowsLegacyFallback } from "../secrets/legacy-fallback.js";
import { resolveSecret } from "../secrets/resolve.js";

/** The store name this key lives under — matches the legacy file's basename. */
const OPENAI_SECRET_NAME = "openai";

const SECRET_RELATIVE_PATH = "config/connectors/openai.secret.json";

let warnedAboutLegacyFile = false;

/** Reset the once-per-process deprecation latch (tests only). */
export function resetEmbeddingsLegacyWarning(): void {
  warnedAboutLegacyFile = false;
}

/**
 * Thrown when `openai.secret.json` exists but can't be used as a key
 * source. `detail` is built by the caller from structured data (never a
 * literal), so the message always names the file and the specific problem.
 */
export class EmbeddingsKeyError extends Error {
  constructor(detail: string, opts?: { cause?: unknown }) {
    super(`OpenAI embeddings key error: ${detail}`, opts);
    this.name = "EmbeddingsKeyError";
  }
}

const openAiSecretFileSchema = z.object({
  apiKey: z.string().trim().min(1),
});

export async function getOpenAiEmbeddingsKey(boxRoot: string): Promise<string | null> {
  const resolved = await resolveSecret({
    boxRoot,
    name: OPENAI_SECRET_NAME,
    purpose: "embeddings",
    access: "server",
  });
  if (resolved.ok) {
    if (resolved.value.suspect) {
      console.warn("[embeddings-key] the stored OpenAI key last failed a probe — it may be expired.");
    }
    return resolved.value.value;
  }
  // Only "no such secret on this machine" degrades to the legacy sources
  // below; every other refusal is "not configured"
  // (`secrets/legacy-fallback.ts`).
  if (!refusalAllowsLegacyFallback({ reader: "embeddings-key", refusal: resolved.error })) return null;
  const secretPath = path.join(boxRoot, SECRET_RELATIVE_PATH);
  let content: string;
  try {
    content = await fs.readFile(secretPath, "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") {
      return process.env["CALLBACK_OPENAI_API_KEY"] ?? null;
    }
    const readFailedDetail = `${SECRET_RELATIVE_PATH} could not be read: ${errorMessage(e)}`;
    throw new EmbeddingsKeyError(readFailedDetail, { cause: e });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const parseFailedDetail = `${SECRET_RELATIVE_PATH} is not valid JSON: ${errorMessage(e)}`;
    throw new EmbeddingsKeyError(parseFailedDetail, { cause: e });
  }

  const result = openAiSecretFileSchema.safeParse(parsed);
  if (!result.success) {
    const missingKeyDetail = `${SECRET_RELATIVE_PATH} must hold a JSON object with a non-empty "apiKey" string`;
    throw new EmbeddingsKeyError(missingKeyDetail, { cause: result.error });
  }
  if (!warnedAboutLegacyFile) {
    warnedAboutLegacyFile = true;
    console.warn(
      `[embeddings-key] using the deprecated in-tree secret file ${secretPath}. ` +
        `Move it into the machine store (cb secrets set ${OPENAI_SECRET_NAME}, then ` +
        `cb secrets grant <box> ${OPENAI_SECRET_NAME}) and delete the file.`,
    );
  }
  return result.data.apiKey;
}
