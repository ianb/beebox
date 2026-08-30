/**
 * Fetch + `safeParse` the edge manifest from R2. Shared by the serve path
 * (`index.ts`) and the submit endpoint (`submit.ts`) so both treat the store as
 * the same untrusted boundary (principle #3 / the Val Town lesson): a
 * missing/corrupt/invalid manifest is `null`, and every caller fails closed.
 */

import { edgeManifestSchema, type EdgeManifest } from "../../src/publish/manifest-edge";
import type { Env } from "./env";

/** Fetch + `safeParse` the edge manifest. Missing or invalid → null (+ a log). */
export async function loadManifest(pubId: string, env: Env): Promise<EdgeManifest | null> {
  const object = await env.PUB_STORE.get(`pubs/${pubId}/manifest.json`);
  if (object === null) {
    console.warn(`pub-worker: no manifest for pub ${pubId}`);
    return null;
  }
  const raw = await object.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (_e) {
    console.warn(`pub-worker: manifest for pub ${pubId} is not valid JSON`);
    return null;
  }
  const parsed = edgeManifestSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(`pub-worker: manifest for pub ${pubId} failed schema validation`);
    return null;
  }
  return parsed.data;
}

/** Whether a manifest's `expiresAt` has passed (unparseable → expired, fail-closed). */
export function isExpired(expiresAt: string | null, nowMs: number): boolean {
  if (expiresAt === null) return false;
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return true; // unparseable expiry → treat as expired (fail-closed)
  return at <= nowMs;
}
