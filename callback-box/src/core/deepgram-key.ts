/**
 * Load Deepgram management API key + project ID from secret file or env vars.
 *
 * Checks config/connectors/deepgram.secret.json first
 *   ({ "apiKey": "...", "projectId": "..." }),
 * then falls back to CALLBACK_DEEPGRAM_API_KEY + CALLBACK_DEEPGRAM_PROJECT.
 *
 * The "apiKey" here is the long-lived management key — it is used server-side
 * to mint short-TTL temp keys for the browser, and to call Deepgram's
 * prerecorded endpoint for file-based transcription.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DeepgramCredentials {
  apiKey: string;
  projectId: string;
}

export async function getDeepgramCredentials(boxRoot?: string): Promise<DeepgramCredentials | null> {
  let fileApiKey: string | undefined;
  let fileProjectId: string | undefined;
  if (boxRoot) {
    try {
      const secretPath = path.join(boxRoot, "config/connectors/deepgram.secret.json");
      const content = await fs.readFile(secretPath, "utf-8");
      const parsed = JSON.parse(content) as { apiKey?: string; projectId?: string };
      fileApiKey = parsed.apiKey;
      fileProjectId = parsed.projectId;
    } catch (_e) {
      // Fall through to env
    }
  }
  const apiKey = fileApiKey ?? process.env["CALLBACK_DEEPGRAM_API_KEY"];
  const projectId = fileProjectId ?? process.env["CALLBACK_DEEPGRAM_PROJECT"];
  if (!apiKey || !projectId) {
    return null;
  }
  return { apiKey, projectId };
}
