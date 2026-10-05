/**
 * Whether the box has an agent that can run, for the chat composer's
 * no-agent block and the owner's redirect to Admin → Agents.
 */

import { checkAgentReadiness, type ReadinessServices } from "../../../core/agent/readiness.js";
import { createClaudeCliService } from "../../../services/claude-cli.js";
import { createCodexCliService } from "../../../services/codex-cli/core.js";
import { reconcileDefaultEngine } from "../agent-default-switch.js";
import type { TrpcContext } from "../context.js";
import { authedProcedure, ownerProcedure, router } from "../procedures.js";

function readinessServices(ctx: TrpcContext): ReadinessServices {
  return {
    claudeCli: ctx.services.claudeCli ?? createClaudeCliService(),
    codexCli: ctx.services.codexCli ?? createCodexCliService(),
  };
}

export const agentsRouter = router({
  /**
   * Members learn only whether chat can run; which accounts the owner has
   * signed in to is the owner's business.
   */
  readiness: authedProcedure.query(async ({ ctx }) => {
    const readiness = await checkAgentReadiness(ctx.boxRoot, readinessServices(ctx));
    if (!ctx.isOwner) return { anyReady: readiness.anyReady };
    return readiness;
  }),

  /** Move a broken default to a provider that works; a no-op otherwise. */
  reconcileDefault: ownerProcedure.mutation(async ({ ctx }) => reconcileDefaultEngine(ctx.boxRoot, readinessServices(ctx))),
});
