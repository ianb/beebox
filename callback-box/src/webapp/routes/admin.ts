/**
 * Admin routes — owner-only endpoints for system management.
 *
 * System-wide (registered at root):
 *   GET  /api/admin/claude-status — check Claude Code auth status
 *   POST /api/admin/claude-login  — start Claude Code login, return auth URL
 *   POST /api/admin/claude-logout — log out Claude Code
 *
 * Per-box (registered under /:boxSlug):
 *   GET  /api/admin/telegram-status — Telegram connector status
 *   POST /api/admin/telegram-setup — save bot token, register webhook
 *   POST /api/admin/telegram-disconnect — remove Telegram config
 *   GET  /api/admin/google-status — Google OAuth status
 *   POST /api/admin/google-setup — save credentials, get auth URL
 *   POST /api/admin/google-disconnect — remove Google tokens
 *   GET  /api/admin/box-config — box config (allowedEmails, publicUrl)
 *   POST /api/admin/box-config — update box config fields
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { isOwner, isAuthEnabled } from "../auth.js";
import { loadTelegramConfig } from "../../connectors/telegram.js";
import { loadGoogleTokens, saveGoogleTokens, getGoogleClientCreds, createOAuth2Client, GOOGLE_SCOPES, type GoogleTokens } from "../../connectors/google-auth.js";
import { loadBoxConfig } from "../box-config.js";
import type { Services } from "../../services/index.js";
import { createTelegramService } from "../../services/telegram.js";
import { createClaudeCliService } from "../../services/claude-cli.js";

async function loadPublicUrl(boxRoot: string): Promise<string | undefined> {
  try {
    const boxJson = JSON.parse(await fs.readFile(path.join(boxRoot, "config/box.json"), "utf-8"));
    if (boxJson.publicUrl) return boxJson.publicUrl;
  } catch { /* ignore */ }
  return process.env.PUBLIC_URL ?? undefined;
}

/**
 * Extract the base server URL from a box's publicUrl by stripping the
 * trailing path segment (the box slug). E.g.
 * "https://box.example.com/ledger" → "https://box.example.com"
 */
function baseServerUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  url.pathname = url.pathname.replace(/\/[^/]+\/?$/, "");
  // Strip trailing slash to avoid double-slash when appending paths
  const base = url.origin + url.pathname;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function addOwnerCheck(server: FastifyInstance) {
  server.addHook("preHandler", async (request, reply) => {
    if (isAuthEnabled() && !isOwner(request)) {
      return reply.status(403).send({ error: "Owner access required" });
    }
  });
}

/**
 * System-wide admin routes (Claude Code auth). Registered at root level.
 */
export async function registerSystemAdminRoutes(server: FastifyInstance, services: Services = {}) {
  addOwnerCheck(server);

  const claude = services.claudeCli ?? createClaudeCliService();

  server.get("/api/admin/claude-status", async () => {
    return claude.authStatus();
  });

  server.post("/api/admin/claude-login", async (_request, reply) => {
    const ownerEmail = process.env.CB_OWNER_EMAIL;
    const result = await claude.authLogin(ownerEmail);
    if (result.authUrl) {
      return { authUrl: result.authUrl, status: "waiting" };
    }
    return reply.status(500).send({ error: result.error ?? "Failed to get auth URL" });
  });

  server.post("/api/admin/claude-logout", async () => {
    return claude.authLogout();
  });
}

/**
 * Root-level Google Services OAuth callback. Registered at root so one redirect URI
 * works for all boxes — the box slug is passed via the OAuth `state` parameter.
 *
 *   GET /auth/google-services/callback — OAuth callback from Google
 */
