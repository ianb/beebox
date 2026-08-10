/**
 * Scheduled script card schema - declarative scheduling for commands.
 *
 * Scheduled scripts define what to run and when. They live in
 * config/schedules/ and are evaluated by `cb tick` (cron) and
 * `cb wakeup` (on-wakeup scripts).
 *
 * The filename stem is the identity (e.g., check-email.scheduled-script.card).
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
import { cardSchema, type InferCardFields } from "../cards/index.js";
import { parseDuration, parseBudget } from "./scheduled-script-duration.js";
import { DatetimeField, CronField, RruleField } from "./scheduled-script-fields.js";

const { rrulestr } = rrulePkg;

export {
  InvalidDurationError,
  UnknownDurationUnitError,
  InvalidBudgetError,
  parseDuration,
  parseBudget,
} from "./scheduled-script-duration.js";

// ============================================
// Schema
// ============================================

const SourceField = z.union([
  z.string(),
  z.object({
    text: z.string().optional(),
    ref: z.string().optional(),
  }),
]);

const CreateAfterSuccessEntry = z.object({
  path: z.string(),
  args: z.record(z.string(), z.string()).optional(),
});

const RequiresField = z.object({
  connectors: z.array(z.string()).optional(),
});

export const ScheduledScriptSchema = cardSchema("scheduled-script", {
  description: "Declarative scheduling for a command — cron/at/rrule plus budgets, locks, and wakeup opportunism",
  category: "authored",
  searchable: false,
  fields: {
    cron: CronField.optional(),
    at: DatetimeField.optional(),
    rrule: RruleField.optional(),
    until: DatetimeField.optional(),
    "not-before": z.string().optional(),
    "on-wakeup": z.boolean().optional(),
    once: z.boolean().optional(),
    enabled: z.boolean().optional(),
    budget: z.string().optional(),
    "lock-group": z.string().optional(),
    timeout: z.string().optional(),
    description: z.string().optional(),
    runs: z.string(),
    source: SourceField.optional(),
    "create-after-success": z.array(CreateAfterSuccessEntry).optional(),
    requires: RequiresField.optional(),
  },
  instructions: `# Scheduled Script Cards

Scheduled scripts define commands to run on a schedule. They live in \`config/schedules/\`.

## Schedule Types (mutually exclusive)
- **cron**: Standard cron expression (e.g., \`0 6 * * *\` for 6am daily)
- **at**: ISO datetime for a one-shot future execution
- **rrule**: iCalendar RRULE for complex recurrence patterns

## Frontmatter Fields
- **not-before**: Minimum time since last run. Prevents running more often than this interval even if the schedule says otherwise. Use duration strings: \`5m\`, \`1h\`, \`4h\`, \`1d\`.
- **on-wakeup**: If \`true\`, also run opportunistically during \`cb wakeup\`, subject to not-before.
- **once**: If \`true\`, the card is deleted after successful execution.
- **until**: ISO datetime after which this schedule expires.
- **enabled**: Set to \`false\` to disable without deleting. This is per-box state, not part of the shipped definition — a disabled schedule still receives upstream definition updates (new cron/runs/description) while staying disabled.
- **budget**: Max cumulative runtime within a window. Format: \`"LIMIT/WINDOW"\` (e.g., \`"10m/5h"\` = max 10 minutes of runtime in any 5-hour window). Scripts exceeding their budget are skipped until the window clears.
- **lock-group**: Named concurrency group. Scripts sharing a lock-group won't run concurrently — if one is already running, others in the same group are skipped.
- **timeout**: Max runtime for a single run, as a duration string (e.g. \`25m\`). Counts only awake time (machine sleep doesn't eat the budget). Default: \`10m\`. The run is killed when it exceeds this.
- **runs**: The command to execute (required). Runs with cwd set to box root.
- **description**: Human-readable summary of what this schedule does.
- **source**: Why this schedule exists. Either a plain string, or \`{text?, ref?}\` to link to a related card.
- **create-after-success**: Optional array of \`{path, args?}\` entries. Create a card at \`path\` after successful execution; \`args\` are template arguments. Skipped if the target file already exists.
- **requires**: Optional \`{connectors: [name, ...]}\`. The schedule won't run if any required connector isn't configured for this box.

## Guidelines
- Set reasonable not-before values to prevent hammering external services.
- Use on-wakeup for things that should happen whenever the agent is active.
- For one-shot future tasks, combine \`at\` with \`once: true\`.`,
  // `enabled` is per-box state, not part of the shipped definition: a box turns
  // a schedule on or off for itself. Declaring it box-owned means a box that
  // only toggled `enabled` still receives upstream definition updates (new
  // cron/runs/description), with its own enabled state carried onto them,
  // instead of the whole card parking as "edited." Any edit beyond `enabled`
  // (retimed cron, changed runs) still parks for review.
  templateMerge: { boxOwnedFields: ["enabled"] },
  superRefine: (fields, ctx) => {
    const present: Array<"cron" | "at" | "rrule"> = [];
    if (fields.cron !== undefined) present.push("cron");
    if (fields.at !== undefined) present.push("at");
    if (fields.rrule !== undefined) present.push("rrule");
    if (present.length > 1) {
      for (const key of present) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "cron, at, and rrule are mutually exclusive — specify at most one",
        });
      }
    }
  },
});

// ============================================
// Field types (raw frontmatter shape)
// ============================================

export type ScheduledScriptFields = InferCardFields<typeof ScheduledScriptSchema>;

// ============================================
// Parsed scheduled script (computed/normalized)
// ============================================

export interface ScheduleRequirements {
  connectors: string[];
}

export interface ParsedScheduledScript {
  cron: string | undefined;
  at: string | undefined;
  rrule: string | undefined;
  until: string | undefined;
  notBefore: string | undefined;
  onWakeup: boolean;
  once: boolean;
  enabled: boolean;
  runs: string;
  description: string | undefined;
  source: { ref?: string; text?: string } | undefined;
  createAfterSuccess: Array<{ path: string; args: Record<string, string> }>;
  budget: { limitMs: number; windowMs: number } | undefined;
  lockGroup: string | undefined;
  timeoutMs: number | undefined;
  requires: ScheduleRequirements | undefined;
}

function normalizeSource(src: ScheduledScriptFields["source"]): { ref?: string; text?: string } | undefined {
  if (src === undefined) return undefined;
  if (typeof src === "string") return { text: src };
  const out: { ref?: string; text?: string } = {};
  if (src.ref !== undefined) out.ref = src.ref;
  if (src.text !== undefined) out.text = src.text;
  return out;
}

/**
 * Parse a scheduled-script fields object into a typed structure.
 */
