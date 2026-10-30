import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, ownerProcedure } from "../../procedures.js";
import { googleAdminProcedures } from "./google.js";
import { backupAdminProcedures } from "./backup.js";
import { agentAuthAdminProcedures } from "./agent-auth.js";
import { openrouterAdminProcedures } from "./openrouter.js";
import { errnoCode } from "../../../../shared/error-guards.js";
import { createRealTailscaleDeps, deriveTailscaleBaseUrl, parseServeConfig } from "../../../../services/tailscale.js";
import { CONFIG_RELATIVE_PATH, normalizeAllowedEmails, PiDefaultModelRequiredError, updateBoxConfigFields } from "../../../box-config-write.js";
import { isConfigurableModel, loadAddedModels } from "../../../../core/box/config.js";
import { canonicalizeEmail, getLocalUser } from "../../../local-users.js";
import { gmailAdminProcedures } from "./gmail.js";
import { inviteAdminProcedures } from "./invites.js";
import { passwordResetAdminProcedures } from "./password-resets.js";
import { describeAllowedUsers } from "./user-details.js";
import { getLoginGoogleClientCreds } from "../../../../google/auth.js";
import { normalizeModelId } from "../../../../shared/model-ids.js";
import { openRouterKeyUsable } from "../../../../core/openrouter.js";
import { AGENT_ENGINES, type AgentEngine } from "../../../../shared/agent-models.js";

/**
 * Shape of `_config/box.json`, validated on read (config is untrusted input).
 * `.default()` on every field lets a missing file or missing key read as the
 * documented default rather than casting an untyped `JSON.parse` result.
 */
const googleServicesSchema = z.object({
  calendar: z.boolean().optional(),
  gmail: z.boolean().optional(),
  drive: z.boolean().optional(),
});

/** Which engines the box offers. An object, not a record, so an unknown key is dropped rather than failing the read. */
const enginesSchema = z.object({
  claude: z.boolean().optional(),
  codex: z.boolean().optional(),
  pi: z.boolean().optional(),
} satisfies Record<AgentEngine, z.ZodOptional<z.ZodBoolean>>);

const boxConfigSchema = z.object({
  // Same fail-closed reading as `loadClaudeCodeTelemetry`: an invalid value is off.
  claudeCodeTelemetry: z.enum(["on", "off"]).default("on").catch("off"),
  // Codex analytics are opt-in (`loadCodexTelemetry`).
  codexTelemetry: z.enum(["on", "off"]).default("off").catch("off"),
  agentEngine: z.enum(AGENT_ENGINES).default("claude"),
  // Deliberately a plain string, not an enum over the model registry: this is
  // a `parse` of the whole file, so a stale or hand-typed model would throw the
  // entire admin page away. The resolver (`core/model-policy.ts`) is the
  // boundary that rejects an unusable value; here it only needs to survive the
  // trip so the UI can show it back as unrecognized.
  agentModel: z.string().optional(),
  engines: enginesSchema.optional(),
  allowedEmails: z.array(z.string()).default([]),
  publicUrl: z.string().nullable().default(null),
  googleServices: googleServicesSchema.default({}),
});

/** Per-box admin router (box config). */
export const adminRouter = router({
  ...inviteAdminProcedures,
  ...passwordResetAdminProcedures,
  ...gmailAdminProcedures,

  boxConfig: ownerProcedure.query(async ({ ctx }) => {
    const configPath = path.join(ctx.boxRoot, CONFIG_RELATIVE_PATH);
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
    const configuredOwnerEmail = process.env.BBX_OWNER_EMAIL
      ? canonicalizeEmail(process.env.BBX_OWNER_EMAIL)
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
      googleLoginConfigured: getLoginGoogleClientCreds() !== null,
      googleServices: config.googleServices,
      agentEngine: config.agentEngine,
      agentModel: config.agentModel === undefined ? null : normalizeModelId(config.agentModel),
      openrouterModels: await loadAddedModels(ctx.boxRoot),
      // pi needs the key as well as an added model; a presence check, not a key read.
      openrouterKeyGranted: await openRouterKeyUsable(ctx.boxRoot),
      // Absent means "only the default engine", the same rule loadEnabledEngines
      // applies — resolved here so the UI never has to re-derive it.
      engines: config.engines ?? { [config.agentEngine]: true },
      claudeCodeTelemetry: config.claudeCodeTelemetry,
      codexTelemetry: config.codexTelemetry,
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
          agentEngine: z.enum(AGENT_ENGINES).optional(),
          /**
           * `null` clears the box's model policy. A model no engine offers is
           * refused here rather than saved: the resolver would drop it on every
           * read, so the box would report "Saved" and then quietly run the
           * harness default forever. An added OpenRouter model is checked in
           * the mutation, which can read the box's list.
           */
          agentModel: z.string().nullable().optional(),
          engines: enginesSchema.optional(),
          claudeCodeTelemetry: z.enum(["on", "off"]).optional(),
          codexTelemetry: z.enum(["on", "off"]).optional(),
        })
        .refine((v) => Object.values(v).some((field) => field !== undefined), {
          message: "At least one box configuration field is required",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      if (typeof input.agentModel === "string" && !(await isConfigurableModel(ctx.boxRoot, input.agentModel))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown model id ${input.agentModel}` });
      }
      const result = await updateBoxConfigFields({
        boxRoot: ctx.boxRoot,
        ...(input.allowedEmails === undefined ? {} : { allowedEmails: input.allowedEmails }),
        ...(input.googleServices === undefined ? {} : { googleServices: input.googleServices }),
        ...(input.agentEngine === undefined ? {} : { agentEngine: input.agentEngine }),
        ...(input.agentModel === undefined ? {} : { agentModel: input.agentModel }),
        ...(input.engines === undefined ? {} : { engines: input.engines }),
        ...(input.claudeCodeTelemetry === undefined ? {} : { claudeCodeTelemetry: input.claudeCodeTelemetry }),
        ...(input.codexTelemetry === undefined ? {} : { codexTelemetry: input.codexTelemetry }),
      }).catch((e: unknown) => {
        if (e instanceof PiDefaultModelRequiredError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message, cause: e });
        throw e;
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
        claudeCodeTelemetry: saved.claudeCodeTelemetry,
        codexTelemetry: saved.codexTelemetry,
      };
    }),

  ...googleAdminProcedures,
  ...backupAdminProcedures,
  ...openrouterAdminProcedures,

  ...agentAuthAdminProcedures,

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
