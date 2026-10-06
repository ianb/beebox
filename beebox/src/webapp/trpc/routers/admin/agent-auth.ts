/**
 * Admin sign-in for the agent CLIs (Claude Code, Codex). Their live status
 * checks also refresh the agent-readiness cache, so a sign-in the admin page
 * is polling for unblocks chat right away.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ownerProcedure } from "../../procedures.js";
import { createClaudeCliService } from "../../../../services/claude-cli.js";
import { createCodexCliService } from "../../../../services/codex-cli/core.js";
import { resetCodexAuthCache } from "../../../../core/agent/auth-preflight.js";
import { rememberClaudeStatus, rememberCodexStatus, resetAgentReadinessCache } from "../../../../core/agent/readiness.js";

export const agentAuthAdminProcedures = {
  claudeStatus: ownerProcedure.query(async ({ ctx }) => {
    const claude = ctx.services.claudeCli ?? createClaudeCliService();
    const status = await claude.authStatus();
    rememberClaudeStatus(status);
    return status;
  }),

  claudeLogin: ownerProcedure.mutation(async ({ ctx }) => {
    const claude = ctx.services.claudeCli ?? createClaudeCliService();
    const ownerEmail = process.env.BBX_OWNER_EMAIL;
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
    const result = await claude.authLogout();
    resetAgentReadinessCache();
    return result;
  }),

  codexStatus: ownerProcedure.query(async ({ ctx }) => {
    const codex = ctx.services.codexCli ?? createCodexCliService();
    const status = await codex.authStatus();
    rememberCodexStatus(status);
    return status;
  }),

  codexLogin: ownerProcedure.mutation(async ({ ctx }) => {
    const codex = ctx.services.codexCli ?? createCodexCliService();
    return codex.authLogin();
  }),

  codexCancelLogin: ownerProcedure.mutation(async ({ ctx }) => {
    const codex = ctx.services.codexCli ?? createCodexCliService();
    const result = await codex.authCancel();
    if (!result.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error ?? "Could not cancel Codex login" });
    return result;
  }),

  codexLogout: ownerProcedure.mutation(async ({ ctx }) => {
    const codex = ctx.services.codexCli ?? createCodexCliService();
    const result = await codex.authLogout();
    if (result.success) {
      resetCodexAuthCache();
      resetAgentReadinessCache();
    }
    return result;
  }),
};
