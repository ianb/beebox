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
 *   GET  /api/admin/google-oauth/callback — OAuth callback from Google
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

  server.get("/api/admin/google-status", async () => {
    const secret = await loadGoogleSecret(boxRoot);
    if (!secret || !secret.clientId) {
      return { configured: false, hasTokens: false, scopes: GOOGLE_SCOPES };
    }
    return {
      configured: true,
      hasTokens: !!secret.refreshToken,
      clientId: secret.clientId.slice(0, 20) + "...",
      scopes: GOOGLE_SCOPES,
    };
  });

  server.post("/api/admin/google-setup", async (request, reply) => {
    const body = request.body as { clientId?: string; clientSecret?: string };
    let clientId = body.clientId;
    let clientSecret = body.clientSecret;

    if (!clientId || !clientSecret) {
      // Re-auth: use existing credentials
      const existing = await loadGoogleSecret(boxRoot);
      if (!existing || !existing.clientId || !existing.clientSecret) {
        return reply.status(400).send({ error: "Client ID and secret are required" });
      }
      clientId = existing.clientId;
      clientSecret = existing.clientSecret;
    }

    await saveGoogleSecret(boxRoot, { clientId, clientSecret });

    const publicUrl = await loadPublicUrl(boxRoot);
    const redirectUri = `${publicUrl || "http://localhost:3210"}/${boxSlug}/api/admin/google-oauth/callback`;
    const oauth2Client = createOAuth2Client({ clientId, clientSecret, redirectUri });

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: GOOGLE_SCOPES,
      prompt: "consent",
    });

    return { authUrl };
  });

  server.get("/api/admin/google-oauth/callback", async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) {
      return reply.redirect(`/${boxSlug}/admin?google=error&message=No+code+received`);
    }

    const secret = await loadGoogleSecret(boxRoot);
    if (!secret || !secret.clientId || !secret.clientSecret) {
      return reply.redirect(`/${boxSlug}/admin?google=error&message=No+credentials+configured`);
    }

    const publicUrl = await loadPublicUrl(boxRoot);
    const redirectUri = `${publicUrl || "http://localhost:3210"}/${boxSlug}/api/admin/google-oauth/callback`;
    const oauth2Client = createOAuth2Client({ clientId: secret.clientId, clientSecret: secret.clientSecret, redirectUri });

    try {
      const { tokens } = await oauth2Client.getToken(code);
      const updates: Partial<GoogleSecretConfig> = {};
      if (tokens.refresh_token) updates.refreshToken = tokens.refresh_token;
      if (tokens.access_token) updates.accessToken = tokens.access_token;
      if (tokens.expiry_date) updates.tokenExpiry = new Date(tokens.expiry_date).toISOString();
      await saveGoogleSecret(boxRoot, updates);
      return reply.redirect(`/${boxSlug}/admin?google=connected`);
    } catch (err) {
      const message = encodeURIComponent((err as Error).message);
      return reply.redirect(`/${boxSlug}/admin?google=error&message=${message}`);
    }
  });

  server.post("/api/admin/google-disconnect", async () => {
    const secret = await loadGoogleSecret(boxRoot);
    if (secret) {
      // Overwrite with only credentials (saveGoogleSecret merges, so write directly)
      const configPath = path.join(boxRoot, "config/connectors/google.secret.json");
      const kept: GoogleSecretConfig = { clientId: secret.clientId, clientSecret: secret.clientSecret };
      await fs.writeFile(configPath, JSON.stringify(kept, null, 2));
    }
    return { success: true };
  });

  // --- Box configuration (allowedEmails, etc.) ---

  server.get("/api/admin/box-config", async () => {
    const configPath = path.join(boxRoot, "config/box.json");
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return { boxSlug, allowedEmails: config.allowedEmails ?? [], publicUrl: config.publicUrl ?? null };
    } catch {
      return { boxSlug, allowedEmails: [], publicUrl: null };
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
