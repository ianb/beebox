import { z } from "zod";

export type CloudflareApiTokenType = "account-api-token" | "user-api-token";

export interface CloudflarePublishTokenVerifier {
  verify(args: { accountId: string; apiToken: string }): Promise<{
    tokenId: string;
    status: "active";
    tokenType: CloudflareApiTokenType;
  }>;
}

export type CloudflareVerifyFetch = (input: string, init?: RequestInit) => Promise<Response>;

const verificationResponseSchema = z.object({
  success: z.boolean(),
  result: z.object({ id: z.string().min(1), status: z.enum(["active", "disabled", "expired"]) }).optional(),
});

const bucketListResponseSchema = z.object({ success: z.boolean(), result: z.array(z.unknown()).optional() });

class CloudflarePublishTokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflarePublishTokenVerificationError";
  }
}

function verificationError(message: string): CloudflarePublishTokenVerificationError {
  return new CloudflarePublishTokenVerificationError(message);
}

/**
 * Verify either kind of Cloudflare API token without treating token validity as
 * proof of write scope. Account tokens use the account verify endpoint. User
 * tokens use the user verify endpoint, then a harmless R2 list read confirms
 * access to the requested account. R2/Worker write capabilities stay unverified
 * until actual server operations successfully exercise them.
 */
export function createCloudflarePublishTokenVerifier(deps?: { fetch?: CloudflareVerifyFetch }): CloudflarePublishTokenVerifier {
  const doFetch = deps?.fetch ?? fetch;
  const authorization = (apiToken: string) => ({ authorization: `Bearer ${apiToken}` });

  async function getVerification(url: string, apiToken: string): Promise<{ tokenId: string; status: "active" } | null> {
    const response = await doFetch(url, { method: "GET", headers: authorization(apiToken) });
    if (!response.ok) return null;
    const parsed = verificationResponseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.success || parsed.data.result === undefined) return null;
    return parsed.data.result.status === "active"
      ? { tokenId: parsed.data.result.id, status: "active" }
      : null;
  }

  return {
    async verify({ accountId, apiToken }) {
      const accountUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`;
      const accountToken = await getVerification(accountUrl, apiToken);
      if (accountToken !== null) return { ...accountToken, tokenType: "account-api-token" };

      const userUrl = "https://api.cloudflare.com/client/v4/user/tokens/verify";
      const userToken = await getVerification(userUrl, apiToken);
      if (userToken === null) throw verificationError("Cloudflare did not verify an active API token.");

      // User tokens are not account-bound. Confirm that this token can access
      // the account the admin selected using the R2 read permission publishing
      // requires anyway; this request is read-only and makes no bucket changes.
      const accountAccess = await doFetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets?per_page=1`,
        { method: "GET", headers: authorization(apiToken) },
      );
      if (!accountAccess.ok) throw verificationError("The active Cloudflare user token cannot read R2 in the selected account.");
      const buckets = bucketListResponseSchema.safeParse(await accountAccess.json());
      if (!buckets.success || !buckets.data.success || buckets.data.result === undefined) {
        throw verificationError("Cloudflare could not verify the token's access to the selected account.");
      }
      return { ...userToken, tokenType: "user-api-token" };
    },
  };
}

export function createFakeCloudflarePublishTokenVerifier(opts?: {
  error?: Error;
  tokenType?: CloudflareApiTokenType;
}): CloudflarePublishTokenVerifier & { verified: { accountId: string; apiToken: string }[] } {
  const verified: { accountId: string; apiToken: string }[] = [];
  return {
    verified,
    async verify(args) {
      verified.push({ ...args });
      if (opts?.error !== undefined) throw opts.error;
      return { tokenId: "fake-cloudflare-token-id", status: "active", tokenType: opts?.tokenType ?? "account-api-token" };
    },
  };
}
