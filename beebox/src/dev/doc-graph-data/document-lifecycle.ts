/** @public Imported by `workstreams-app/src/server/`, outside this package. */
/**
 * Classify documentation by its monorepo-relative location. These labels
 * describe a document's role; they do not claim every sentence was reverified.
 */

import { frontmatterFence } from "../../cards/frontmatter.js";
import type { DocumentRole } from "./document-roles.js";

export interface DocumentLifecycle {
  role: DocumentRole;
  label: string;
  status: string | null;
}
export function documentLifecycle(relPath: string, status: string | null): DocumentLifecycle | null {
  if (!relPath.startsWith("beebox/docs/")) return null;
  const local = relPath.slice("beebox/".length);
  if (!local.endsWith(".md")) return null;
  if (/^docs\/(?:implemented-plans|plans|unimplemented-plans)\/README\.md$/u.test(local)) {
    return { role: "reference", label: "current reference", status: null };
  }
  if (local === "docs/name-history.md") {
    return { role: "shipped-history", label: "history", status: null };
  }
  if (local.startsWith("docs/plans/")) {
    if (local.endsWith(".review.md")) return { role: "proposal", label: "plan review", status: null };
    return { role: "proposal", label: "proposal", status };
  }
  if (local.startsWith("docs/implemented-plans/")) {
    if (local.endsWith(".review.md")) return { role: "shipped-history", label: "implementation review", status: null };
    return { role: "shipped-history", label: "shipped history", status };
  }
  if (local.startsWith("docs/unimplemented-plans/")) {
    return { role: "past-proposal", label: "past proposal", status };
  }
  if (local.startsWith("docs/reports/")) return { role: "report", label: "dated report", status: null };
  if (local.startsWith("docs/design/")) return { role: "design-rationale", label: "design rationale", status: null };
  if (local.startsWith("docs/")) return { role: "reference", label: "current reference", status: null };
  return null;
}

/** Read only the existing plan status field; malformed metadata remains visible as unknown. */
export function planStatusFromSource(source: string): string | null {
  const fence = frontmatterFence(source);
  if (fence === null) return null;
  return /^status:\s*["']?([^\s"']+)["']?\s*$/mu.exec(source.slice(fence.textStart, fence.textEnd))?.[1] ?? null;
}
