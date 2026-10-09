/**
 * The search params that open one issue in the browser. Public is the default
 * visibility, so it is left out of the URL; only a private issue says so.
 * Agents link issues the same way (`issues/AGENTS.md`, "Titles + cross-links").
 */

import type { Visibility } from "../types.js";

export function issueSearchParams(issue: { relPath: string; visibility: Visibility }): { issue: string; issueVisibility: "private" | undefined } {
  return { issue: issue.relPath, issueVisibility: issue.visibility === "private" ? "private" : undefined };
}
