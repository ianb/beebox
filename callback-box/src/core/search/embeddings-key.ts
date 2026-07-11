/**
 * Load the OpenAI embeddings API key from secret file or environment
 * variable — the key-resolution shape `mistral-key.ts` established, but
 * STRICTER at the boundary (see docs/plans/semantic-search.md § Direction).
 *
 * `config/connectors/openai.secret.json` (`{apiKey}`) first; an ABSENT file
 * falls through to `CALLBACK_OPENAI_API_KEY` silently (the designed
 * not-configured state). A file that EXISTS but is unreadable, unparseable,
 * or missing/non-string `apiKey` is a loud typed error, never a silent
 * fallback — a box that tried to configure paid embeddings must know it
 * failed (never-implicit-key / principle #3-#4). No fallback to
 * `THINKING_OPENAI_API_KEY` — a transcription key is not consent to pay for
 * embeddings.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";

const SECRET_RELATIVE_PATH = "config/connectors/openai.secret.json";

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
  return result.data.apiKey;
}
