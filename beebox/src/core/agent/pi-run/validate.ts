/**
 * Box validation for the files a pi run edits, shared by the batch agent and
 * the chat backend (docs/implemented-plans/pi-box-engine.md, Track 4).
 *
 * The scope is Claude's PostToolUse hook (`plugins/beebox-claude/hooks/hooks.json`,
 * `Write|Edit|MultiEdit`) and the check is the same one
 * (`validateHookPathsResult`). A finding is sent to the model with `steer`,
 * so it sees the finding before its next step; files changed through bash are
 * left to the box's pre-commit validation, as on every engine.
 */

import { resolve } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { validateHookPathsResult, type HookValidationResult } from "../../../cli/validate-hook/command.js";

/** One event of pi's agent loop. Its listeners are awaited before the loop goes on. */
export type PiAgentEvent = Parameters<Parameters<AgentSession["agent"]["subscribe"]>[0]>[0];

/** pi's names for the tools Claude's hook matches; pi has no MultiEdit. */
const VALIDATED_TOOLS = new Set(["edit", "write"]);

export interface PiValidation {
  /**
   * Validate every path the run changed, as each file stands now: a finding
   * the model fixed later in the run no longer stands.
   */
  settle(): Promise<HookValidationResult>;
  dispose(): void;
}

function toolPath(args: unknown): string | null {
  if (typeof args !== "object" || args === null || !("path" in args)) return null;
  return typeof args.path === "string" ? args.path : null;
}

function steerText(path: string, result: HookValidationResult & { feedback: string }): string {
  return result.hasErrors
    ? `Bee Box validation failed for ${path}:\n${result.feedback}\nFix the file before you finish; the run fails if this still stands.`
    : `Bee Box validation warning for ${path}:\n${result.feedback}`;
}

/**
 * Watch a session's edits. The listener is on pi's agent loop rather than the
 * session, because the loop awaits it: the steer is queued before the model's
 * next call.
 */
export function watchPiValidation(session: AgentSession, cwd: string): PiValidation {
  const pending = new Map<string, string>();
  const changed = new Set<string>();
  const unsubscribe = session.agent.subscribe(async (event: PiAgentEvent) => {
    if (event.type === "tool_execution_start" && VALIDATED_TOOLS.has(event.toolName)) {
      const path = toolPath(event.args);
      if (path !== null) pending.set(event.toolCallId, resolve(cwd, path));
      return;
    }
    if (event.type !== "tool_execution_end") return;
    const path = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    if (path === undefined || event.isError) return;
    changed.add(path);
    const result = await validateHookPathsResult([path], session.sessionId);
    if (result.feedback !== null) await session.steer(steerText(path, { ...result, feedback: result.feedback }));
  });
  return {
    settle: () => validateHookPathsResult([...changed], session.sessionId),
    dispose: unsubscribe,
  };
}
