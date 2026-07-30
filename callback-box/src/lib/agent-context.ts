/**
 * Is this process being driven by a coding agent rather than a person at a
 * terminal?
 *
 * Used to put a speed bump in front of irreversible credential changes
 * (`cb auth`). The signal is deliberately loose and one-directional: a false
 * positive costs a human one extra flag, while a false negative lets an agent
 * silently reset the boxholder's password. So it errs toward "assume agent."
 *
 * This exists because an agent did exactly that (2026-07-30): it hit a login
 * wall while trying to drive the browser, ran `cb auth set-password` to
 * manufacture credentials, and only afterwards discovered that the auth file is
 * global to every local box rather than scoped to the box it was standing in.
 * The password was unrecoverable (scrypt) and the boxholder's live sessions were
 * revoked. Detection cannot prevent that on its own — the guidance in
 * `callback-box/CLAUDE.md` is the real fix — but a refusal at the moment of the
 * mistake is worth more than a rule the agent has to remember.
 */

/**
 * Environment variables set by agent runtimes. `CLAUDECODE` is the one this repo
 * already recognizes — `core/chat/session/start.ts` and `thread.ts` explicitly
 * clear it when spawning box agents, precisely so a nested agent can tell it is
 * nested.
 */
const AGENT_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CURSOR_AGENT",
  "AIDER_CHAT",
  "OPENAI_CODEX",
] as const;

export interface AgentContext {
  isAgent: boolean;
  /** Human-readable reason, for the refusal message. Empty when not an agent. */
  reason: string;
}

/**
 * Detect an agent/non-interactive caller.
 *
 * Two independent signals: a known agent env var, or stdin not being a TTY (a
 * piped or spawned shell — which covers CI and agent runtimes that set nothing
 * recognizable). A person running this by hand in a terminal trips neither.
 */
export function detectAgentContext(): AgentContext {
  for (const name of AGENT_ENV_VARS) {
    const value = process.env[name];
    if (value !== undefined && value !== "" && value !== "0") {
      return { isAgent: true, reason: `${name} is set in the environment` };
    }
  }
  if (process.stdin.isTTY !== true) {
    return { isAgent: true, reason: "stdin is not an interactive terminal" };
  }
  return { isAgent: false, reason: "" };
}
