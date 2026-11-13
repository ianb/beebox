/**
 * Resolve a box's Cloudflare TURN key: the machine store's `cloudflare-turn`
 * entry at `server` access, a JSON string `{"keyId": "…", "apiToken": "…"}`
 * (see `secrets/json-secret.ts` for why the store keeps values opaque). The
 * server spends it to mint short-lived relay credentials for a call
 * (`trpc/routers/chat-call.ts`, which logs each mint); the token never reaches
 * a browser. A box with no grant gets calls without a relay.
 */

import { z } from "zod";
import { parseJsonSecret } from "./secrets/json-secret.js";
import { resolveSecret, type SecretRead } from "./secrets/resolve.js";

export const CLOUDFLARE_TURN_SECRET_NAME = "cloudflare-turn";

export interface CloudflareTurnKey {
  keyId: string;
  apiToken: string;
}

const turnSecretSchema = z.object({
  keyId: z.string().min(1),
  apiToken: z.string().min(1),
});

export async function getCloudflareTurnKey(boxRoot: string, read: SecretRead): Promise<CloudflareTurnKey | null> {
  const resolved = await resolveSecret({
    boxRoot,
    name: CLOUDFLARE_TURN_SECRET_NAME,
    purpose: "calls",
    access: "server",
    observe: read.observe,
  });
  if (!resolved.ok) return null;
  if (resolved.value.suspect) {
    console.warn("[cloudflare-turn-key] the stored TURN key last failed a probe — it may be revoked.");
  }
  return parseJsonSecret({ name: CLOUDFLARE_TURN_SECRET_NAME, value: resolved.value.value, schema: turnSecretSchema });
}
