/**
 * Box extensibility surfaces — procedures, guides, schedules, tricks.
 *
 * Procedures and guides are dynamic (their lists vary per-box and are scanned
 * by generate-docs). Schedules and tricks are static prose.
 */

import type { ProcedureSummary, GuideSummary } from "../generate-docs.js";

export function proceduresSection(procedures: ProcedureSummary[]): string[] {
  if (procedures.length === 0) return [];
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
  lines.push("");
  return lines;
}

export function guidesSection(guides: GuideSummary[]): string[] {
  if (guides.length === 0) return [];
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
  lines.push("");
  return lines;
}

export function schedulesSection(): string[] {
  return [
    "## Schedules",
    "",
    "A scheduled script — a `.scheduled-script.card` in `config/schedules/` — runs a command on a recurring schedule (connector syncs, maintenance, or your own automation). They run in the background automatically; `cb scheduled` lists them with status and last-run. You can create or modify one: the format supports cron/at/rrule schedules, throttling (`not-before`), chaining (`create-after-success`), and one-shot runs — see `docs/generated/card-scheduled-script.md`. (Running the daemon itself is box-admin, in the server docs.)",
    "",
  ];
}

export function tricksSection(): string[] {
  return [
    "## Tricks",
    "",
    "A **trick** is a custom script for *this* box — box-local tooling for its particular needs, reached for the way you reach for a `cb` command. When a box has a recurring, box-specific operation no general command covers, it lives as a trick. Each is a directory under `tricks/scripts/` with an `index.ts`; run one with `cb trick <name>`. See `tricks/scripts/CLAUDE.md` to write one.",
    "",
  ];
}
