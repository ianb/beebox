/**
 * Scheduled script card schema - declarative scheduling for commands.
 *
 * Scheduled scripts define what to run and when. They live in
 * config/schedules/ and are evaluated by `cb tick` (cron) and
 * `cb wakeup` (on-wakeup scripts).
 *
 * The filename stem is the identity (e.g., check-email.scheduled-script.card).
 */

import { accessSync } from "node:fs";
import { join } from "node:path";
import { element } from "cardworks";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
const { rrulestr } = rrulePkg;

// ============================================
// Child elements
// ============================================

export const Runs = element("runs", {
  text: z.string(),
});

export const ScriptSource = element("source", {
  attrs: {
    ref: z.string().optional(),
  },
  text: z.string().optional(),
});

export const ScheduleDescription = element("description", {
  text: z.string(),
});

export const CreateAfterSuccess = element("create-after-success", {
  attrs: {
    path: z.string(),
  },
  text: z.string().optional(),
});

export const RequiresConnector = element("connector", {
  attrs: {
    /** Name of the connector config (maps to config/connectors/<name>.secret.json) */
    name: z.string(),
  },
});

export const Requires = element("requires", {
  children: z.array(RequiresConnector),
});

// ============================================
// Schema
// ============================================

export const ScheduledScriptSchema = element("scheduled-script", {
  attrs: {
    /** Cron expression (mutually exclusive with at/rrule) */
    cron: z.string().optional(),
    /** ISO datetime for one-shot execution (mutually exclusive) */
    at: z.string().optional(),
    /** iCalendar RRULE string (mutually exclusive) */
    rrule: z.string().optional(),
    /** Optional end date (ISO datetime) */
    until: z.string().optional(),
    /** Minimum interval since last run (e.g., "5m", "1h", "1d") */
    "not-before": z.string().optional(),
    /** Also run during cb wakeup (subject to not-before) */
    "on-wakeup": z.enum(["true", "false"]).optional(),
    /** Delete card after successful execution */
    once: z.enum(["true", "false"]).optional(),
    /** Enable/disable without deleting */
    enabled: z.enum(["true", "false"]).optional(),
    /** Runtime budget: max cumulative runtime within a window, e.g. "10m/5h" */
    budget: z.string().optional(),
    /** Lock group name — scripts in the same group won't run concurrently */
    "lock-group": z.string().optional(),
  },
  children: z.array(z.union([Runs, ScriptSource, ScheduleDescription, CreateAfterSuccess, Requires])),
  instructions: `# Scheduled Script Cards

Scheduled scripts define commands to run on a schedule. They live in \`config/schedules/\`.

## Schedule Types (mutually exclusive)
- **cron**: Standard cron expression (e.g., \`0 6 * * *\` for 6am daily)
- **at**: ISO datetime for a one-shot future execution
- **rrule**: iCalendar RRULE for complex recurrence patterns

## Attributes
- **not-before**: Minimum time since last run. Prevents running more often than this interval even if the schedule says otherwise. Use duration strings: \`5m\`, \`1h\`, \`4h\`, \`1d\`.
- **on-wakeup**: If \`true\`, also run opportunistically during \`cb wakeup\`, subject to not-before.
- **once**: If \`true\`, the card is deleted after successful execution.
- **until**: ISO datetime after which this schedule expires.
- **enabled**: Set to \`false\` to disable without deleting.
- **budget**: Max cumulative runtime within a window. Format: \`"LIMIT/WINDOW"\` (e.g., \`"10m/5h"\` = max 10 minutes of runtime in any 5-hour window). Scripts exceeding their budget are skipped until the window clears.
- **lock-group**: Named concurrency group. Scripts sharing a lock-group won't run concurrently — if one is already running, others in the same group are skipped.

## Children
- **<runs>**: The command to execute (required). Runs with cwd set to box root.
- **<description>**: Optional. Human-readable summary of what this schedule does.
- **<source>**: Optional. Why this schedule exists, with optional \`ref\` to a related card.
- **<create-after-success path="...">**: Optional. Create a card at the given path after successful execution. Text content is key=value lines (one per line) passed as template args. Skipped if the target file already exists.
- **<requires>**: Optional. Declares prerequisites. Contains \`<connector name="..." />\` children. The schedule won't run if any required connector's secret file (\`config/connectors/<name>.secret.json\`) is missing. Example: \`<requires><connector name="gmail" /></requires>\`.

## Guidelines
- Set reasonable not-before values to prevent hammering external services.
- Use on-wakeup for things that should happen whenever the agent is active.
- For one-shot future tasks, combine \`at\` with \`once="true"\`.`,
});

