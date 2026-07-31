/**
 * CloudflareTokensClient — the account-owned API-token surface behind
 * `cb pub setup --mint-connector-token`: list the account's token permission
 * groups and mint the ingestion-bucket-scoped R2 token the submissions
 * connector stores, so the user never assembles that token in the dashboard.
 *
 * Like the Access client, this takes the SETUP-ONLY bootstrap token (which
 * must carry "Account API Tokens: Edit") — wrangler's OAuth scopes cannot
 * call `/accounts/<id>/tokens`. The bootstrap token is prompted, used, and
 * revoked; only the narrow minted token is ever stored.
 *
 * Account-owned (not user-owned) tokens on purpose: they keep working if the
 * creating user later leaves the account — right for a server credential.
 *
 * ⚠️ UNVERIFIED: the real adapter cannot be exercised without a live
 * token-edit credential — request/response shaping (notably the one-time
 * `result.value` and the permission-group names) is unproven until the
 * collaborative live pass.
 */

import { z } from "zod";

import {
  type CloudflareApiErrorDetail,
  ProvisioningRequestError,
} from "./cloudflare-provisioning.js";

/** One token permission group (opaque per-account id + display name). */
export interface TokenPermissionGroup {
  id: string;
  name: string;
}

/** A freshly minted token. `value` is shown by Cloudflare exactly once — capture it now. */
export interface MintedToken {
  id: string;
  name: string;
  value: string;
}

/** The token surface `cb pub setup --mint-connector-token` uses. */
export interface CloudflareTokensClient {
  /** All permission groups mintable on this account (names are matched, ids are opaque). */
  listPermissionGroups(): Promise<TokenPermissionGroup[]>;
  /** Mint an account-owned token scoped to exactly one R2 bucket with the given groups. */
  createR2BucketToken(args: { name: string; bucketName: string; permissionGroups: TokenPermissionGroup[] }): Promise<MintedToken>;
}

export interface TokensClientConfig {
  accountId: string;
  /** The setup-only bootstrap token ("Account API Tokens: Edit") — never stored. */
  apiToken: string;
}

/** The subset of `fetch` the real adapter calls — injectable for URL/error-mapping unit tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const cfErrorSchema = z.object({ code: z.number(), message: z.string() });
const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(cfErrorSchema).optional(),
  result: z.unknown().optional(),
});
const permissionGroupSchema = z.object({ id: z.string(), name: z.string() });
const mintedTokenSchema = z.object({ id: z.string(), name: z.string(), value: z.string().min(1) });

/** Best-effort extraction of a Cloudflare JSON error body's `errors` array. */
async function tryReadCfErrors(res: Response): Promise<CloudflareApiErrorDetail[] | undefined> {
  try {
    const body: unknown = await res.clone().json();
    const parsed = z.object({ errors: z.array(cfErrorSchema).optional() }).safeParse(body);
    return parsed.success ? parsed.data.errors : undefined;
  } catch (_e) {
    // Non-JSON error body (e.g. a plain-text gateway error) — no CF detail available.
    return undefined;
  }
}

/** ⚠️ UNVERIFIED (no live-CF test). Real adapter over `/accounts/<id>/tokens`. */
export function createCloudflareTokensClient(config: TokensClientConfig, deps?: { fetch?: FetchLike | undefined }): CloudflareTokensClient {
  const doFetch = deps?.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/tokens`;
  const authHeaders: Record<string, string> = { authorization: `Bearer ${config.apiToken}` };

  async function request<T>(op: string, args: { method: string; path: string; body?: unknown; resultSchema: z.ZodType<T> }): Promise<T> {
    const { method, path, body, resultSchema } = args;
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: body === undefined ? authHeaders : { ...authHeaders, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      throw new ProvisioningRequestError({ op, status: res.status, statusText: res.statusText, cfErrors: await tryReadCfErrors(res) });
    }
    const envelope = envelopeSchema.safeParse(await res.json());
    if (!envelope.success || !envelope.data.success) {
      throw new ProvisioningRequestError({ op, status: res.status, statusText: "malformed or unsuccessful response envelope", cfErrors: envelope.success ? envelope.data.errors : undefined });
    }
    const result = resultSchema.safeParse(envelope.data.result);
    if (!result.success) {
      throw new ProvisioningRequestError({ op, status: res.status, statusText: `unexpected result shape: ${result.error.message}` });
    }
    return result.data;
  }

  return {
    async listPermissionGroups(): Promise<TokenPermissionGroup[]> {
      return request("token permission-groups list", {
        method: "GET",
        path: "/permission_groups",
        resultSchema: z.array(permissionGroupSchema),
      });
    },
    async createR2BucketToken(args: { name: string; bucketName: string; permissionGroups: TokenPermissionGroup[] }): Promise<MintedToken> {
      // Resource key shape per Cloudflare's token API: one specific bucket in
      // the default jurisdiction — the whole point is per-bucket scoping.
      const resourceKey = `com.cloudflare.edge.r2.bucket.${config.accountId}_default_${args.bucketName}`;
      return request("token create", {
        method: "POST",
        path: "",
        body: {
          name: args.name,
          policies: [
            {
              effect: "allow",
              resources: { [resourceKey]: "*" },
              permission_groups: args.permissionGroups.map((g) => ({ id: g.id, name: g.name })),
            },
          ],
        },
        resultSchema: mintedTokenSchema,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Fake — in-memory, for setup doctests. No network.
// ---------------------------------------------------------------------------

/** The two R2 per-bucket-object permission groups the connector token needs. */
export const R2_BUCKET_ITEM_GROUPS = ["Workers R2 Storage Bucket Item Read", "Workers R2 Storage Bucket Item Write"] as const;

export interface FakeTokensClientOptions {
  /** Available permission groups; defaults to the two R2 bucket-item groups. */
  permissionGroups?: TokenPermissionGroup[] | undefined;
}

export interface FakeTokensClient extends CloudflareTokensClient {
  /** Every minted token (with the resource-scoping inputs) in call order. */
  minted: { name: string; bucketName: string; groups: string[] }[];
  describe(): string;
}

/** Build a network-free {@link CloudflareTokensClient} with observable state. */
export function createFakeTokensClient(opts?: FakeTokensClientOptions): FakeTokensClient {
  const permissionGroups = opts?.permissionGroups ?? R2_BUCKET_ITEM_GROUPS.map((name, i) => ({ id: `pg-${i + 1}`, name }));
  const minted: { name: string; bucketName: string; groups: string[] }[] = [];

  return {
    minted,
    listPermissionGroups(): Promise<TokenPermissionGroup[]> {
      return Promise.resolve([...permissionGroups]);
    },
    createR2BucketToken(args: { name: string; bucketName: string; permissionGroups: TokenPermissionGroup[] }): Promise<MintedToken> {
      minted.push({ name: args.name, bucketName: args.bucketName, groups: args.permissionGroups.map((g) => g.name) });
      return Promise.resolve({ id: `tok-${minted.length}`, name: args.name, value: `minted-secret-${minted.length}` });
    },
    describe(): string {
      return [
        `permission groups: ${permissionGroups.map((g) => g.name).join(", ")}`,
        ...minted.map((m) => `minted '${m.name}' → bucket ${m.bucketName} [${m.groups.join(", ")}]`),
      ].join("\n");
    },
  };
}
