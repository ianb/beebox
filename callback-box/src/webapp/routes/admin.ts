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
 *   GET  /api/admin/box-config — box config (allowedEmails, publicUrl)
 *   POST /api/admin/box-config — update box config fields
 */

import { spawn, execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import { Bot } from "grammy";
import { isOwner, isAuthEnabled } from "../auth.js";
import { loadTelegramConfig } from "../../connectors/telegram.js";

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
export async function registerSystemAdminRoutes(server: FastifyInstance) {
  addOwnerCheck(server);

  server.get("/api/admin/claude-status", async () => {
    return new Promise<Record<string, unknown>>((resolve) => {
      execFile("claude", ["auth", "status"], { timeout: 10000 }, (err, stdout) => {
        const output = stdout || "";
        try {
          const parsed = JSON.parse(output);
          resolve(parsed);
        } catch {
          const result = err
            ? { loggedIn: false, error: err.message }
            : { loggedIn: false, raw: output };
          resolve(result);
        }
      });
    });
  });

  let activeLogin: { process: ReturnType<typeof spawn>; authUrl: string | null } | null = null;

  server.post("/api/admin/claude-login", async (_request, reply) => {
    if (activeLogin) {
      if (activeLogin.authUrl) {
        return { authUrl: activeLogin.authUrl, status: "waiting" };
      }
      return { status: "starting" };
    }

    const ownerEmail = process.env.CB_OWNER_EMAIL;
    const args = ["auth", "login"];
    if (ownerEmail) {
      args.push("--email", ownerEmail);
    }

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "echo" },
    });

    let authUrl: string | null = null;
    let output = "";

    activeLogin = { process: child, authUrl: null };

    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      const urlMatch = output.match(/(https:\/\/claude\.ai\/oauth\/authorize\S+)/);
      if (urlMatch && !authUrl) {
        authUrl = urlMatch[1]!;
        activeLogin!.authUrl = authUrl;
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
      const urlMatch = output.match(/(https:\/\/claude\.ai\/oauth\/authorize\S+)/);
      if (urlMatch && !authUrl) {
        authUrl = urlMatch[1]!;
        activeLogin!.authUrl = authUrl;
      }
    });

    child.on("close", () => {
      activeLogin = null;
    });

    for (let i = 0; i < 20; i++) {
      if (authUrl) {
        return { authUrl, status: "waiting" };
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (authUrl) {
      return { authUrl, status: "waiting" };
    }

    child.kill();
    activeLogin = null;
    return reply.status(500).send({ error: "Failed to get auth URL", output });
  });

  server.post("/api/admin/claude-logout", async () => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      execFile("claude", ["auth", "logout"], { timeout: 10000 }, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  });
}

/**
 * Per-box admin routes (Telegram, box config). Registered under each box prefix.
 */
export async function registerBoxAdminRoutes(server: FastifyInstance, { boxRoot, boxSlug }: { boxRoot: string; boxSlug: string }) {
  addOwnerCheck(server);

  // --- Telegram connector management ---

  server.get("/api/admin/telegram-status", async () => {
    const config = await loadTelegramConfig(boxRoot);
    if (!config) {
      const publicUrl = await loadPublicUrl(boxRoot);
      return { configured: false, publicUrl, boxSlug };
    }

    try {
      const bot = new Bot(config.botToken);
      const [me, webhookInfo] = await Promise.all([
        bot.api.getMe(),
        bot.api.getWebhookInfo(),
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

    const bot = new Bot(botToken);
    let me;
    try {
      me = await bot.api.getMe();
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
        await bot.api.setWebhook(webhookUrl, {
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
        const bot = new Bot(config.botToken);
        await bot.api.deleteWebhook();
      } catch { /* best effort */ }
    }

    const configPath = path.join(boxRoot, "config/connectors/telegram.secret.json");
    try {
      await fs.unlink(configPath);
    } catch { /* already gone */ }

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
