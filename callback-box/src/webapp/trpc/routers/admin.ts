import { z } from "zod";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, ownerProcedure } from "../trpc.js";
import { loadTelegramConfig } from "../../../connectors/telegram.js";
import { createTelegramService } from "../../../services/telegram.js";
import { createClaudeCliService } from "../../../services/claude-cli.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import { resolveBoxPublicUrl } from "../../../lib/public-url.js";
import { baseServerUrl } from "../../base-server-url.js";
import { googleAdminProcedures } from "./admin-google.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { errnoCode, errorMessage } from "../../../lib/error-guards.js";

/**
 * Per-box admin router (Telegram, box config).
 */
export const adminRouter = router({
  telegramStatus: ownerProcedure.query(async ({ ctx }) => {
    const config = await loadTelegramConfig(ctx.boxRoot);
    if (!config) {
      const publicUrl = await resolveBoxPublicUrl(ctx.boxRoot);
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
        error: errorMessage(err),
        boxSlug: ctx.boxSlug,
      };
    }
  }),

  telegramSetup: ownerProcedure
    .input(z.object({ botToken: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const tg = ctx.services.telegram ?? createTelegramService(input.botToken);
      let me;
      try {
        me = await tg.getMe();
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid bot token: ${errorMessage(err)}`,
        });
      }

      const webhookSecret = crypto.randomBytes(32).toString("hex");
      const configDir = path.join(ctx.boxRoot, "config/connectors");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "telegram.secret.json"),
        JSON.stringify({ botToken: input.botToken, webhookSecret }, null, 2) + "\n",
      );

      const publicUrl = await resolveBoxPublicUrl(ctx.boxRoot);

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
            webhookError: errorMessage(err),
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

  telegramDisconnect: ownerProcedure.mutation(async ({ ctx }) => {
    const config = await loadTelegramConfig(ctx.boxRoot);
    if (config) {
      try {
        const tg = ctx.services.telegram ?? createTelegramService(config.botToken);
        await tg.deleteWebhook();
      } catch (e) { console.warn("Failed to delete Telegram webhook during disconnect (continuing):", e); }
    }

    const configPath = path.join(ctx.boxRoot, "config/connectors/telegram.secret.json");
    try {
      await fs.unlink(configPath);
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn("Could not remove Telegram config file (may already be gone):", e);
      }
    }

    return { success: true };
  }),

  boxConfig: ownerProcedure.query(async ({ ctx }) => {
    const configPath = path.join(ctx.boxRoot, "config/box.json");
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return {
        boxSlug: ctx.boxSlug,
        allowedEmails: (config.allowedEmails ?? []) as string[],
        publicUrl: (config.publicUrl ?? null) as string | null,
        ownerEmail: process.env.CB_OWNER_EMAIL || null,
        googleServices: (config.googleServices ?? {}) as Partial<Record<"calendar" | "gmail" | "drive", boolean>>,
      };
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.debug("box.json missing or unreadable, returning default box config:", e);
      }
      return {
        boxSlug: ctx.boxSlug,
        allowedEmails: [] as string[],
        publicUrl: null as string | null,
        ownerEmail: process.env.CB_OWNER_EMAIL || null,
        googleServices: {} as Partial<Record<"calendar" | "gmail" | "drive", boolean>>,
      };
    }
  }),

  gmailConfig: ownerProcedure.query(async ({ ctx }) => {
    const configPath = path.join(ctx.boxRoot, "config/connectors/gmail.json");
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return {
        query: typeof config.query === "string" ? config.query : "",
        labels: Array.isArray(config.labels)
          ? (config.labels.filter((l: unknown): l is string => typeof l === "string"))
          : ([] as string[]),
      };
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.debug("gmail.json missing or unreadable, returning empty Gmail config:", e);
      }
      return { query: "", labels: [] as string[] };
    }
  }),

  updateGmailConfig: ownerProcedure
    .input(
      z.object({
        query: z.string(),
        labels: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const next: { query?: string; labels?: string[] } = {};
      const trimmedQuery = input.query.trim();
      if (trimmedQuery) next.query = trimmedQuery;
      const cleanedLabels = input.labels.map((l) => l.trim()).filter((l) => l.length > 0);
      if (cleanedLabels.length > 0) next.labels = cleanedLabels;

      const configPath = path.join(ctx.boxRoot, "config/connectors/gmail.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(next, null, 2) + "\n");
      await stageAndCommitPaths(ctx.boxRoot, {
        paths: ["config/connectors/gmail.json"],
        message: "Update Gmail filter config",
      });

      return { query: next.query ?? "", labels: next.labels ?? [] };
    }),

  updateBoxConfig: ownerProcedure
    .input(
      z
        .object({
          allowedEmails: z.array(z.string()).optional(),
          googleServices: z.record(z.string(), z.boolean()).optional(),
        })
        .refine((v) => v.allowedEmails !== undefined || v.googleServices !== undefined, {
          message: "At least one of allowedEmails or googleServices is required",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const configPath = path.join(ctx.boxRoot, "config/box.json");

      // Serialize the read-merge-write on box.json so a concurrent
      // allowedEmails update and a googleServices update can't drop one.
      return withCardLock(configPath, async () => {
        let existing: Record<string, unknown> = {};
        try {
          existing = JSON.parse(await fs.readFile(configPath, "utf-8"));
        } catch (e) {
          if (errnoCode(e) !== "ENOENT") {
            console.debug("box.json missing or unreadable, starting fresh config:", e);
          }
        }

        const changed: string[] = [];
        if (input.allowedEmails) {
          existing.allowedEmails = input.allowedEmails.filter(
            (e) => typeof e === "string" && e.includes("@"),
          );
          changed.push("allowedEmails");
        }
        if (input.googleServices) {
          existing.googleServices = input.googleServices;
          changed.push("googleServices");
        }
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(existing, null, 2) + "\n");
        await stageAndCommitPaths(ctx.boxRoot, {
          paths: ["config/box.json"],
          message: `Update box config: ${changed.join(", ")}`,
        });

        return {
          success: true,
          allowedEmails: (existing.allowedEmails ?? []) as string[],
          googleServices: (existing.googleServices ?? {}) as Partial<Record<"calendar" | "gmail" | "drive", boolean>>,
        };
      });
    }),

  ...googleAdminProcedures,

  claudeStatus: ownerProcedure.query(async ({ ctx }) => {
    const claude = ctx.services.claudeCli ?? createClaudeCliService();
    return claude.authStatus();
  }),

  claudeLogin: ownerProcedure.mutation(async ({ ctx }) => {
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

  claudeLogout: ownerProcedure.mutation(async ({ ctx }) => {
    const claude = ctx.services.claudeCli ?? createClaudeCliService();
    return claude.authLogout();
  }),
});