export function parseScheduledScript(fields: ScheduledScriptFields): ParsedScheduledScript {
  return {
    cron: fields.cron,
    at: fields.at,
    rrule: fields.rrule,
    until: fields.until,
    notBefore: fields["not-before"],
    onWakeup: fields["on-wakeup"] === true,
    once: fields.once === true,
    enabled: fields.enabled !== false,
    runs: fields.runs,
    description: fields.description,
    source: normalizeSource(fields.source),
    createAfterSuccess: (fields["create-after-success"] ?? []).map((e) => ({
      path: e.path,
      args: e.args ?? {},
    })),
    budget: fields.budget !== undefined ? parseBudget(fields.budget) : undefined,
    lockGroup: fields["lock-group"],
    timeoutMs: fields.timeout !== undefined ? parseDuration(fields.timeout) : undefined,
    requires:
      fields.requires?.connectors && fields.requires.connectors.length > 0
        ? { connectors: fields.requires.connectors }
        : undefined,
  };
}

// ============================================
// Schedule evaluation
// ============================================

export interface ScheduleCheckContext {
  lastRun: string | null;
  now: Date;
}

/**
 * Check if a scheduled script is due to run.
 */
export function isDue(script: ParsedScheduledScript, ctx: ScheduleCheckContext): boolean {
  if (!script.enabled) return false;

  if (script.until) {
    const untilDate = new Date(script.until);
    if (ctx.now > untilDate) return false;
  }

  if (script.notBefore && ctx.lastRun) {
    const minInterval = parseDuration(script.notBefore);
    const elapsed = ctx.now.getTime() - new Date(ctx.lastRun).getTime();
    if (elapsed < minInterval) return false;
  }

  if (script.cron) {
    return isCronDue(script.cron, ctx);
  }

  if (script.at) {
    const atDate = new Date(script.at);
    return ctx.now >= atDate && !ctx.lastRun;
  }

  if (script.rrule) {
    return isRruleDue(script.rrule, ctx);
  }

  return script.onWakeup;
}

/**
 * Check if a script should run during wakeup (on-wakeup check).
 * Only checks not-before constraint, not the cron/at/rrule schedule.
 */
export function isDueForWakeup(script: ParsedScheduledScript, ctx: ScheduleCheckContext): boolean {
  if (!script.enabled) return false;
  if (!script.onWakeup) return false;

  if (script.until) {
    const untilDate = new Date(script.until);
    if (ctx.now > untilDate) return false;
  }

  if (script.notBefore && ctx.lastRun) {
    const minInterval = parseDuration(script.notBefore);
    const elapsed = ctx.now.getTime() - new Date(ctx.lastRun).getTime();
    if (elapsed < minInterval) return false;
  }

  return true;
}

/**
 * Check if a script is within its runtime budget.
 * Returns true if the script is allowed to run (budget not exceeded).
 * Sums run durations within the budget window. Durations are awake
 * runtime (exec-with-timeout measures them sleep-free), so runs flagged
 * sleepAffected count like any other — the flag is informational.
 */
