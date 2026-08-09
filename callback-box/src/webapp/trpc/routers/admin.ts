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
import { createRealTailscaleDeps, deriveTailscaleBaseUrl, parseServeConfig } from "../../../services/tailscale.js";
import { normalizeAllowedEmails, updateBoxConfigFields } from "../../box-config-write.js";
import { canonicalizeEmail, getLocalUser } from "../../local-users.js";
import { inviteAdminProcedures } from "./admin-invites.js";
import { passwordResetAdminProcedures } from "./admin-password-resets.js";
import { describeAllowedUsers } from "./admin-user-details.js";
import { getGoogleClientCreds } from "../../../connectors/google-auth.js";

/**
 * Shape of `config/box.json`, validated on read (config is untrusted input).
 * `.default()` on every field lets a missing file or missing key read as the
 * documented default rather than casting an untyped `JSON.parse` result.
 */
const boxConfigSchema = z.object({
  allowedEmails: z.array(z.string()).default([]),
  publicUrl: z.string().nullable().default(null),
  googleServices: z
    .object({
      calendar: z.boolean().optional(),
      gmail: z.boolean().optional(),
      drive: z.boolean().optional(),
    })
    .default({}),
});

/** Shape of `config/connectors/gmail.json`, validated on read. */
const gmailConfigSchema = z.object({
  query: z.string().default(""),
  labels: z.array(z.string()).default([]),
  rules: z.array(z.unknown()).optional(),
  gc: z.boolean().optional(),
  gcIntervalHours: z.number().optional(),
});

/** Per-box admin router (Telegram, box config). */
export const adminRouter = router({
  ...inviteAdminProcedures,
  ...passwordResetAdminProcedures,

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
    let config: z.infer<typeof boxConfigSchema>;
    try {
      config = boxConfigSchema.parse(JSON.parse(await fs.readFile(configPath, "utf-8")));
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.debug("box.json missing or unreadable, returning default box config:", e);
      }
      config = boxConfigSchema.parse({});
    }
    const allowedEmails = normalizeAllowedEmails(config.allowedEmails);
    const configuredOwnerEmail = process.env.CB_OWNER_EMAIL
      ? canonicalizeEmail(process.env.CB_OWNER_EMAIL)
      : null;
    const userDetails = describeAllowedUsers({ allowedEmails, configuredOwnerEmail });
    return {
      boxSlug: ctx.boxSlug,
      allowedEmails,
      allowedUserDetails: userDetails.allowedUserDetails,
      localPasswordStatus: userDetails.localPasswordStatus,
      passwordResetEligibleEmails: userDetails.allowedUserDetails
        .filter((user) => user.resetEligible)
        .map((user) => user.email),
      publicUrl: config.publicUrl,
      ownerEmail: userDetails.ownerEmail,
      googleLoginConfigured: getGoogleClientCreds() !== null,
      googleServices: config.googleServices,
    };
  }),

  localAccountStatus: ownerProcedure
    .input(z.object({ email: z.string().max(254) }))
    .query(({ input }) => {
      const email = canonicalizeEmail(input.email);
      return { exists: getLocalUser(email) !== null };
    }),

  gmailConfig: ownerProcedure.query(async ({ ctx }) => {
    const configPath = path.join(ctx.boxRoot, "config/connectors/gmail.json");
    let config: z.infer<typeof gmailConfigSchema>;
    try {
      config = gmailConfigSchema.parse(JSON.parse(await fs.readFile(configPath, "utf-8")));
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.debug("gmail.json missing or unreadable, returning empty Gmail config:", e);
      }
      config = gmailConfigSchema.parse({});
    }
    return {
      query: config.query,
      labels: config.labels,
      usesRules: config.rules !== undefined,
    };
  }),

  updateGmailConfig: ownerProcedure
    .input(
      z.object({
        query: z.string(),
        labels: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const configPath = path.join(ctx.boxRoot, "config/connectors/gmail.json");
      return withCardLock(configPath, async () => {
        let existing: z.infer<typeof gmailConfigSchema> = gmailConfigSchema.parse({});
        try {
          existing = gmailConfigSchema.parse(JSON.parse(await fs.readFile(configPath, "utf-8")));
        } catch (error) {
          if (errnoCode(error) !== "ENOENT") throw error;
        }
        if (existing.rules !== undefined) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Named Gmail rules must be edited in config/connectors/gmail.json",
          });
        }
        const next: Record<string, unknown> = {};
        const trimmedQuery = input.query.trim();
        if (trimmedQuery) next.query = trimmedQuery;
        const cleanedLabels = input.labels.map((label) => label.trim()).filter(Boolean);
        if (cleanedLabels.length > 0) next.labels = cleanedLabels;
        if (existing.gc !== undefined) next.gc = existing.gc;
        if (existing.gcIntervalHours !== undefined) {
          next.gcIntervalHours = existing.gcIntervalHours;
        }
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(next, null, 2) + "\n");
        await stageAndCommitPaths(ctx.boxRoot, {
          paths: ["config/connectors/gmail.json"],
          message: "Update Gmail filter config",
        });
        return { query: trimmedQuery, labels: cleanedLabels };
      });
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
      const result = await updateBoxConfigFields({
        boxRoot: ctx.boxRoot,
        ...(input.allowedEmails === undefined ? {} : { allowedEmails: input.allowedEmails }),
        ...(input.googleServices === undefined ? {} : { googleServices: input.googleServices }),
      });
      if (result.commitError) {
        console.error(`[admin] box config was saved but its Git commit failed for ${ctx.boxRoot}:`, result.commitError);
      }
      const saved = boxConfigSchema.parse(result.config);
      return {
        success: true,
        commitWarning: result.commitError === null ? null : "Saved, but the Git commit failed.",
        allowedEmails: saved.allowedEmails,
        googleServices: saved.googleServices,
      };
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

  /**
   * The box's current Tailscale URL, or null when it isn't exposed. Shells
   * out to `tailscale serve status --json`, so this is fail-safe by design —
   * every failure mode (CLI absent, nonzero exit, unparseable JSON, no `Web`
   * mapping) degrades to `{ baseUrl: null }` rather than throwing, since the
   * settings page must never block on this. Owner-gated: it reveals whether
   * (and where) the box is reachable off the tailnet.
   */
  tailscaleBaseUrl: ownerProcedure.query(async () => {
    try {
      const run = await createRealTailscaleDeps().run("tailscale", ["serve", "status", "--json"]);
      if (!run.spawned || run.code !== 0) return { baseUrl: null };
      const parsed = parseServeConfig(run.stdout);
      if (!parsed.ok) return { baseUrl: null };
      return { baseUrl: deriveTailscaleBaseUrl(parsed.value) };
    } catch (e) {
      console.warn("tailscaleBaseUrl: failed to read Tailscale serve status (treating as not exposed):", e);
      return { baseUrl: null };
    }
  }),
});
