/** Render observable activity from official Codex SDK items. */

import type { CodexSdkItem } from "../../services/codex-sdk-session.js";
import { fmt } from "../../lib/format.js";

export type CodexObservedActivity =
  | { type: "command"; command: string }
  | { type: "search"; tool: "WebSearch"; summary: string };

export function renderCodexCommand(item: CodexSdkItem): string {
  if (item.type !== "command_execution") return "";
  const suffix = item.exit_code === undefined ? "" : ` [exit ${String(item.exit_code)}]`;
  return `${fmt.dim("$ ")}${fmt.cmd(item.command)}${fmt.dim(suffix)}\n${item.aggregated_output}`;
}

export function emitObservedActivity(
  item: CodexSdkItem,
  emit: ((activity: CodexObservedActivity) => void) | undefined,
): void {
  if (item.type === "command_execution") {
    emit?.({ type: "command", command: item.command });
  } else if (item.type === "web_search") {
    emit?.({ type: "search", tool: "WebSearch", summary: item.query });
  }
}
