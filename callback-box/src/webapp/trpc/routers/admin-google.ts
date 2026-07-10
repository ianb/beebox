/**
 * Google-services admin procedures (status / OAuth setup / disconnect), split
 * out of `admin.ts` to keep it under the line cap. Spread into the admin router
 * so the client paths stay `trpc.admin.googleStatus` etc.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { ownerProcedure } from "../trpc.js";
import { loadGoogleTokens, getGoogleClientCreds, createOAuth2Client, GOOGLE_SCOPES } from "../../../connectors/google-auth.js";
import { loadBoxConfig } from "../../../core/box/config.js";
import { baseServerUrl } from "../../base-server-url.js";
import { resolveBoxPublicUrl } from "../../../lib/public-url.js";

export const googleAdminProcedures = {
  googleStatus: ownerProcedure.query(async ({ ctx }) => {
    const creds = getGoogleClientCreds();
    if (!creds) {
      const enabledServices: Record<string, boolean> = {};
      return { available: false, hasTokens: false, scopes: GOOGLE_SCOPES, enabledServices };
    }
    const tokens = await loadGoogleTokens(ctx.boxRoot);
    const config = await loadBoxConfig(ctx.boxRoot);
    const enabledServices: Record<string, boolean> = Object.fromEntries(
      Object.entries(config.googleServices ?? {}),
    );
    return {
      available: true,
      hasTokens: !!(tokens && tokens.refreshToken),
      scopes: GOOGLE_SCOPES,
      enabledServices,
    };
  }),

  googleSetup: ownerProcedure
    .input(z.object({ returnPath: z.string().optional(), origin: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const creds = getGoogleClientCreds();
      if (!creds) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID/SECRET env vars.",
        });
      }
      // Prefer the browser origin; fall back to box.json publicUrl, then env.
      const publicUrl =
        input.origin || (await resolveBoxPublicUrl(ctx.boxRoot, { fallback: "http://localhost:3210" })) || "http://localhost:3210";
      const redirectUri = `${baseServerUrl(publicUrl)}/auth/google-services/callback`;
      const oauth2Client = createOAuth2Client({ clientId: creds.clientId, clientSecret: creds.clientSecret, redirectUri });
      const stateValue = input.returnPath ? `${ctx.boxSlug}:${input.returnPath}` : ctx.boxSlug;
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: GOOGLE_SCOPES,
        prompt: "consent",
        state: stateValue,
      });
      return { authUrl };
    }),

  googleDisconnect: ownerProcedure.mutation(async ({ ctx }) => {
    // Removes the centralized token — affects ALL boxes.
    const central = process.env.CB_GOOGLE_TOKENS_FILE;
    if (central) {
      try {
        await fs.unlink(central);
      } catch (_e) {
        // Already gone — nothing to disconnect.
      }
    }
    // Also clean up a legacy per-box token file if present.
    try {
      await fs.unlink(path.join(ctx.boxRoot, "config/connectors/google.secret.json"));
    } catch (_e) {
      // Already gone.
    }
    return { success: true };
  }),
};
