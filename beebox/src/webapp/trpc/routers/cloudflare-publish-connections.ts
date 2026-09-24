import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CloudflarePublishConnectionError,
  grantCloudflarePublishConnection,
  listCloudflarePublishConnections,
  revokeCloudflarePublishConnection,
  revokeCloudflarePublishGrant,
  saveCloudflarePublishConnection,
} from "../../../core/secrets/cloudflare-publish.js";
import { CloudflarePublishTokenVerificationError, createCloudflarePublishTokenVerifier } from "../../../services/cloudflare-publish-token-verifier.js";
import { authenticatedOwnerProcedure, router } from "../trpc.js";

const nameSchema = z.string().trim().regex(/^[a-z][\da-z-]{0,39}$/);
const accountIdSchema = z.string().trim().regex(/^[\da-f]{32}$/i);
const boxSlugSchema = z.string().trim().min(1).max(120);

function lifecycle<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch((error: unknown) => {
    if (error instanceof CloudflarePublishConnectionError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  });
}

/** Global-owner-only management of server-held Cloudflare account credentials. */
export const cloudflarePublishConnectionsRouter = router({
  /** Metadata only; never return the API token. */
  list: authenticatedOwnerProcedure.query(() =>
    lifecycle(() => listCloudflarePublishConnections()),
  ),

  /** Verify the token against the named account, then atomically save/rotate it. */
  save: authenticatedOwnerProcedure
    .input(z.object({
      name: nameSchema,
      accountId: accountIdSchema,
      apiToken: z.string().trim().min(1).max(4096),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const verifier = ctx.services.cloudflarePublishTokenVerifier ?? createCloudflarePublishTokenVerifier();
      let verified: { tokenId: string; status: "active"; tokenType: "account-api-token" | "user-api-token" };
      try {
        verified = await verifier.verify({ accountId: input.accountId, apiToken: input.apiToken });
      } catch (error) {
        // Only surface our fixed, sanitized diagnoses. Never return provider
        // response bodies, request details, or arbitrary fetch errors.
        const message = error instanceof CloudflarePublishTokenVerificationError
          ? error.message
          : "Cloudflare token verification could not be completed. Try again.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      return lifecycle(() => saveCloudflarePublishConnection({
        name: input.name,
        accountId: input.accountId,
        credentialType: verified.tokenType,
        apiToken: input.apiToken,
        tokenId: verified.tokenId,
        verifiedAt: new Date().toISOString(),
      }));
    }),

  /** The only grant level is server; tokens are never agent-readable. */
  grant: authenticatedOwnerProcedure
    .input(z.object({ name: nameSchema, boxSlug: boxSlugSchema }).strict())
    .mutation(async ({ input }) => {
      await lifecycle(() => grantCloudflarePublishConnection(input));
      return { success: true as const };
    }),

  revokeGrant: authenticatedOwnerProcedure
    .input(z.object({ name: nameSchema, boxSlug: boxSlugSchema }).strict())
    .mutation(async ({ input }) => {
      await lifecycle(() => revokeCloudflarePublishGrant(input));
      return { success: true as const };
    }),

  /** Local revoke drops the credential but preserves locator metadata for live publications. */
  revoke: authenticatedOwnerProcedure
    .input(z.object({ name: nameSchema }).strict())
    .mutation(async ({ input }) => {
      await lifecycle(() => revokeCloudflarePublishConnection(input.name, new Date().toISOString()));
      return { success: true as const };
    }),
});
