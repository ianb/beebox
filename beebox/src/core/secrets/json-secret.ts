/**
 * Multi-field credentials in a single-string store.
 *
 * A stored secret's value is an OPAQUE STRING — the store never learns a
 * credential's shape, which is what keeps one entry, one grant, and one
 * rotation true for every provider. Credentials that are structurally several
 * fields (Deepgram's management key + project id, Telegram's bot token +
 * webhook secret, the publish connector's R2 triple) are therefore stored as a
 * JSON string that the CONSUMER parses, validating with its own zod schema at
 * the parse boundary.
 *
 * A value that does not parse or does not match degrades to "not configured"
 * — the same surface a missing grant produces — with one warning naming the
 * secret. It is never a throw: a hand-fixed store entry with a typo must not
 * take down a box's server, and the connector already has a not-configured
 * path (`docs/implemented-plans/secret-custody.md`, Track 3).
 */

import type { z } from "zod";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Parse a JSON-string secret value into its fields, or `null` when the value
 * is not usable. `name` is the store name, used only for the warning.
 */
export function parseJsonSecret<T>(opts: { name: string; value: string; schema: z.ZodType<T> }): T | null {
  let json: unknown;
  try {
    json = JSON.parse(opts.value);
  } catch (e) {
    console.warn(
      `[secrets] the stored secret "${opts.name}" is not valid JSON (${errorMessage(e)}) — ` +
        "treating it as not configured. Multi-field credentials are stored as a JSON string.",
    );
    return null;
  }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      `[secrets] the stored secret "${opts.name}" does not match the shape this connector needs ` +
        `(${parsed.error.issues[0]?.message ?? "unknown issue"}) — treating it as not configured.`,
    );
    return null;
  }
  return parsed.data;
}