export function isWithinBudget(
  budget: { limitMs: number; windowMs: number },
  opts: { recentRuns: Array<{ ts: string; durationMs: number; sleepAffected?: boolean | undefined }> | undefined; now: Date },
): { allowed: boolean; usedMs: number } {
  const cutoff = opts.now.getTime() - budget.windowMs;
  const runs = opts.recentRuns ?? [];
  let usedMs = 0;
  for (const r of runs) {
    if (new Date(r.ts).getTime() >= cutoff) {
      usedMs += r.durationMs;
    }
  }
  return { allowed: usedMs < budget.limitMs, usedMs };
}

function isCronDue(cronExpr: string, ctx: ScheduleCheckContext): boolean {
  try {
    const interval = CronExpressionParser.parse(cronExpr, {
      currentDate: ctx.now,
    });
    const prev = interval.prev().toDate();
    if (!ctx.lastRun) {
      return prev <= ctx.now;
    }
    return prev > new Date(ctx.lastRun);
  } catch (e) {
    // Schema validation rejects an unparseable cron string at authoring
    // time, so this should be unreachable in practice — but if a card
    // slips through (an old box, a hand-edited file), degrade visibly
    // rather than silently never firing.
    console.warn(`isCronDue: invalid cron expression "${cronExpr}":`, e);
    return false;
  }
}

function isRruleDue(rruleStr: string, ctx: ScheduleCheckContext): boolean {
  try {
    const rule = rrulestr(rruleStr);
    const after = ctx.lastRun ? new Date(ctx.lastRun) : new Date(0);
    const occurrences = rule.between(after, ctx.now, false);
    return occurrences.length > 0;
  } catch (e) {
    // See isCronDue: near-unreachable once the schema validates RRULEs,
    // but a slipped-through card should degrade visibly.
    console.warn(`isRruleDue: invalid RRULE "${rruleStr}":`, e);
    return false;
  }
}

// ============================================
// Template
// ============================================

export interface ScheduledScriptTemplateOptions {
  cron?: string;
  at?: string;
  rrule?: string;
  until?: string;
  notBefore?: string;
  onWakeup?: boolean;
  once?: boolean;
  enabled?: boolean;
  runs: string;
  description?: string;
  source?: string;
  sourceRef?: string;
  createAfterSuccess?: Array<{ path: string; args: Record<string, string> }>;
  budget?: string;
  lockGroup?: string;
  requires?: string[];
}

export class InvalidScheduledScriptTemplateError extends Error {
  constructor(issues: string) {
    super(`createScheduledScriptTemplate produced an invalid card: ${issues}`);
    this.name = "InvalidScheduledScriptTemplateError";
  }
}

/**
 * Create a scheduled-script card template (YAML frontmatter + empty body).
 * Throws {@link InvalidScheduledScriptTemplateError} if the assembled fields
 * would fail schema validation — a programmatic caller should fail here, not
 * hand the box a card that can't load.
 */
export function createScheduledScriptTemplate(options: ScheduledScriptTemplateOptions): string {
  const fields: Record<string, unknown> = {
  };
  if (options.cron !== undefined) fields["cron"] = options.cron;
  if (options.at !== undefined) fields["at"] = options.at;
  if (options.rrule !== undefined) fields["rrule"] = options.rrule;
  if (options.until !== undefined) fields["until"] = options.until;
  if (options.notBefore !== undefined) fields["not-before"] = options.notBefore;
  if (options.onWakeup === true) fields["on-wakeup"] = true;
  if (options.once === true) fields["once"] = true;
  if (options.enabled === false) fields["enabled"] = false;
  if (options.budget !== undefined) fields["budget"] = options.budget;
  if (options.lockGroup !== undefined) fields["lock-group"] = options.lockGroup;
  if (options.description !== undefined) fields["description"] = options.description;
  fields["runs"] = options.runs;
  if (options.source !== undefined || options.sourceRef !== undefined) {
    if (options.sourceRef !== undefined) {
      const src: Record<string, string> = {};
      if (options.source !== undefined) src["text"] = options.source;
      src["ref"] = options.sourceRef;
      fields["source"] = src;
    } else {
      fields["source"] = options.source;
    }
  }
  if (options.createAfterSuccess !== undefined && options.createAfterSuccess.length > 0) {
    fields["create-after-success"] = options.createAfterSuccess.map((e) => ({
      path: e.path,
      ...(Object.keys(e.args).length > 0 && { args: e.args }),
    }));
  }
  if (options.requires !== undefined && options.requires.length > 0) {
    fields["requires"] = { connectors: options.requires };
  }
  const check = ScheduledScriptSchema.frontmatterSchema.safeParse({
    type: "scheduled-script",
    ...fields,
  });
  if (!check.success) {
    const issues = check.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new InvalidScheduledScriptTemplateError(issues);
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
