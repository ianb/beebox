/**
 * Load Mistral API key from secret file or environment variable.
 *
 * Checks config/connectors/mistral.secret.json first (key: "apiKey"),
 * then falls back to CALLBACK_MISTRAL_API_KEY env var.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function getMistralApiKey(boxRoot?: string): Promise<string | null> {
  if (boxRoot) {
    try {
      const secretPath = path.join(boxRoot, "config/connectors/mistral.secret.json");
      const content = await fs.readFile(secretPath, "utf-8");
      const parsed = JSON.parse(content) as { apiKey?: string };
      if (parsed.apiKey) {
        return parsed.apiKey;
      }
    } catch (_e) {
      // File doesn't exist or is invalid — fall through to env var
    }
  }
  return process.env["CALLBACK_MISTRAL_API_KEY"] ?? null;
}
