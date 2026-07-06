/**
 * The Claude Code / Agent SDK built-in tool names that our UI and session
 * tooling format specially. This is the single source of truth for that
 * vocabulary — four dispatch tables (session-content, session-report,
 * test-runner, and the frontend activity renderer) key off it. They render
 * different output, but they must agree on the tool-name spelling, so the
 * names live here once (`isKnownTool` gives them a typed dispatch key) rather
 * than as four hand-synced string lists that silently drift.
 *
 * Anything not in this set — MCP tools (`mcp__server__tool`), future built-ins —
 * is an "unknown" tool each site handles via its own explicit fallback.
 */
export const KNOWN_TOOL_NAMES = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "TodoWrite",
  "Task",
  "Agent",
] as const;

export type KnownToolName = (typeof KNOWN_TOOL_NAMES)[number];

/** Type guard: is `name` one of the specially-formatted built-in tools? */
export function isKnownTool(name: string): name is KnownToolName {
  return (KNOWN_TOOL_NAMES as readonly string[]).includes(name);
}
