/** The agent an audit runs on each engine, and where its behavior is read from afterwards. */

import { createClaudeAgent, createPiAgent } from "../../../../core/agent/invoke/core.js";
import { createCodexAgent } from "../../../../core/agent/codex-agent.js";
import type { CodexObservedActivity } from "../../../../core/agent/codex-run/core.js";
import type { PiSessionDeps } from "../../../../core/agent/pi-run/session/core.js";
import type { Agent, AgentResult } from "../../../../core/agent/types.js";
import type { AgentEngine } from "../../../../core/box/config.js";
import { extractBehavior } from "./claude-audit.js";
import { codexBehaviorFromActivity } from "./codex-audit.js";
import { piBehaviorFromSession } from "./pi-audit.js";
import type { AgentBehavior } from "./run-test.js";

export interface AuditAgent {
  agent: Agent;
  /** `logDir` is the cwd Claude ran in; Codex reads its live activity, pi its session file under the box. */
  behavior: (run: { result: AgentResult; logDir: string; boxRoot: string }) => Promise<AgentBehavior>;
}

export interface AuditAgentOptions {
  onOutput?: ((text: string) => void) | undefined;
  /** pi's runtime seams: tests pass pi's `faux` provider, and a dev run can supply the key in memory. */
  piDeps?: PiSessionDeps | undefined;
}

export function createAuditAgent(engine: AgentEngine, options: AuditAgentOptions): AuditAgent {
  const agentOptions = { name: "knowledge-audit", ...(options.onOutput && { onOutput: options.onOutput }) };
  switch (engine) {
    case "claude":
      return {
        agent: createClaudeAgent(agentOptions),
        behavior: async ({ result, logDir }) => extractBehavior(logDir, result.sessionId),
      };
    case "codex": {
      const activity: CodexObservedActivity[] = [];
      return {
        agent: createCodexAgent({ ...agentOptions, onActivity: (item) => activity.push(item) }),
        behavior: async ({ result }) => codexBehaviorFromActivity(activity, result.resultText ?? result.output),
      };
    }
    case "pi":
      return {
        agent: createPiAgent(agentOptions, options.piDeps),
        behavior: async ({ result, boxRoot }) => piBehaviorFromSession(boxRoot, result.sessionId),
      };
  }
}
