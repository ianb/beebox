/**
 * Admin routes — owner-only endpoints for system management.
 *
 * GET  /api/admin/claude-status — check Claude Code auth status
 * POST /api/admin/claude-login  — start Claude Code login, return auth URL
 * POST /api/admin/claude-logout — log out Claude Code
 * GET  /api/admin/telegram-status?box=<slug> — Telegram connector status
 * POST /api/admin/telegram-setup — save bot token, register webhook
 * POST /api/admin/telegram-disconnect — remove Telegram config
 * GET  /api/admin/box-config?box=<slug> — box config (allowedEmails, publicUrl)
 * POST /api/admin/box-config — update box config fields
 */

import { spawn, execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Bot } from "grammy";
import { isOwner, isAuthEnabled } from "../auth.js";
import type { BoxSpec } from "../server.js";
import { loadTelegramConfig } from "../../connectors/telegram.js";

export async function registerAdminRoutes(server: FastifyInstance, boxes?: BoxSpec[]) {
  // All admin routes require owner auth (skip when auth is disabled)
  server.addHook("preHandler", async (request, reply) => {
    if (isAuthEnabled() && !isOwner(request)) {
      return reply.status(403).send({ error: "Owner access required" });
    }
  });

  server.get("/api/admin/claude-status", async () => {
    return new Promise<Record<string, unknown>>((resolve) => {
      execFile("claude", ["auth", "status"], { timeout: 10000 }, (err, stdout) => {
        // claude auth status exits 1 when not logged in, but still outputs JSON to stdout
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

  // Track the active login process so we don't spawn multiple
  let activeLogin: { process: ReturnType<typeof spawn>; authUrl: string | null } | null = null;

  server.post("/api/admin/claude-login", async (_request, reply) => {
    if (activeLogin) {
      // Return existing URL if we have one
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
      // Look for the OAuth URL in the output
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

    // Wait up to 10 seconds for the URL to appear
    for (let i = 0; i < 20; i++) {
      if (authUrl) {
        return { authUrl, status: "waiting" };
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // If we still don't have a URL, return what we have
    if (authUrl) {
      return { authUrl, status: "waiting" };
    }

    // Kill the process if it didn't produce a URL
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

  // --- Telegram connector management ---

  function resolveBox(request: FastifyRequest): BoxSpec | null {
    const slug = (request.query as Record<string, string>).box;
    if (!boxes || boxes.length === 0) return null;
    if (!slug) return boxes[0]!;
    return boxes.find((b) => b.slug === slug) ?? null;
  }

  server.get("/api/admin/telegram-status", async (request, reply) => {
    const box = resolveBox(request);
    if (!box) return reply.status(400).send({ error: "No box configured" });

    const config = await loadTelegramConfig(box.boxRoot);
    if (!config) {
      // Read publicUrl for display even when not configured
      let publicUrl: string | undefined;
      try {
        const boxJson = JSON.parse(await fs.readFile(path.join(box.boxRoot, "config/box.json"), "utf-8"));
        publicUrl = boxJson.publicUrl;
      } catch { /* ignore */ }
      return { configured: false, publicUrl, boxSlug: box.slug };
    }

    // Fetch bot info and webhook status from Telegram
    try {
      const bot = new Bot(config.botToken);
      const [me, webhookInfo] = await Promise.all([
        bot.api.getMe(),
        bot.api.getWebhookInfo(),
      ]);
      const maskedToken = `...${config.botToken.slice(-4)}`;
      return {
        configured: true,
        botUsername: me.username,
        botFirstName: me.first_name,
        webhookUrl: webhookInfo.url || null,
        maskedToken,
        boxSlug: box.slug,
      };
    } catch (err) {
      return {
        configured: true,
        maskedToken: `...${config.botToken.slice(-4)}`,
        error: (err as Error).message,
        boxSlug: box.slug,
      };
    }
  });

  server.post("/api/admin/telegram-setup", async (request, reply) => {
    const box = resolveBox(request);
    if (!box) return reply.status(400).send({ error: "No box configured" });

    const { botToken } = request.body as { botToken?: string };
    if (!botToken || typeof botToken !== "string") {
      return reply.status(400).send({ error: "botToken is required" });
    }

    // Validate token by calling getMe
    const bot = new Bot(botToken);
    let me;
    try {
      me = await bot.api.getMe();
    } catch (err) {
      return reply.status(400).send({ error: `Invalid bot token: ${(err as Error).message}` });
    }

    // Generate webhook secret and write config
    const webhookSecret = crypto.randomBytes(32).toString("hex");
    const configDir = path.join(box.boxRoot, "config/connectors");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "telegram.secret.json"),
      JSON.stringify({ botToken, webhookSecret }, null, 2) + "\n",
    );

    // Register webhook
    let publicUrl: string | undefined;
    try {
      const boxJson = JSON.parse(await fs.readFile(path.join(box.boxRoot, "config/box.json"), "utf-8"));
      publicUrl = boxJson.publicUrl;
    } catch { /* ignore */ }

    let webhookUrl: string | null = null;
    if (publicUrl) {
      webhookUrl = `${publicUrl}/webhook/${box.slug}/telegram`;
      try {
        await bot.api.setWebhook(webhookUrl, {
          secret_token: webhookSecret,
          allowed_updates: ["message", "edited_message"],
        });
      } catch (err) {
        // Config saved but webhook failed — not fatal
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

  server.post("/api/admin/telegram-disconnect", async (request, reply) => {
    const box = resolveBox(request);
    if (!box) return reply.status(400).send({ error: "No box configured" });

    const config = await loadTelegramConfig(box.boxRoot);
    if (config) {
      // Delete webhook
      try {
        const bot = new Bot(config.botToken);
        await bot.api.deleteWebhook();
      } catch { /* best effort */ }
    }

    // Remove config file
    const configPath = path.join(box.boxRoot, "config/connectors/telegram.secret.json");
    try {
      await fs.unlink(configPath);
    } catch { /* already gone */ }

    return { success: true };
  });

  // --- Box configuration (allowedEmails, etc.) ---

  server.get("/api/admin/boxes", async () => {
    return { boxes: (boxes ?? []).map((b) => ({ slug: b.slug })) };
  });

  server.get("/api/admin/box-config", async (request, reply) => {
    const box = resolveBox(request);
    if (!box) return reply.status(400).send({ error: "No box configured" });

    const configPath = path.join(box.boxRoot, "config/box.json");
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return { boxSlug: box.slug, allowedEmails: config.allowedEmails ?? [], publicUrl: config.publicUrl ?? null };
    } catch {
      return { boxSlug: box.slug, allowedEmails: [], publicUrl: null };
    }
  });

  server.post("/api/admin/box-config", async (request, reply) => {
    const box = resolveBox(request);
    if (!box) return reply.status(400).send({ error: "No box configured" });

    const body = request.body as { allowedEmails?: string[] };
    if (!body || !Array.isArray(body.allowedEmails)) {
      return reply.status(400).send({ error: "allowedEmails array is required" });
    }

    // Read existing config and merge
    const configPath = path.join(box.boxRoot, "config/box.json");
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
