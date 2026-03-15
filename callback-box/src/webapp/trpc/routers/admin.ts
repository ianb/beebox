import { z } from "zod";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { loadTelegramConfig } from "../../../connectors/telegram.js";
import { createTelegramService } from "../../../services/telegram.js";
import { createClaudeCliService } from "../../../services/claude-cli.js";

function baseServerUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  url.pathname = url.pathname.replace(/\/[^/]+\/?$/, "");
  return url.origin + url.pathname;
}

/**
 * Per-box admin router (Telegram, box config).
 */
export const adminRouter = router({
  telegramStatus: publicProcedure.query(async ({ ctx }) => {
    const config = await loadTelegramConfig(ctx.boxRoot);
    if (!config) {
      let publicUrl: string | undefined;
      try {
        const boxJson = JSON.parse(await fs.readFile(path.join(ctx.boxRoot, "config/box.json"), "utf-8"));
        if (boxJson.publicUrl) publicUrl = boxJson.publicUrl;
      } catch { /* */ }
      publicUrl = publicUrl ?? process.env.PUBLIC_URL ?? undefined;
      return { configured: false, publicUrl, boxSlug: ctx.boxSlug };
    }

    const tg = ctx.services.telegram ?? createTelegramService(config.botToken);
    try {
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
        boxSlug: ctx.boxSlug,
      };
    } catch (err) {
      return {
        configured: true,
        botToken: config.botToken,
        error: (err as Error).message,
        boxSlug: ctx.boxSlug,
      };
    }
  }),

  telegramSetup: publicProcedure
    .input(z.object({ botToken: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const tg = ctx.services.telegram ?? createTelegramService(input.botToken);
      let me;
      try {
        me = await tg.getMe();
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid bot token: ${(err as Error).message}`,
        });
      }

      const webhookSecret = crypto.randomBytes(32).toString("hex");
      const configDir = path.join(ctx.boxRoot, "config/connectors");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "telegram.secret.json"),
        JSON.stringify({ botToken: input.botToken, webhookSecret }, null, 2) + "\n",
      );

      let publicUrl: string | undefined;
      try {
        const boxJson = JSON.parse(await fs.readFile(path.join(ctx.boxRoot, "config/box.json"), "utf-8"));
        if (boxJson.publicUrl) publicUrl = boxJson.publicUrl;
      } catch { /* */ }
      publicUrl = publicUrl ?? process.env.PUBLIC_URL ?? undefined;

      let webhookUrl: string | null = null;
      if (publicUrl) {
        webhookUrl = `${baseServerUrl(publicUrl)}/webhook/${ctx.boxSlug}/telegram`;
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
    }),

  telegramDisconnect: publicProcedure.mutation(async ({ ctx }) => {
    const config = await loadTelegramConfig(ctx.boxRoot);
    if (config) {
      try {
        const tg = ctx.services.telegram ?? createTelegramService(config.botToken);
        await tg.deleteWebhook();
      } catch { /* best effort */ }
    }

    const configPath = path.join(ctx.boxRoot, "config/connectors/telegram.secret.json");
    try {
      await fs.unlink(configPath);
    } catch { /* already gone */ }

    return { success: true };
  }),

  boxConfig: publicProcedure.query(async ({ ctx }) => {
    const configPath = path.join(ctx.boxRoot, "config/box.json");
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return {
        boxSlug: ctx.boxSlug,
        allowedEmails: (config.allowedEmails ?? []) as string[],
        publicUrl: (config.publicUrl ?? null) as string | null,
      };
    } catch {
      return { boxSlug: ctx.boxSlug, allowedEmails: [] as string[], publicUrl: null as string | null };
    }
  }),

  updateBoxConfig: publicProcedure
    .input(z.object({ allowedEmails: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const configPath = path.join(ctx.boxRoot, "config/box.json");
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(await fs.readFile(configPath, "utf-8"));
      } catch { /* start fresh */ }

      existing.allowedEmails = input.allowedEmails.filter(
        (e) => typeof e === "string" && e.includes("@")
      );
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2) + "\n");

      return { success: true, allowedEmails: existing.allowedEmails as string[] };
    }),

  claudeStatus: publicProcedure.query(async ({ ctx }) => {
    const claude = ctx.services.claudeCli ?? createClaudeCliService();
    return claude.authStatus();
  }),

  claudeLogin: publicProcedure.mutation(async ({ ctx }) => {
    const claude = ctx.services.claudeCli ?? createClaudeCliService();
    const ownerEmail = process.env.CB_OWNER_EMAIL;
    const result = await claude.authLogin(ownerEmail);
    if (result.authUrl) {
      return { authUrl: result.authUrl, status: "waiting" as const };
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: result.error ?? "Failed to get auth URL",
    });
  }),

  claudeLogout: publicProcedure.mutation(async ({ ctx }) => {
    const claude = ctx.services.claudeCli ?? createClaudeCliService();
    return claude.authLogout();
  }),
});
