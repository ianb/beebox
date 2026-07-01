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
    "A scheduled script — a `.scheduled-script.card` in `config/schedules/` — runs a `cb` command on a recurring schedule, or once at a future time. The built-in ones are mechanical (connector syncs, maintenance); the ones **you** create serve the user: checking something on a cadence, revisiting a decision at intervals, or a one-off job further out than a chat `<schedule>` can reach. Keep them practical, not dramatic.",
    "",
    "```",
    "---",
    "cron: 0 8 * * 1              # Mondays at 8am",
    "not-before: 3d              # skip if it already ran within 3 days",
    "runs: cb procedure run weekly-digest",
    "description: Monday digest of the week's still-open threads",
    "source: Boxholder wanted a summary to start the week",
    "---",
    "```",
    "",
    "They run in the background automatically; `cb scheduled` lists them. Use `at:` (a future timestamp) instead of `cron:` for a one-shot. Full format — cron/at/rrule, `not-before` throttling, `create-after-success` chaining — is in `docs/generated/card-scheduled-script.md`.",
    "",
  ];
}

export function tricksSection(): string[] {
  return [
    "## Tricks",
    "",
    "A **trick** is a reusable script — you package a useful operation once and rerun it with `cb trick <name>`, instead of redoing it by hand each time. Whenever you catch yourself repeating the same multi-step task (a particular fetch, an export, a search-and-summarize), that's the signal to formalize it as a trick. Each lives in `tricks/scripts/<name>/` with an `index.ts`; see `tricks/scripts/CLAUDE.md` to write one.",
    "",
  ];
}
