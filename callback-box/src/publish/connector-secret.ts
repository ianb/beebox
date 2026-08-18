/**
 * The submissions connector's stored credential — an R2 token scoped to ONLY
 * the ingestion bucket, so a box compromise can never rewrite published content
 * or allowlists.
 *
 * It now lives in the machine secret store under `publish/<box-slug>`
 * (`docs/plans/secret-custody.md`, Track 3) as a JSON string
 * `{accountId, bucket, apiToken}`, with `owningBox` + `shareable: false`: the
 * token is scoped to ONE box's ingestion bucket, so sharing it would not be
 * merely unwise, it would point another box's submissions at the wrong bucket.
 * The legacy per-box file `config/connectors/publish.secret.json` remains a
 * read-only fallback for one transition window.
 *
 * One module owns read/write AND the `--mint-connector-token` flow that fills
 * it: `cb pub setup` mints the token via the Cloudflare token API (under the
 * setup-only bootstrap token) with the exact per-bucket scoping in code — no
 * dashboard trip, no human fumbling the bucket picker.
 */

import path from "node:path";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { parseJsonSecret } from "../core/secrets/json-secret.js";
import { setAndGrantSecret } from "../core/secrets/lifecycle.js";
import { resolveSecret } from "../core/secrets/resolve.js";
import { boxSlug } from "../lib/box-slug.js";
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

/** The store name this box's connector credential lives under. */
export function publishSecretName(slug: string): string {
  return `publish/${slug}`;
}

/** Path of the LEGACY per-box secret file, still read during the transition. */
export function publishSecretPath(boxRoot: string): string {
  return path.join(boxRoot, "config", "connectors", "publish.secret.json");
}

let warnedAboutLegacyFile = false;

/** Reset the once-per-process deprecation latch (tests only). */
export function resetPublishLegacyWarning(): void {
  warnedAboutLegacyFile = false;
}

/**
 * Read the connector credential: the store's `publish/<slug>` entry at
 * `server` access, then the legacy in-tree file. `null` when neither exists
 * (publishing not configured).
 *
 * The legacy FILE keeps its strictness — one that exists but fails the schema
 * throws, because a malformed credential the boxholder wrote should be fixed,
 * not silently read as "no publishing". A malformed STORE value degrades to
 * `null` with a warning instead (`secrets/json-secret.ts`): the store is
 * machine-wide, and one bad entry must not throw inside every connector sync.
 */
export async function readPublishSecret(boxRoot: string): Promise<R2PublishStoreConfig | null> {
  const name = publishSecretName(await boxSlug(boxRoot));
  const resolved = await resolveSecret({ boxRoot, name, purpose: "publish-submissions", access: "server" });
  if (resolved.ok) {
    const fields = parseJsonSecret({ name, value: resolved.value.value, schema: publishSecretSchema });
    if (fields === null) return null;
    return { accountId: fields.accountId, bucket: fields.bucket, bearer: staticBearer(fields.apiToken) };
  }

  let raw: string;
  try {
    raw = await readFile(publishSecretPath(boxRoot), "utf-8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
  const parsed = publishSecretSchema.parse(JSON.parse(raw));
  if (!warnedAboutLegacyFile) {
    warnedAboutLegacyFile = true;
    console.warn(
      `[publish] using the deprecated in-tree secret file ${publishSecretPath(boxRoot)}. ` +
        `Move it into the machine store (cb secrets set ${name} — the value is the JSON object ` +
        `itself, then cb secrets grant <box> ${name}) and delete the file.`,
    );
  }
  return { accountId: parsed.accountId, bucket: parsed.bucket, bearer: staticBearer(parsed.apiToken) };
}

export type ConnectorSecretResult =
  | {
      ok: true;
      /** True when this run minted a token (false: the credential already existed — nothing minted). */
      minted: boolean;
      /** The machine-store name the credential was written under. */
      storeName: string;
      /** The minted token's Cloudflare-side name (for later dashboard revocation), when minted. */
      tokenName: string | null;
      /** The credential's JSON body, when minted — see `ensureConnectorSecret`. */
      json: string | null;
    }
  | { ok: false; reason: "permission-groups-missing"; message: string };

/**
 * Ensure the box holds the connector credential: skip when one already
 * resolves (idempotent — reruns never mint duplicate tokens), else mint an
 * account-owned token scoped to the ingestion bucket and write it to the
 * machine store, granted to this box at `server` access.
 *
 * `json` carries the minted credential back to the CALLER, and exactly one
 * caller uses it: `cb pub setup`, an interactive command the boxholder runs at
 * a terminal, which prints it once so the same credential can be placed on the
 * server that also wakes this box. That display is preserved deliberately —
 * Cloudflare never shows a token value again after minting, so dropping it
 * would strand the operator with an unrecoverable secret — but it is the only
 * path by which our code renders the value, and it is a human-at-a-terminal
 * one. Nothing logs it, no route returns it.
 */
export async function ensureConnectorSecret(
  { boxRoot, accountId, bucketName }: { boxRoot: string; accountId: string; bucketName: string },
  deps: { tokens: CloudflareTokensClient },
): Promise<ConnectorSecretResult> {
  const slug = await boxSlug(boxRoot);
  const storeName = publishSecretName(slug);
  if ((await readPublishSecret(boxRoot)) !== null) {
    return { ok: true, minted: false, storeName, tokenName: null, json: null };
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
  await setAndGrantSecret({
    name: storeName,
    value: JSON.stringify(secret),
    slug,
    access: "server",
    note: `publish submissions connector (${bucketName})`,
    owningBox: slug,
    shareable: false,
  });
  return { ok: true, minted: true, storeName, tokenName, json: `${JSON.stringify(secret, null, 2)}` };
}