export type ScheduledScript = z.infer<typeof ScheduledScriptSchema>;

// ============================================
// Parsed scheduled script
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
  requires: ScheduleRequirements | undefined;
}

function buildSource(ref: string | undefined, text: string | undefined): { ref?: string; text?: string } {
  const result: { ref?: string; text?: string } = {};
  if (ref) result.ref = ref;
  if (text) result.text = text;
  return result;
}

/**
 * Parse a scheduled-script element into a typed structure.
 */
export function parseScheduledScript(script: ScheduledScript): ParsedScheduledScript {
  const children = script.children as Array<{ tagName: string; text?: string; attrs: Record<string, unknown> }>;

  const runsEl = children.find((c) => c.tagName === "runs");
  const descEl = children.find((c) => c.tagName === "description");
  const sourceEl = children.find((c) => c.tagName === "source");
  const chainEls = children.filter((c) => c.tagName === "create-after-success");
  const requiresEl = children.find((c) => c.tagName === "requires") as
    | { tagName: string; children?: Array<{ tagName: string; attrs: Record<string, unknown> }> }
    | undefined;

  const createAfterSuccess = chainEls.map((el) => {
    const args: Record<string, string> = {};
    const text = (el.text as string | undefined)?.trim();
    if (text) {
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          args[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
        }
      }
    }
    return { path: el.attrs.path as string, args };
  });

  const budgetStr = script.attrs.budget as string | undefined;

  let requires: ScheduleRequirements | undefined;
  if (requiresEl && requiresEl.children) {
    const connectors = requiresEl.children
      .filter((c) => c.tagName === "connector")
      .map((c) => c.attrs.name as string);
    if (connectors.length > 0) {
      requires = { connectors };
    }
  }

  return {
    cron: script.attrs.cron as string | undefined,
    at: script.attrs.at as string | undefined,
    rrule: script.attrs.rrule as string | undefined,
    until: script.attrs.until as string | undefined,
    notBefore: script.attrs["not-before"] as string | undefined,
    onWakeup: script.attrs["on-wakeup"] === "true",
    once: script.attrs.once === "true",
    enabled: script.attrs.enabled !== "false",
    runs: runsEl?.text ?? "",
    description: (descEl?.text as string | undefined) ?? undefined,
    source: sourceEl
      ? buildSource(sourceEl.attrs.ref as string | undefined, sourceEl.text)
      : undefined,
    createAfterSuccess,
    budget: budgetStr ? parseBudget(budgetStr) : undefined,
    lockGroup: script.attrs["lock-group"] as string | undefined,
    requires,
  };
}

// ============================================
// Duration parsing
// ============================================

/**
 * Parse a duration string like "5m", "1h", "1d", "2w" into milliseconds.
 *
 * Supported suffixes: s (seconds), m (minutes), h (hours), d (days), w (weeks)
 */
