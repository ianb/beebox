import { z } from "zod";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, ownerProcedure } from "../trpc.js";
import { loadTelegramConfig } from "../../../connectors/telegram.js";
import { telegramLegacySecretPath, telegramSecretName } from "../../../connectors/telegram-helpers.js";
import { forgetBoxSecret, setAndGrantSecret } from "../../../core/secrets/lifecycle.js";
import { boxSlug } from "../../../lib/box-slug.js";
import { createTelegramService } from "../../../services/telegram.js";
import { createClaudeCliService } from "../../../services/claude-cli.js";
import { resolveBoxPublicUrl } from "../../../lib/public-url.js";
import { baseServerUrl } from "../../base-server-url.js";
import { googleAdminProcedures } from "./admin-google.js";
import { errnoCode, errorMessage } from "../../../lib/error-guards.js";
import { createRealTailscaleDeps, deriveTailscaleBaseUrl, parseServeConfig } from "../../../services/tailscale.js";
import { normalizeAllowedEmails, updateBoxConfigFields } from "../../box-config-write.js";
import { modelTier } from "../../../shared/agent-models.js";
import { normalizeModelId } from "../../../shared/model-ids.js";
import { canonicalizeEmail, getLocalUser } from "../../local-users.js";
import { gmailAdminProcedures } from "./admin-gmail.js";
import { inviteAdminProcedures } from "./admin-invites.js";
import { passwordResetAdminProcedures } from "./admin-password-resets.js";
import { describeAllowedUsers } from "./admin-user-details.js";
import { getGoogleClientCreds } from "../../../connectors/google-auth.js";

/**
 * Shape of `config/box.json`, validated on read (config is untrusted input).
 * `.default()` on every field lets a missing file or missing key read as the
 * documented default rather than casting an untyped `JSON.parse` result.
 */
const googleServicesSchema = z.object({
  calendar: z.boolean().optional(),
  gmail: z.boolean().optional(),
  drive: z.boolean().optional(),
});

const boxConfigSchema = z.object({
  agentEngine: z.enum(["claude", "codex"]).default("claude"),
  // Deliberately a plain string, not an enum over the model registry: this is
  // a `parse` of the whole file, so a stale or hand-typed model would throw the
  // entire admin page away. The resolver (`core/model-policy.ts`) is the
  // boundary that rejects an unusable value; here it only needs to survive the
  // trip so the UI can show it back as unrecognized.
  agentModel: z.string().optional(),
  engines: z.object({ claude: z.boolean().optional(), codex: z.boolean().optional() }).optional(),
  allowedEmails: z.array(z.string()).default([]),
  publicUrl: z.string().nullable().default(null),
  googleServices: googleServicesSchema.default({}),
});

/** Per-box admin router (Telegram, box config). */
export const adminRouter = router({
  ...inviteAdminProcedures,
  ...passwordResetAdminProcedures,
  ...gmailAdminProcedures,

  /**
   * Telegram's configured state — deliberately WITHOUT the bot token.
   *
   * It used to return `botToken` on both arms, which handed a live,
   * unscopable, all-powerful credential to the admin frontend on every page
   * load. Telegram has no derived-credential primitive at all (no scoping, no
   * TTL, revoke-only via BotFather), so the token must terminate in the server
   * process (`docs/plans/secret-custody.md`, "Broker escalations"). Callers
   * that want to identify the bot use `botUsername`.
   */
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
        boxSlug: ctx.boxSlug,
      };
    } catch (err) {
      return {
        configured: true,
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
      // Into the machine store, never a file in the box tree (Decision 3). The
      // entry is this box's alone — a bot token routes to a single webhook URL,
      // so `shareable: false` makes a grant to any other box an explained
      // refusal rather than a silently broken integration.
      // Keyed by the DISK-derived slug, which is what every telegram reader
      // (the connector, the webhook route, notify-boxholder) resolves under —
      // `ctx.boxSlug` can differ under `cb serve --slug`, and a grant written
      // under one and read under the other would silently never resolve.
      const secretSlug = await boxSlug(ctx.boxRoot);
      await setAndGrantSecret({
        name: telegramSecretName(secretSlug),
        value: JSON.stringify({ botToken: input.botToken, webhookSecret }),
        slug: secretSlug,
        access: "server",
        note: "Telegram bot token + webhook secret",
        owningBox: ctx.boxSlug,
        shareable: false,
      });

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

    // Revoke the grant and drop the store entry: disconnect must leave nothing
    // resolvable behind, not merely stop using it. Idempotent either way.
    const secretSlug = await boxSlug(ctx.boxRoot);
    await forgetBoxSecret({ name: telegramSecretName(secretSlug), slug: secretSlug });

    // The legacy in-tree file is still deleted, for a box that was configured
    // before the migration and never reconnected.
    const configPath = telegramLegacySecretPath(ctx.boxRoot);
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
        console.warn("box.json is unreadable; refusing to return fabricated defaults:", e);
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Box configuration is unreadable.",
        });
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
      googleLoginConfigured: (await getGoogleClientCreds(ctx.boxRoot)) !== null,
      googleServices: config.googleServices,
      agentEngine: config.agentEngine,
      agentModel: config.agentModel ?? null,
      // Absent means "only the default engine", the same rule loadEnabledEngines
      // applies — resolved here so the UI never has to re-derive it.
      engines: config.engines ?? { [config.agentEngine]: true },
    };
  }),

  localAccountStatus: ownerProcedure
    .input(z.object({ email: z.string().max(254) }))
    .query(({ input }) => {
      const email = canonicalizeEmail(input.email);
      return { exists: getLocalUser(email) !== null };
    }),

  updateBoxConfig: ownerProcedure
    .input(
      z
        .object({
          allowedEmails: z.array(z.string()).optional(),
          googleServices: googleServicesSchema.optional(),
          agentEngine: z.enum(["claude", "codex"]).optional(),
          /**
           * `null` clears the box's model policy. A model no engine offers is
           * refused here rather than saved: the resolver would drop it on every
           * read, so the box would report "Saved" and then quietly run the
           * harness default forever.
           */
          agentModel: z.string()
            .refine((m) => modelTier(normalizeModelId(m)) !== null, { message: "Unknown model id" })
            .nullable()
            .optional(),
          engines: z.object({ claude: z.boolean().optional(), codex: z.boolean().optional() }).optional(),
        })
        .refine((v) => v.allowedEmails !== undefined || v.googleServices !== undefined || v.agentEngine !== undefined || v.agentModel !== undefined || v.engines !== undefined, {
          message: "At least one box configuration field is required",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await updateBoxConfigFields({
        boxRoot: ctx.boxRoot,
        ...(input.allowedEmails === undefined ? {} : { allowedEmails: input.allowedEmails }),
        ...(input.googleServices === undefined ? {} : { googleServices: input.googleServices }),
        ...(input.agentEngine === undefined ? {} : { agentEngine: input.agentEngine }),
        ...(input.agentModel === undefined ? {} : { agentModel: input.agentModel }),
        ...(input.engines === undefined ? {} : { engines: input.engines }),
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
        agentEngine: saved.agentEngine,
        agentModel: saved.agentModel ?? null,
        engines: saved.engines ?? { [saved.agentEngine]: true },
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

  claudeSubmitCode: ownerProcedure
    .input(z.object({ code: z.string().trim().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const claude = ctx.services.claudeCli ?? createClaudeCliService();
      const result = await claude.authSubmitCode(input.code);
      if (result.accepted) return { accepted: true as const };
      throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Code not accepted" });
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