export async function registerGoogleServicesCallback(server: FastifyInstance, { boxes }: { boxes: Array<{ slug: string; boxRoot: string }> }) {
  server.get("/auth/google-services/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    console.log("[google-oauth] Callback received, state:", state, "code:", code ? "present" : "missing");
    // State format: "boxSlug" or "boxSlug:returnPath"
    const colonIdx = (state || "").indexOf(":");
    const boxSlug = colonIdx !== -1 ? (state || "").slice(0, colonIdx) : (state || "");
    const returnPath = colonIdx !== -1 ? (state || "").slice(colonIdx + 1) : "admin";
    const box = boxes.find((b) => b.slug === boxSlug);

    if (!box) {
      console.log("[google-oauth] Unknown box:", boxSlug, "known boxes:", boxes.map((b) => b.slug));
      return reply.status(400).send({ error: `Unknown box: ${boxSlug}` });
    }

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
    const publicUrl = await loadPublicUrl(box.boxRoot) || `${request.protocol}://${request.hostname}`;
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
      console.log("[google-oauth] Token exchange failed:", (err as Error).message);
      const message = encodeURIComponent((err as Error).message);
      return reply.redirect(`${returnUrl}?google=error&message=${message}`);
    }
  });
}

/**
 * Per-box admin routes (Telegram, box config). Registered under each box prefix.
 */
