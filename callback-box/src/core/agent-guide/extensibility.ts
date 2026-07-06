/**
 * Box extensibility surfaces — procedures and guides.
 *
 * Both are dynamic: their lists vary per-box and are scanned by generate-docs,
 * so they stay in the always-loaded guide as compact per-box indexes. The
 * static-prose surfaces that used to live here — schedules and tricks — moved
 * to on-demand skills (box-skills-content.ts), since an agent only needs their
 * authoring mechanics when it forms the intent to use them.
 */

import type { ProcedureSummary, GuideSummary } from "../docs-gen/index.js";

export function proceduresSection(procedures: ProcedureSummary[]): string {
  if (procedures.length === 0) return "";
  const lines: string[] = [
    "## Procedures",
    "",
    "Available procedures in `config/procedures/`:",
    "",
  ];
  for (const p of procedures) {
    lines.push(`- **${p.name}** — ${p.description}`);
  }
  lines.push("");
  lines.push("Run with `cb procedure run <name>`. Read `docs/generated/procedures.md` before writing or modifying.");
  return lines.join("\n");
}

export function guidesSection(guides: GuideSummary[]): string {
  if (guides.length === 0) return "";
  const lines: string[] = [
    "## Guides",
    "",
    "Guides (`*.guide.card`) hold the boxholder's preferences for handling specific domains — how *this* user wants a domain done, beyond what general knowledge tells you. **Read the relevant guide before acting**, even in a domain you know.",
    "",
  ];
  for (const g of guides) {
    const note = g.appliesTo ? ` — ${g.appliesTo}` : "";
    lines.push(`- **${g.name}**${note} → \`${g.compiledPath}\``);
  }
  return lines.join("\n");
}
