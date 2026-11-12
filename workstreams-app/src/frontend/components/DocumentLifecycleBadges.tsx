import type { DocumentLifecycle } from "../../../../beebox/src/dev/doc-graph-data/document-lifecycle.js";
import { Badge } from "./ui.js";

export function DocumentLifecycleBadges({ lifecycle }: { lifecycle: DocumentLifecycle | null }) {
  if (lifecycle === null) return null;
  return (
    <>
      <Badge tone={lifecycle.role === "proposal" ? "info" : "neutral"}>{lifecycle.label}</Badge>
      {lifecycle.status === null ? null : <Badge tone="neutral">{lifecycle.status}</Badge>}
    </>
  );
}
