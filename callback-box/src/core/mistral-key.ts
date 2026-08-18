/**
 * Resolve the Mistral API key for a box.
 *
 * The first consumer migrated onto the machine-level secret store
 * (`docs/plans/secret-custody.md`, Track 3) and therefore the template for the
 * rest. Resolution order:
 *
 * 1. **The store** — `resolveSecret` with the name `mistral` at `server`
 *    access: the key is used only inside server processes (transcription), so
 *    an `agent` grant is never required and never asked for.
 * 2. **The legacy per-box file** — `config/connectors/mistral.secret.json`,
 *    kept for one transition window and warned about once per process, naming
 *    the stray file so the operator can migrate and delete it.
 * 3. **`CALLBACK_MISTRAL_API_KEY`** — the env path, retired at the end of
 *    Track 3 along with its child-env allowlist entry.
 *
 * Store WINS over the file (the plan's transition rule), and the return stays
 * `string | null`: a box with no key configured degrades exactly as before,
 * through the caller's existing "not configured" path.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { resolveSecret } from "./secrets/resolve.js";

/** The store name this connector's key lives under. */
export const MISTRAL_SECRET_NAME = "mistral";

const mistralSecretSchema = z.object({ apiKey: z.string().optional() });

let warnedAboutLegacyFile = false;

/** Reset the once-per-process deprecation latch (tests only). */
export function resetMistralLegacyWarning(): void {
  warnedAboutLegacyFile = false;
}

/** The legacy in-tree secret file, or null when it is absent/unreadable. */
async function readLegacySecretFile(boxRoot: string): Promise<string | null> {
  const secretPath = path.join(boxRoot, "config/connectors/mistral.secret.json");
  let content: string;
  try {
    content = await fs.readFile(secretPath, "utf-8");
  } catch (_e) {
    // The overwhelmingly common case now: no stray file. Silent by design.
    return null;
  }
  let parsed: z.infer<typeof mistralSecretSchema>;
  try {
    parsed = mistralSecretSchema.parse(JSON.parse(content));
  } catch (e) {
    console.warn(`[mistral-key] ignoring unreadable legacy secret file ${secretPath}:`, e);
    return null;
  }
  if (parsed.apiKey === undefined || parsed.apiKey === "") return null;
  if (!warnedAboutLegacyFile) {
    warnedAboutLegacyFile = true;
    console.warn(
      `[mistral-key] using the deprecated in-tree secret file ${secretPath}. ` +
        `Move it into the machine store (cb secrets set ${MISTRAL_SECRET_NAME}, then ` +
        "cb secrets grant <box> mistral) and delete the file.",
    );
  }
  return parsed.apiKey;
}

export async function getMistralApiKey(boxRoot?: string): Promise<string | null> {
  if (boxRoot !== undefined) {
    const resolved = await resolveSecret({
      boxRoot,
      name: MISTRAL_SECRET_NAME,
      purpose: "transcription",
      access: "server",
    });
    if (resolved.ok) {
      if (resolved.value.suspect) {
        console.warn("[mistral-key] the stored Mistral key last failed a probe — it may be expired.");
      }
      return resolved.value.value;
    }
    // Every refusal degrades to the next source, then to "not configured" —
    // the same surface this function has always presented. The refusal itself
    // is already in the access log with its exact condition.
    const legacy = await readLegacySecretFile(boxRoot);
    if (legacy !== null) return legacy;
  }
  return process.env["CALLBACK_MISTRAL_API_KEY"] ?? null;
}
