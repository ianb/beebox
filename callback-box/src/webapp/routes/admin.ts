/**
 * Google-services OAuth **redirect callback** — the one admin endpoint that
 * stays a raw route because it's a browser redirect flow, not a tRPC call:
 *   GET /auth/google-services/callback — exchange the OAuth code for tokens.
 *
 * Every other admin endpoint (claude / telegram / google status+setup, box
 * config) now lives in the `admin` tRPC router as owner-gated procedures.
 */

import type { FastifyInstance } from "fastify";
import { saveGoogleTokens, getGoogleClientCreds, createOAuth2Client, type GoogleTokens } from "../../connectors/google-auth.js";
import { parseOAuthState, consumeGoogleOAuthState } from "../../connectors/google-oauth-state.js";
import { isRecord } from "../../lib/is-record.js";
import { baseServerUrl } from "../base-server-url.js";
import { resolveBoxPublicUrl } from "../../lib/public-url.js";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Extract the base server URL from a box's publicUrl by stripping the
 * trailing path segment (the box slug). E.g.
 * "https://box.example.com/ledger" → "https://box.example.com"
 */

export async function registerGoogleServicesCallback(server: FastifyInstance, { boxes }: { boxes: Array<{ slug: string; boxRoot: string }> }) {
  server.get("/auth/google-services/callback", async (request, reply) => {
    const query = request.query;
    const code = isRecord(query) && typeof query["code"] === "string" ? query["code"] : undefined;
    const state = isRecord(query) && typeof query["state"] === "string" ? query["state"] : undefined;
    console.log("[google-oauth] Callback received, state:", state ? "present" : "missing", "code:", code ? "present" : "missing");
    // State format: "<boxSlug>:<nonce>". The nonce is a one-time server-minted
    // secret from the owner-gated setup flow — without a valid one, this
    // callback (reachable outside the auth wall) must NOT persist tokens.
    const parsed = parseOAuthState(state);
    if (!parsed) {
      console.log("[google-oauth] Missing/malformed state, rejecting");
      return reply.status(400).send({ error: "Invalid OAuth state" });
    }
    const boxSlug = parsed.boxSlug;
    const box = boxes.find((b) => b.slug === boxSlug);

    if (!box) {
      console.log("[google-oauth] Unknown box:", boxSlug, "known boxes:", boxes.map((b) => b.slug));
      return reply.status(400).send({ error: `Unknown box: ${boxSlug}` });
    }

    // Verify + consume the nonce. A caller who never passed the owner wall has
    // no valid nonce; this is the credential-swap / token-fixation gate.
    const consumed = consumeGoogleOAuthState({ boxRoot: box.boxRoot, nonce: parsed.nonce });
    if (!consumed) {
      console.log("[google-oauth] Invalid/expired/replayed state nonce, rejecting");
      return reply.status(400).send({ error: "Invalid or expired OAuth state" });
    }
    const returnPath = consumed.returnPath;
    const returnUrl = `/${boxSlug}/${returnPath}`;

    if (!code) {
      console.log("[google-oauth] No code received, redirecting to error");
      return reply.redirect(`${returnUrl}?google=error&message=No+code+received`);
    }

    const creds = getGoogleClientCreds();
    if (!creds) {
      console.log("[google-oauth] OAuth not configured (no env vars)");
      return reply.redirect(`${returnUrl}?google=error&message=OAuth+not+configured`);
    }

    // Use the server base URL (strip box slug from publicUrl)
    const publicUrl = (await resolveBoxPublicUrl(box.boxRoot)) || `${request.protocol}://${request.hostname}`;
    const baseUrl = baseServerUrl(publicUrl);
    const redirectUri = `${baseUrl}/auth/google-services/callback`;
    console.log("[google-oauth] Exchanging code, redirectUri:", redirectUri);
    const oauth2Client = createOAuth2Client({ clientId: creds.clientId, clientSecret: creds.clientSecret, redirectUri });

    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log("[google-oauth] Token exchange success, has refresh_token:", !!tokens.refresh_token, "has access_token:", !!tokens.access_token);
      const updates: Partial<GoogleTokens> = {};
      if (tokens.refresh_token) updates.refreshToken = tokens.refresh_token;
      if (tokens.access_token) updates.accessToken = tokens.access_token;
      if (tokens.expiry_date) updates.tokenExpiry = new Date(tokens.expiry_date).toISOString();
      // Save to centralized token storage (not per-box)
      await saveGoogleTokens(updates);
      console.log("[google-oauth] Saved tokens (centralized), redirecting to:", `${returnUrl}?google=connected`);
      return reply.redirect(`${returnUrl}?google=connected`);
    } catch (err) {
      console.log("[google-oauth] Token exchange failed:", errorMessage(err));
      const message = encodeURIComponent(errorMessage(err));
      return reply.redirect(`${returnUrl}?google=error&message=${message}`);
    }
  });
}

/**
 * Per-box admin routes (Telegram, box config). Registered under each box prefix.
 */
