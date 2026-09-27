/**
 * Fillers for the per-box extensibility sections of `guide.md`: this box's
 * procedures (`{{procedures}}`) and guides (`{{guides}}`). Both vary per box
 * and are scanned by generate-docs; an empty list omits its section.
 */

import type { ProcedureSummary, GuideSummary } from "../docs-gen/index.js";

/** PROCEDURES: one line per procedure card, or null to omit the section. */
export function procedureList(procedures: ProcedureSummary[]): string | null {
  if (procedures.length === 0) return null;
  return procedures.map((p) => `- **${p.name}** — ${p.description}`).join("\n");
}

/** GUIDES: one line per guide card with its compiled doc, or null to omit the section. */
export function guideList(guides: GuideSummary[]): string | null {
  if (guides.length === 0) return null;
  return guides.map((g) => {
    const note = g.appliesTo ? ` — ${g.appliesTo}` : "";
    return `- **${g.name}**${note} → \`${g.compiledPath}\``;
  }).join("\n");
}
