/**
 * The submissions connector's stored credential — the per-box secret file
 * `config/connectors/publish.secret.json` (gitignored via the box scaffold),
 * holding an R2 token scoped to ONLY the ingestion bucket so a box compromise
 * can never rewrite published content or allowlists.
 *
 * One module owns the file's path/read/write AND the `--mint-connector-token`
 * flow that fills it: `cb pub setup` mints the token via the Cloudflare
 * token API (under the setup-only bootstrap token) with the exact per-bucket
 * scoping in code — no dashboard trip, no human fumbling the bucket picker.
 */

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import { staticBearer } from "../services/cloudflare-bearer.js";
import {
  type CloudflareTokensClient,
  R2_BUCKET_ITEM_GROUPS,
} from "../services/cloudflare-tokens.js";
import type { R2PublishStoreConfig } from "../services/publish-remote-store.js";

/** The on-disk shape (never the broad management token — ingestion-bucket-scoped only). */
const publishSecretSchema = z
  .object({
    accountId: z.string().min(1),
    bucket: z.string().min(1),
    apiToken: z.string().min(1),
  })
  .strict();

/** Path of the connector's secret file (same pattern as the other connector secrets). */
export function publishSecretPath(boxRoot: string): string {
  return path.join(boxRoot, "config", "connectors", "publish.secret.json");
}

/**
 * Read the connector credential from the box's secret file; `null` when the
 * file is absent (publishing not configured). A file that exists but fails
 * the schema throws — a malformed credential should be fixed, not silently
 * treated as "no publishing".
 */
export async function readPublishSecret(boxRoot: string): Promise<R2PublishStoreConfig | null> {
  let raw: string;
  try {
    raw = await readFile(publishSecretPath(boxRoot), "utf-8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
  const parsed = publishSecretSchema.parse(JSON.parse(raw));
  return { accountId: parsed.accountId, bucket: parsed.bucket, bearer: staticBearer(parsed.apiToken) };
}

/** Write the secret file (mode 600 — it holds a live credential). */
async function writePublishSecret(boxRoot: string, secret: { accountId: string; bucket: string; apiToken: string }): Promise<string> {
  const target = publishSecretPath(boxRoot);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(secret, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  return target;
}

export type ConnectorSecretResult =
  | {
      ok: true;
      /** True when this run minted a token (false: the secret file already existed — nothing minted). */
      minted: boolean;
      /** Box-relative secret path (for the copy-to-server instruction). */
      relativePath: string;
      /** The minted token's Cloudflare-side name (for later dashboard revocation), when minted. */
      tokenName: string | null;
      /** The secret file's JSON body (to display for the server copy), when minted. */
      json: string | null;
    }
  | { ok: false; reason: "permission-groups-missing"; message: string };

/**
 * Ensure the box holds the connector credential: skip when the secret file
 * already exists (idempotent — reruns never mint duplicate tokens), else mint
 * an account-owned token scoped to the ingestion bucket and write the file.
 */
export async function ensureConnectorSecret(
  { boxRoot, accountId, bucketName }: { boxRoot: string; accountId: string; bucketName: string },
  deps: { tokens: CloudflareTokensClient },
): Promise<ConnectorSecretResult> {
  const relativePath = "config/connectors/publish.secret.json";
  if ((await readPublishSecret(boxRoot)) !== null) {
    return { ok: true, minted: false, relativePath, tokenName: null, json: null };
  }

  const available = await deps.tokens.listPermissionGroups();
  const wanted = R2_BUCKET_ITEM_GROUPS.map((name) => available.find((g) => g.name === name));
  const missing = R2_BUCKET_ITEM_GROUPS.filter((_name, i) => wanted[i] === undefined);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "permission-groups-missing",
      message: `the account's token permission groups don't include: ${missing.join(", ")} — Cloudflare may have renamed them; list them via GET /accounts/<id>/tokens/permission_groups and update R2_BUCKET_ITEM_GROUPS`,
    };
  }

  const tokenName = `callback-box publish connector (${bucketName})`;
  const minted = await deps.tokens.createR2BucketToken({
    name: tokenName,
    bucketName,
    permissionGroups: wanted.flatMap((g) => (g === undefined ? [] : [g])),
  });
  const secret = { accountId, bucket: bucketName, apiToken: minted.value };
  await writePublishSecret(boxRoot, secret);
  return { ok: true, minted: true, relativePath, tokenName, json: `${JSON.stringify(secret, null, 2)}` };
}
