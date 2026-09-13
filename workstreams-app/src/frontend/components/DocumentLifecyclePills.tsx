import type { DocumentLifecycle } from "../../../../beebox/src/dev/document-lifecycle.js";
import { Pill } from "./ui.js";

export function DocumentLifecyclePills({ lifecycle }: { lifecycle: DocumentLifecycle | null }) {
  if (lifecycle === null) return null;
  return (
    <>
      <Pill tone={lifecycle.role === "proposal" ? "info" : "neutral"}>{lifecycle.label}</Pill>
      {lifecycle.status === null ? null : <Pill tone="neutral">{lifecycle.status}</Pill>}
    </>
  );
}
