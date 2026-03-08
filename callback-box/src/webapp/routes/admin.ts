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
import { isOwner, isAuthEnabled } from "../auth.js";
import { loadTelegramConfig } from "../../connectors/telegram.js";
import { loadGoogleSecret, saveGoogleSecret, createOAuth2Client, GOOGLE_SCOPES, type GoogleSecretConfig } from "../../connectors/google-auth.js";
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
    // State format: "boxSlug" or "boxSlug:returnPath"
    const colonIdx = (state || "").indexOf(":");
    const boxSlug = colonIdx !== -1 ? (state || "").slice(0, colonIdx) : (state || "");
    const returnPath = colonIdx !== -1 ? (state || "").slice(colonIdx + 1) : "admin";
    const box = boxes.find((b) => b.slug === boxSlug);

    if (!box) {
      return reply.status(400).send({ error: `Unknown box: ${boxSlug}` });
    }

    const returnUrl = `/${boxSlug}/${returnPath}`;

    if (!code) {
      return reply.redirect(`${returnUrl}?google=error&message=No+code+received`);
    }

    // Get credentials from env vars or google.secret.json
    const secret = await loadGoogleSecret(box.boxRoot);
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || (secret && secret.clientId);
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || (secret && secret.clientSecret);
    if (!clientId || !clientSecret) {
      return reply.redirect(`${returnUrl}?google=error&message=OAuth+not+configured`);
    }

    // Derive redirect URI from the actual request URL (this IS the redirect endpoint)
    const proto = request.headers["x-forwarded-proto"] || request.protocol;
    const host = request.headers["x-forwarded-host"] || request.hostname;
    const redirectUri = `${proto}://${host}/auth/google-services/callback`;
    const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri });

    try {
      const { tokens } = await oauth2Client.getToken(code);
      const updates: Partial<GoogleSecretConfig> = {};
      if (tokens.refresh_token) updates.refreshToken = tokens.refresh_token;
      if (tokens.access_token) updates.accessToken = tokens.access_token;
      if (tokens.expiry_date) updates.tokenExpiry = new Date(tokens.expiry_date).toISOString();
      await saveGoogleSecret(box.boxRoot, updates);
      return reply.redirect(`${returnUrl}?google=connected`);
    } catch (err) {
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
      webhookUrl = `${publicUrl}/webhook/${boxSlug}/telegram`;
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
  // Uses GOOGLE_OAUTH_CLIENT_ID/SECRET env vars, falling back to
  // config/connectors/google.secret.json (set up via `cb google-auth`).

  async function getGoogleOAuthCreds(): Promise<{ clientId: string; clientSecret: string } | null> {
    const envId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (envId && envSecret) return { clientId: envId, clientSecret: envSecret };

    const secret = await loadGoogleSecret(boxRoot);
    if (secret && secret.clientId && secret.clientSecret) {
      return { clientId: secret.clientId, clientSecret: secret.clientSecret };
    }
    return null;
  }

  server.get("/api/admin/google-status", async () => {
    const creds = await getGoogleOAuthCreds();
    if (!creds) {
      return { available: false, hasTokens: false, scopes: GOOGLE_SCOPES };
    }
    const secret = await loadGoogleSecret(boxRoot);
    return {
      available: true,
      hasTokens: !!(secret && secret.refreshToken),
      scopes: GOOGLE_SCOPES,
    };
  });

  server.post("/api/admin/google-setup", async (request, reply) => {
    const body = (request.body || {}) as { returnPath?: string; origin?: string };
    const creds = await getGoogleOAuthCreds();
    if (!creds) {
      return reply.status(400).send({ error: "Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID/SECRET env vars or run: cb google-auth" });
    }

    // Save client credentials to google.secret.json so connectors can use them
    await saveGoogleSecret(boxRoot, { clientId: creds.clientId, clientSecret: creds.clientSecret });

    // Use the caller's origin so the redirect goes back to where the user actually is
    const baseUrl = body.origin || await loadPublicUrl(boxRoot) || "http://localhost:3210";
    const redirectUri = `${baseUrl}/auth/google-services/callback`;
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
    const configPath = path.join(boxRoot, "config/connectors/google.secret.json");
    try {
      await fs.unlink(configPath);
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
      return { boxSlug, allowedEmails: config.allowedEmails ?? [], publicUrl: config.publicUrl ?? null, ownerEmail };
    } catch {
      return { boxSlug, allowedEmails: [], publicUrl: null, ownerEmail };
    }
  });

  server.post("/api/admin/box-config", async (request, reply) => {
    const body = request.body as { allowedEmails?: string[] };
    if (!body || !Array.isArray(body.allowedEmails)) {
      return reply.status(400).send({ error: "allowedEmails array is required" });
    }

    const configPath = path.join(boxRoot, "config/box.json");
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fs.readFile(configPath, "utf-8"));
    } catch { /* start fresh */ }

    existing.allowedEmails = body.allowedEmails.filter((e) => typeof e === "string" && e.includes("@"));
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(existing, null, 2) + "\n");

    return { success: true, allowedEmails: existing.allowedEmails };
  });
}
