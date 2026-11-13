/**
 * Resolve the host's own TURN relay: the machine store's `turn-server` entry at
 * `server` access, a JSON string `{"secret": "<64 hex>", "urls": ["turn:…"]}`.
 * One value serves every box on the host; `deploy/server-bin/bbx-turn-install`
 * renders coturn's config from the same entry in the master store
 * (docs/plans/self-hosted-turn.md). The server signs short-lived credentials
 * with the secret using coturn's TURN REST scheme (`use-auth-secret`), so a
 * call start makes no outside request.
 */

import { createHmac } from "node:crypto";
import { z } from "zod";
import { parseJsonSecret } from "./secrets/json-secret.js";
import { resolveSecret, type SecretRead } from "./secrets/resolve.js";

export const TURN_SERVER_SECRET_NAME = "turn-server";

/** `turn:<ipv4>:3478?transport=udp|tcp` or `turn:[<ipv6>]:3478?transport=udp|tcp`. */
const TURN_URL_RE = /^turn:(\d{1,3}(?:\.\d{1,3}){3}|\[[\d:A-Fa-f]+]):3478\?transport=(?:udp|tcp)$/;
const IPV4_URL_RE = /^turn:\d/;

const turnServerSchema = z.object({
  secret: z.string().regex(/^[\da-f]{64}$/),
  urls: z
    .array(z.string().regex(TURN_URL_RE))
    .min(1)
    // The install check allocates over IPv4 (bbx-turn-install).
    .refine((urls) => urls.some((u) => IPV4_URL_RE.test(u)), { message: "needs at least one IPv4 turn: URL" }),
});

export type TurnServerKey = z.infer<typeof turnServerSchema>;

export async function getTurnServerKey(boxRoot: string, read: SecretRead): Promise<TurnServerKey | null> {
  const resolved = await resolveSecret({
    boxRoot,
    name: TURN_SERVER_SECRET_NAME,
    purpose: "calls",
    access: "server",
    observe: read.observe,
  });
  if (!resolved.ok) return null;
  return parseJsonSecret({ name: TURN_SERVER_SECRET_NAME, value: resolved.value.value, schema: turnServerSchema });
}

/**
 * coturn's TURN REST credentials: the username is `<expiry unix seconds>:<id>`
 * and the password is base64(HMAC-SHA1(secret, username)). coturn refuses the
 * username after its expiry. `id` appears in coturn's log.
 */
export function restCredentials(opts: { secret: string; nowMs: number; ttlSeconds: number; id: string }): { username: string; credential: string } {
  const username = `${String(Math.floor(opts.nowMs / 1000) + opts.ttlSeconds)}:${opts.id}`;
  const credential = createHmac("sha1", opts.secret).update(username).digest("base64");
  return { username, credential };
}

/** The STUN URLs on the same hosts as the TURN URLs, one per host. */
export function stunUrlsFor(urls: string[]): string[] {
  const hosts = new Set(urls.map((u) => TURN_URL_RE.exec(u)?.[1]).filter((h): h is string => h !== undefined));
  return [...hosts].map((h) => `stun:${h}:3478`);
}