export function parseDuration(str: string): number {
  const match = str.match(/^(\d+\.?\d*)\s*(s|m|h|d|w)$/);
  if (!match) {
    throw new Error(`Invalid duration: "${str}". Use format like "5m", "1h", "1d", "2w".`);
  }

  const value = parseFloat(match[1]!);
  const unit = match[2]!;

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: "${unit}"`);
  }
}

/**
 * Parse a budget string like "10m/5h" into limit and window in milliseconds.
 * Format: "LIMIT/WINDOW" where both use duration syntax (e.g., "5m", "1h").
 */
export function parseBudget(str: string): { limitMs: number; windowMs: number } {
  const slash = str.indexOf("/");
  if (slash < 1 || slash >= str.length - 1) {
    throw new Error(`Invalid budget: "${str}". Use format like "10m/5h".`);
  }
  return {
    limitMs: parseDuration(str.slice(0, slash)),
    windowMs: parseDuration(str.slice(slash + 1)),
  };
}

// ============================================
// Requirements checking
// ============================================

/**
 * Check which required connectors are missing their secret files.
 * Returns the list of connector names whose secret file is absent.
 */
export function checkMissingConnectors(boxRoot: string, requires: ScheduleRequirements): string[] {
  const missing: string[] = [];
  for (const name of requires.connectors) {
    const secretPath = join(boxRoot, "config/connectors", `${name}.secret.json`);
    try {
      accessSync(secretPath);
    } catch {
      missing.push(name);
    }
  }
  return missing;
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

  // Check until
  if (script.until) {
    const untilDate = new Date(script.until);
    if (ctx.now > untilDate) return false;
  }

  // Check not-before (debounce)
  if (script.notBefore && ctx.lastRun) {
    const minInterval = parseDuration(script.notBefore);
    const elapsed = ctx.now.getTime() - new Date(ctx.lastRun).getTime();
    if (elapsed < minInterval) return false;
  }

  // Check schedule type
  if (script.cron) {
    return isCronDue(script.cron, ctx);
  }

  if (script.at) {
    const atDate = new Date(script.at);
    // Due if the time has passed and we haven't run yet
    return ctx.now >= atDate && !ctx.lastRun;
  }

  if (script.rrule) {
    return isRruleDue(script.rrule, ctx);
  }

  // No schedule type — run during tick if on-wakeup is set
  return script.onWakeup;
}

/**
 * Check if a script should run during wakeup (on-wakeup check).
 * Only checks not-before constraint, not the cron/at/rrule schedule.
 */
export function isDueForWakeup(script: ParsedScheduledScript, ctx: ScheduleCheckContext): boolean {
  if (!script.enabled) return false;
  if (!script.onWakeup) return false;

  // Check until
  if (script.until) {
    const untilDate = new Date(script.until);
    if (ctx.now > untilDate) return false;
  }

  // Check not-before
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
 * Sums non-sleep-affected durations within the budget window.
 */
export function isWithinBudget(
  budget: { limitMs: number; windowMs: number },
  opts: { recentRuns: Array<{ ts: string; durationMs: number; sleepAffected?: boolean }> | undefined; now: Date },
): { allowed: boolean; usedMs: number } {
  const cutoff = opts.now.getTime() - budget.windowMs;
  const runs = opts.recentRuns ?? [];
  let usedMs = 0;
  for (const r of runs) {
    if (r.sleepAffected) continue;
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

    // Get the most recent scheduled time
    const prev = interval.prev().toDate();

    if (!ctx.lastRun) {
      // Never run — due if there's a scheduled time in the past
      return prev <= ctx.now;
    }

    // Due if the most recent scheduled time is after our last run
    return prev > new Date(ctx.lastRun);
  } catch {
    // Invalid cron expression — don't run
    return false;
  }
}

function isRruleDue(rruleStr: string, ctx: ScheduleCheckContext): boolean {
  try {
    const rule = rrulestr(rruleStr);

    // Get occurrences between last run and now
    const after = ctx.lastRun ? new Date(ctx.lastRun) : new Date(0);
    const occurrences = rule.between(after, ctx.now, false);

    return occurrences.length > 0;
  } catch {
    // Invalid RRULE — don't run
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

/**
 * Create a scheduled-script card template.
 */
export function createScheduledScriptTemplate(options: ScheduledScriptTemplateOptions): string {
  const attrs: string[] = [];
  if (options.cron) attrs.push(`cron="${options.cron}"`);
  if (options.at) attrs.push(`at="${options.at}"`);
  if (options.rrule) attrs.push(`rrule="${options.rrule}"`);
  if (options.until) attrs.push(`until="${options.until}"`);
  if (options.notBefore) attrs.push(`not-before="${options.notBefore}"`);
  if (options.onWakeup) attrs.push(`on-wakeup="true"`);
  if (options.once) attrs.push(`once="true"`);
  if (options.enabled === false) attrs.push(`enabled="false"`);
  if (options.budget) attrs.push(`budget="${options.budget}"`);
  if (options.lockGroup) attrs.push(`lock-group="${options.lockGroup}"`);

  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";

  const children: string[] = [];
  if (options.description) {
    children.push(`  <description>${options.description}</description>`);
  }
  children.push(`  <runs>${options.runs}</runs>`);
  if (options.source || options.sourceRef) {
    const refAttr = options.sourceRef ? ` ref="${options.sourceRef}"` : "";
    children.push(`  <source${refAttr}>${options.source ?? ""}</source>`);
  }

  if (options.createAfterSuccess) {
    for (const chain of options.createAfterSuccess) {
      const lines = Object.entries(chain.args).map(([k, v]) => `${k}=${v}`).join("\n");
      children.push(`  <create-after-success path="${chain.path}">\n${lines}\n  </create-after-success>`);
    }
  }

  if (options.requires && options.requires.length > 0) {
    const connectorEls = options.requires.map((name) => `<connector name="${name}" />`).join("");
    children.push(`  <requires>${connectorEls}</requires>`);
  }

  return `<scheduled-script${attrStr}>\n${children.join("\n")}\n</scheduled-script>\n`;
}
