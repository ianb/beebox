/**
 * Which open companion documents the running chat turn is editing, so the
 * panel can say "Updating…" instead of looking like a document at rest.
 *
 * Two signals, both scoped to the current turn and cleared when it ends:
 * - an edit tool call that names the path (it arrives before the write lands);
 * - a `file-change` bus event for the path (covers `bbx` commands run in a
 *   shell, which name no path the UI can trust).
 * A read of the document is not an edit, so read-only tools never count.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionContentBlock } from "../../../../api";
import { useBusSubscription, type RealtimeEvent } from "../../../../hooks/useBusSubscription";
import { busEventData } from "../../../../lib/bus-events";
import { fileChangeAffectsPath } from "../../../../lib/moved-card-recovery";
import { boxRelativePath } from "@shared/box-path.js";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

function inputPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const key of ["file_path", "notebook_path"]) {
    const value = input[key];
    if (typeof value === "string") paths.push(value);
  }
  // Codex reports one file change touching several files as `file_paths`.
  const many = input.file_paths;
  if (Array.isArray(many)) for (const value of many) if (typeof value === "string") paths.push(value);
  return paths;
}

/** Tool inputs carry absolute paths; a workspace tab holds a box-relative one. */
function samePath(toolPath: string, tabPath: string): boolean {
  const tab = boxRelativePath(tabPath);
  return tab !== "" && (boxRelativePath(toolPath) === tab || toolPath.endsWith(`/${tab}`));
}

/** True when `block` is an edit tool call that writes `tabPath`. */
export function toolEditsPath(block: SessionContentBlock, tabPath: string): boolean {
  if (block.type !== "tool_use" || !block.input) return false;
  const name = block.toolName ?? "";
  // Codex file changes carry `file_paths`; Claude's edit tools are named.
  if (!EDIT_TOOLS.has(name) && !Array.isArray(block.input.file_paths)) return false;
  return inputPaths(block.input).some((path) => samePath(path, tabPath));
}

/**
 * The open paths the running turn is editing. The returned set keeps its
 * identity until its membership changes, so cards that read it do not
 * re-render per streamed token.
 */
export function useTurnEditedPaths({ turnActive, turnTools, openPaths }: {
  turnActive: boolean;
  turnTools: readonly SessionContentBlock[];
  openPaths: readonly string[];
}): ReadonlySet<string> {
  const [changed, setChanged] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!turnActive) setChanged((old) => old.size === 0 ? old : new Set());
  }, [turnActive]);
  const openKey = openPaths.join("\n");
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      if (!turnActive) return;
      const fileChange = busEventData(event, "file-change");
      if (!fileChange) return;
      const hits = openKey.split("\n").filter((path) => path !== "" && fileChangeAffectsPath(fileChange, path));
      if (hits.length === 0) return;
      setChanged((old) => hits.every((path) => old.has(path)) ? old : new Set([...old, ...hits]));
    }, [turnActive, openKey]),
  });
  const edited = turnActive
    ? openPaths.filter((path) => changed.has(path) || turnTools.some((block) => toolEditsPath(block, path)))
    : [];
  const key = edited.join("\n");
  return useMemo(() => new Set(key === "" ? [] : key.split("\n")), [key]);
}
