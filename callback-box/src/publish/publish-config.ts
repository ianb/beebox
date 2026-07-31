/**
 * Persisted, NON-SECRET publish configuration — `config/publish.json` in the
 * box (`docs/plans/pub-setup-wrangler.md`, amendment 3).
 *
 * The Access values (team-domain origin + application `aud`) are deploy vars,
 * not secrets: they appear in every Access JWT and in the deployed Worker's
 * settings. They must survive between setups, because a plain `cb pub setup`
 * rerun redeploys the Worker — without this file it would bake empty vars and
 * silently 404 the `/a/` tiers that were working. Setup writes this file on
 * successful Access provisioning (or manual-flag entry) and reads it on every
 * later deploy; `cb pub status` diffs it against the deployed vars.
 */

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

/** Matches the Worker's expectation: a full team origin, no trailing slash. */
export const TEAM_DOMAIN_PATTERN = /^https:\/\/[\da-z-]+\.cloudflareaccess\.com$/;

const publishConfigSchema = z
  .object({
    accessTeamDomain: z.string().regex(TEAM_DOMAIN_PATTERN),
    accessAud: z.string().min(1),
  })
  .strict();

export type PublishConfig = z.infer<typeof publishConfigSchema>;

/** The on-disk home: non-secret, committed with the box config. */
export function publishConfigPath(boxRoot: string): string {
  return path.join(boxRoot, "config", "publish.json");
}

/**
 * Read the persisted publish config; `null` when absent. A file that exists
 * but fails the schema throws — a corrupted Access config silently treated as
 * "none" would redeploy empty vars and take the `/a/` tiers down.
 */
export async function readPublishConfig(boxRoot: string): Promise<PublishConfig | null> {
  let raw: string;
  try {
    raw = await readFile(publishConfigPath(boxRoot), "utf-8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
  return publishConfigSchema.parse(JSON.parse(raw));
}

/** Persist the publish config (pretty-printed; the box commit flow picks it up). */
export async function writePublishConfig(boxRoot: string, config: PublishConfig): Promise<void> {
  const target = publishConfigPath(boxRoot);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

/**
 * Normalize an Access org's bare `auth_domain` (`<team>.cloudflareaccess.com`)
 * to the full origin the Worker's `iss` check and JWKS URL construction
 * require (amendment 2). Returns `null` when the value doesn't normalize to
 * the expected shape — the caller refuses rather than deploying a broken issuer.
 */
export function normalizeTeamDomain(authDomain: string): string | null {
  const origin = authDomain.startsWith("https://") ? authDomain : `https://${authDomain}`;
  const trimmed = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return TEAM_DOMAIN_PATTERN.test(trimmed) ? trimmed : null;
}