export async function registerBoxAdminRoutes(server: FastifyInstance, { boxRoot, boxSlug, services = {} }: { boxRoot: string; boxSlug: string; services?: Services }) {
  addOwnerCheck(server);

  // --- Telegram connector management ---

  /** Get or create a TelegramService for a given bot token */
  function getTelegram(botToken: string) {
    return services.telegram ?? createTelegramService(botToken);
  }

  server.get("/api/admin/telegram-status", async () => {
    const config = await loadTelegramConfig(boxRoot);
    if (!config) {
      const publicUrl = await loadPublicUrl(boxRoot);
      return { configured: false, publicUrl, boxSlug };
    }

    try {
      const tg = getTelegram(config.botToken);
      const [me, webhookInfo] = await Promise.all([
        tg.getMe(),
        tg.getWebhookInfo(),
      ]);
      return {
        configured: true,
        botUsername: me.username,
        botFirstName: me.first_name,
        webhookUrl: webhookInfo.url || null,
        botToken: config.botToken,
        boxSlug,
      };
    } catch (err) {
      return {
        configured: true,
        botToken: config.botToken,
        error: (err as Error).message,
        boxSlug,
      };
    }
  });

  server.post("/api/admin/telegram-setup", async (request, reply) => {
    const { botToken } = request.body as { botToken?: string };
    if (!botToken || typeof botToken !== "string") {
      return reply.status(400).send({ error: "botToken is required" });
    }

    const tg = getTelegram(botToken);
    let me;
    try {
      me = await tg.getMe();
    } catch (err) {
      return reply.status(400).send({ error: `Invalid bot token: ${(err as Error).message}` });
    }

    const webhookSecret = crypto.randomBytes(32).toString("hex");
    const configDir = path.join(boxRoot, "config/connectors");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "telegram.secret.json"),
      JSON.stringify({ botToken, webhookSecret }, null, 2) + "\n",
    );

    const publicUrl = await loadPublicUrl(boxRoot);
    let webhookUrl: string | null = null;
    if (publicUrl) {
      webhookUrl = `${baseServerUrl(publicUrl)}/webhook/${boxSlug}/telegram`;
      try {
        await tg.setWebhook(webhookUrl, {
          secret_token: webhookSecret,
          allowed_updates: ["message", "edited_message"],
        });
      } catch (err) {
        return {
          success: true,
          botUsername: me.username,
          botFirstName: me.first_name,
          webhookUrl,
          webhookError: (err as Error).message,
        };
      }
    }

    return {
      success: true,
      botUsername: me.username,
      botFirstName: me.first_name,
      webhookUrl,
    };
  });

  server.post("/api/admin/telegram-disconnect", async () => {
    const config = await loadTelegramConfig(boxRoot);
    if (config) {
      try {
        const tg = getTelegram(config.botToken);
        await tg.deleteWebhook();
      } catch { /* best effort */ }
    }

    const configPath = path.join(boxRoot, "config/connectors/telegram.secret.json");
    try {
      await fs.unlink(configPath);
    } catch { /* already gone */ }

    return { success: true };
  });

  // --- Google Services OAuth ---
  // Client credentials from GOOGLE_OAUTH_CLIENT_ID/SECRET env vars.
  // Tokens stored centrally via CB_GOOGLE_TOKENS_FILE (shared across all boxes).
  // Per-box policy in box.json googleServices field.

  server.get("/api/admin/google-status", async () => {
    const creds = getGoogleClientCreds();
    if (!creds) {
      return { available: false, hasTokens: false, scopes: GOOGLE_SCOPES, enabledServices: {} };
    }
    const tokens = await loadGoogleTokens(boxRoot);
    const config = await loadBoxConfig(boxRoot);
    return {
      available: true,
      hasTokens: !!(tokens && tokens.refreshToken),
      scopes: GOOGLE_SCOPES,
      enabledServices: config.googleServices || {},
    };
  });

  server.post("/api/admin/google-setup", async (request, reply) => {
    const body = (request.body || {}) as { returnPath?: string; origin?: string };
    const creds = getGoogleClientCreds();
    if (!creds) {
      return reply.status(400).send({ error: "Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID/SECRET env vars." });
    }

    // Use the server base URL (strip box slug from publicUrl) for the redirect URI
    const publicUrl = body.origin || await loadPublicUrl(boxRoot) || "http://localhost:3210";
    const baseUrl = baseServerUrl(publicUrl);
    const redirectUri = `${baseUrl}/auth/google-services/callback`;
    console.log("[google-oauth] Setup: publicUrl=%s baseUrl=%s redirectUri=%s", publicUrl, baseUrl, redirectUri);
    const oauth2Client = createOAuth2Client({ clientId: creds.clientId, clientSecret: creds.clientSecret, redirectUri });

    // State format: "boxSlug" or "boxSlug:returnPath"
    const stateValue = body.returnPath ? `${boxSlug}:${body.returnPath}` : boxSlug;

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: GOOGLE_SCOPES,
      prompt: "consent",
      state: stateValue,
    });

    return { authUrl };
  });

  server.post("/api/admin/google-disconnect", async () => {
    // Disconnect removes the centralized token. This affects ALL boxes.
    const central = process.env.CB_GOOGLE_TOKENS_FILE;
    if (central) {
      try {
        await fs.unlink(central);
      } catch (_e) { /* already gone */ }
    }
    // Also clean up legacy per-box file if present
    const legacyPath = path.join(boxRoot, "config/connectors/google.secret.json");
    try {
      await fs.unlink(legacyPath);
    } catch (_e) { /* already gone */ }
    return { success: true };
  });

  // --- Box configuration (allowedEmails, etc.) ---

  server.get("/api/admin/box-config", async () => {
    const configPath = path.join(boxRoot, "config/box.json");
    const ownerEmail = process.env.CB_OWNER_EMAIL || null;
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return {
        boxSlug,
        allowedEmails: config.allowedEmails ?? [],
        publicUrl: config.publicUrl ?? null,
        ownerEmail,
        googleServices: config.googleServices ?? {},
      };
    } catch {
      return { boxSlug, allowedEmails: [], publicUrl: null, ownerEmail, googleServices: {} };
    }
  });

  server.post("/api/admin/box-config", async (request, reply) => {
    const body = request.body as { allowedEmails?: string[]; googleServices?: Record<string, boolean> };
    if (!body || (!body.allowedEmails && !body.googleServices)) {
      return reply.status(400).send({ error: "At least one of allowedEmails or googleServices is required" });
    }

    const configPath = path.join(boxRoot, "config/box.json");
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fs.readFile(configPath, "utf-8"));
    } catch { /* start fresh */ }

    if (body.allowedEmails) {
      existing.allowedEmails = body.allowedEmails.filter((e) => typeof e === "string" && e.includes("@"));
    }
    if (body.googleServices) {
      existing.googleServices = body.googleServices;
    }
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(existing, null, 2) + "\n");

    const changed: string[] = [];
    if (body.allowedEmails) changed.push("allowedEmails");
    if (body.googleServices) changed.push("googleServices");
    await stageFiles(boxRoot, ["config/box.json"]);
    await commit(boxRoot, { message: `Update box config: ${changed.join(", ")}` });

    return { success: true, allowedEmails: existing.allowedEmails, googleServices: existing.googleServices };
  });
}
