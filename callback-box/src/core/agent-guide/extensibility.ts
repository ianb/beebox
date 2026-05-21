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
    "Guides contain the boxholder's preferences for how you handle specific domains.",
    "They define interaction patterns, pacing, and actions you wouldn't know from general knowledge.",
    "**Read the guide before acting** — even if you know the domain, the guide tells you how this user wants it done.",
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
    "Scheduled scripts in `config/schedules/` automate recurring tasks (connector syncs, maintenance, custom jobs).",
    "Each is a `.scheduled-script.card` with a cron/at/rrule schedule.",
    "",
    "- `cb tick` — evaluate and run due schedules",
    "- `cb scheduled` — list all schedules with status and last-run time",
    "- `cb scheduler status` — show scheduler daemon status and configured boxes",
    "",
    "A background scheduler daemon (`cb scheduler start`) runs `cb tick` every 60 seconds for all configured boxes.",
    "It is managed via launchd and auto-starts at login. Scheduler logs for this box are at `.callback-box/scheduler.jsonl` (JSONL format, one entry per tick cycle).",
    "Each entry records which scripts ran, were skipped, or errored, with timestamps and durations.",
    "",
    "Agents can create or modify scheduled scripts for custom automation.",
    "Schedule format includes cron expressions, throttling (`not-before`), chaining (`create-after-success`), and one-shot options — see `docs/generated/card-scheduled-script.md`.",
    "",
  ];
}

export function tricksSection(): string[] {
  return [
    "## Tricks",
    "",
    "Custom scripts live in `tricks/scripts/`. Each trick is a directory with an `index.ts`.",
    "Run with `cb trick <name>`. See `tricks/scripts/CLAUDE.md` for how to write tricks.",
    "",
  ];
}
