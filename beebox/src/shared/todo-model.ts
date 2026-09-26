/**
 * Shared todo vocabulary — the status enum, date/relative-`start` parsing,
 * attribute validation, and box-local plate-state derivation.
 *
 * Consumed by the `{% todo %}` Markdoc schema (`markdoc-config.ts`), and
 * (per the plan, later tracks) the frontmatter `todos:` Zod shape, the
 * collector, the CLI, and the React rendering components. Kept here, once,
 * so the enum and its defaults aren't restated at each of those sites
 * (types-are-structure — see `docs/implemented-plans/todo-annotation.md`).
 *
 * **Pure TypeScript only.** No React, no `fs`/Node-only APIs, no DOM
 * imports — both tsconfigs (backend + frontend) include this directory.
 * `now`/`timeZone` are always passed in by the caller (never read from
 * `Date.now()` or box config here) so plate-state derivation stays a pure,
 * frozen-clock-testable function.
 */

import { z } from "zod";
import { assertNever, invariant } from "./invariant.js";

/**
 * The conventional `assigned`/`by` value meaning the agent rather than the
 * boxholder. `assigned` absent means the boxholder owns the todo; this value
 * means the agent chases it. `by` absent means the boxholder wrote it; this
 * value means the agent did.
 */
export const TODO_AGENT = "agent";

/** The stock box-wide `todo-view` card, "The Plate" (`core/box/defaults.ts`, `installTodoView`). */
export const PLATE_CARD_PATH = "_content/plate.todo-view.card";

/**
 * True when a todo is the BOXHOLDER's to act on — `assigned` absent, or
 * naming anyone but the agent.
 *
 * The distinction is load-bearing for anything that competes for the
 * boxholder's attention: an agent's own follow-up is real work with a real
 * owner, but it is not on the boxholder's plate, and counting it there taxes
 * the person for work they were never asked to do. Surfaces built FOR the
 * agent (`bbx todos --assigned agent`, the review job's brief) deliberately
 * do not use this filter.
 */
export function isBoxholderTodo(todo: { assigned?: string | undefined }): boolean {
  return todo.assigned !== TODO_AGENT;
}

/** The closed status vocabulary. Absence on a todo means `"open"`. */
export const TODO_STATUSES = ["open", "done", "dropped", "parked"] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

/** Narrows an arbitrary string to `TodoStatus` without an `as` cast. */
export function isTodoStatus(value: string): value is TodoStatus {
  for (const status of TODO_STATUSES) {
    if (status === value) return true;
  }
  return false;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an ISO calendar date (`YYYY-MM-DD`) into its UTC-midnight epoch
 * milliseconds, or `null` if the string isn't in that shape or doesn't name
 * a real calendar date (e.g. `2026-02-30` — `Date.UTC` would silently roll
 * that into March, so the round-trip is checked explicitly).
 */
export function parseIsoDate(value: string): number | null {
  const match = ISO_DATE_RE.exec(value);
  if (match === null) return null;
  const [, yearStr, monthStr, dayStr] = match;
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) return null;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const epoch = Date.UTC(year, month - 1, day);
  const check = new Date(epoch);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return epoch;
}

export type RelativeIntervalUnit = "d" | "w";

export interface RelativeInterval {
  amount: number;
  unit: RelativeIntervalUnit;
}

const RELATIVE_START_RE = /^-(\d+)([dw])$/;

function isRelativeIntervalUnit(value: string): value is RelativeIntervalUnit {
  return value === "d" || value === "w";
}

/**
 * Parse a relative `start` value (`-3d` / `-2w`, meaning "N days/weeks
 * before `due`"). Returns `null` for anything else, including an absolute
 * ISO date (callers try `parseIsoDate` first).
 */
export function parseRelativeStart(value: string): RelativeInterval | null {
  const match = RELATIVE_START_RE.exec(value);
  if (match === null) return null;
  const [, amountStr, unitStr] = match;
  if (amountStr === undefined || unitStr === undefined || !isRelativeIntervalUnit(unitStr)) return null;
  return { amount: Number(amountStr), unit: unitStr };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve `start` (absolute ISO date, or relative `-Nd`/`-Nw` against
 * `due`) to a UTC-midnight epoch, or `null` when it's malformed, or
 * relative with no `due` to resolve against. Attribute-level validation
 * (`validateTodoAttributes`) is what reports *why* it's invalid; this just
 * resolves the value plate-state derivation needs.
 */
export function resolveStartEpoch(start: string, due: string | undefined): number | null {
  const absolute = parseIsoDate(start);
  if (absolute !== null) return absolute;
  const relative = parseRelativeStart(start);
  if (relative === null) return null;
  if (due === undefined || due === "") return null;
  const dueEpoch = parseIsoDate(due);
  if (dueEpoch === null) return null;
  const deltaDays = relative.unit === "w" ? relative.amount * 7 : relative.amount;
  return dueEpoch - deltaDays * MS_PER_DAY;
}

/**
 * The subset of a todo's attributes that participate in validation. Fields
 * are `string | undefined` rather than optional (`?:`) so callers built from
 * an already-`string | undefined`-typed source (e.g. the Markdoc schema's
 * `stringAttr` narrowing) can pass the object through directly under
 * `exactOptionalPropertyTypes`.
 */
export interface TodoAttributes {
  by: string | undefined;
  created: string | undefined;
  due: string | undefined;
  start: string | undefined;
  recheck: string | undefined;
}

export interface TodoValidationError {
  id: string;
  message: string;
}

/**
 * The `recheck` value that retires a todo from the todo-review sweep for good
 * (`docs/plans/todos-ui.md`, Track 7). Any other `recheck` is an ISO date.
 */
export const RECHECK_NEVER = "never";

/**
 * A parsed `recheck`: `"never"`, the UTC-midnight epoch of its date, or `null`
 * when absent or malformed (validation reports the malformed case).
 */
export function parseRecheck(recheck: string | undefined): number | typeof RECHECK_NEVER | null {
  if (recheck === undefined || recheck === "") return null;
  if (recheck === RECHECK_NEVER) return RECHECK_NEVER;
  return parseIsoDate(recheck);
}

/**
 * True when the todo-review sweep must not list this todo today: its `recheck`
 * is `never`, or a date after `todayEpoch` (a box-local calendar-date epoch,
 * `boxLocalDateEpoch`). `recheck` is the review's bookkeeping only: nothing
 * else (plate state, badge, counts, order) reads it.
 */
export function recheckDefers(recheck: string | undefined, todayEpoch: number): boolean {
  const parsed = parseRecheck(recheck);
  if (parsed === null) return false;
  return parsed === RECHECK_NEVER || parsed > todayEpoch;
}

/**
 * Validate a todo's date/provenance attributes per the plan's rules:
 * `created`/`due`/`start` must be valid dates (or a valid relative `start`);
 * `recheck` must be a valid date or `never`;
 * a relative `start` requires `due`; an absolute `start` after an absolute
 * `due` is an error; `created` is required when `by="agent"`. Does NOT
 * validate `status` — that's a Markdoc `matches` enum, enforced by the
 * schema itself (`markdoc-config.ts`).
 */
export function validateTodoAttributes(attrs: TodoAttributes): TodoValidationError[] {
  const errors: TodoValidationError[] = [];
  const { by, created, due, start, recheck } = attrs;

  if (created !== undefined && created !== "" && parseIsoDate(created) === null) {
    errors.push({
      id: "todo-invalid-created",
      message: `{% todo %} \`created\` is not a valid ISO date: "${created}"`,
    });
  }

  let dueEpoch: number | null = null;
  if (due !== undefined && due !== "") {
    dueEpoch = parseIsoDate(due);
    if (dueEpoch === null) {
      errors.push({
        id: "todo-invalid-due",
        message: `{% todo %} \`due\` is not a valid ISO date: "${due}"`,
      });
    }
  }

  if (start !== undefined && start !== "") {
    const startAbsolute = parseIsoDate(start);
    const startRelative = startAbsolute === null ? parseRelativeStart(start) : null;
    if (startAbsolute === null && startRelative === null) {
      errors.push({
        id: "todo-invalid-start",
        message: `{% todo %} \`start\` is not a valid ISO date or relative interval (e.g. "-3d"): "${start}"`,
      });
    } else if (startRelative !== null && (due === undefined || due === "")) {
      errors.push({
        id: "todo-relative-start-requires-due",
        message: `{% todo %} a relative \`start\` ("${start}") requires \`due\` to be set`,
      });
    } else if (startAbsolute !== null && dueEpoch !== null && startAbsolute > dueEpoch) {
      errors.push({
        id: "todo-start-after-due",
        message: `{% todo %} \`start\` ("${start}") is after \`due\` ("${due}")`,
      });
    }
  }

  if (recheck !== undefined && recheck !== "" && parseRecheck(recheck) === null) {
    errors.push({
      id: "todo-invalid-recheck",
      message: `{% todo %} \`recheck\` must be an ISO date (YYYY-MM-DD) or "never": "${recheck}"`,
    });
  }

  if (by === "agent" && (created === undefined || created === "")) {
    errors.push({
      id: "todo-agent-requires-created",
      message: '{% todo %} `created` is required when `by="agent"`',
    });
  }

  return errors;
}

/**
 * Zod shape for one `see-also` entry inside a frontmatter `todos:` list
 * entry — mirrors the `{% see-also %}` Markdoc tag's rule (`markdoc-config.ts`):
 * exactly one of `ref` / `href`, plus an optional `note` (the tag's body text
 * has no frontmatter equivalent, so `note` stands in for it).
 */
const TodoSeeAlsoEntrySchema = z
  .object({
    ref: z.string().optional(),
    href: z.string().optional(),
    note: z.string().optional(),
  })
  .superRefine((entry, ctx) => {
    const hasRef = entry.ref !== undefined && entry.ref !== "";
    const hasHref = entry.href !== undefined && entry.href !== "";
    if (hasRef && hasHref) {
      ctx.addIssue({
        code: "custom",
        message: "todos `see-also` entry takes exactly one of `ref` or `href`, not both",
      });
    } else if (!hasRef && !hasHref) {
      ctx.addIssue({
        code: "custom",
        message: "todos `see-also` entry requires exactly one of `ref` or `href`",
      });
    }
  });

export type TodoSeeAlsoEntry = z.infer<typeof TodoSeeAlsoEntrySchema>;

/**
 * Zod shape for one entry of the universal frontmatter `todos:` field
 * (`src/cards/schema.ts` `GLOBAL_CARD_FIELDS`). Keys mirror the `{% todo %}`
 * tag's attributes exactly (same names, same `TODO_STATUSES` enum); `text` is
 * the one thing the tag gets for free from its body and the frontmatter
 * shape must name explicitly. Date/provenance rules are NOT restated here —
 * `superRefine` delegates to {@link validateTodoAttributes}, the tag's own
 * validator, so the two capture forms share one rule set (code-style: one
 * source of truth).
 */
export const TodoEntrySchema = z
  .object({
    text: z.string(),
    id: z.string().optional(),
    assigned: z.string().optional(),
    by: z.string().optional(),
    created: z.string().optional(),
    start: z.string().optional(),
    due: z.string().optional(),
    recheck: z.string().optional(),
    status: z.enum(TODO_STATUSES).optional(),
    "see-also": z.array(TodoSeeAlsoEntrySchema).optional(),
  })
  .superRefine((entry, ctx) => {
    for (const error of validateTodoAttributes({
      by: entry.by,
      created: entry.created,
      due: entry.due,
      start: entry.start,
      recheck: entry.recheck,
    })) {
      ctx.addIssue({ code: "custom", message: error.message });
    }
  });

export type TodoEntry = z.infer<typeof TodoEntrySchema>;

/**
 * Zod shape for the universal frontmatter `todos:` field itself — an
 * optional list of {@link TodoEntry}. Injected into every card's frontmatter
 * schema by `GLOBAL_CARD_FIELDS` (`src/cards/schema.ts`), same precedence
 * rule as `title`/`contains`: a schema declaring its own `todos` field wins.
 */
export const TodosFieldSchema = z.array(TodoEntrySchema).optional();

/**
 * Plate-state derivation truth table (box-local, per the plan): for an
 * `open` todo — `escalated` (today > `due`), `on-plate` (today ≥ `start`,
 * or no `start` at all — undated-or-due-without-start is on the plate
 * immediately), `quiet` (today < `start`). Non-open statuses are their own
 * terminal states.
 */
export type TodoPlateState = "escalated" | "on-plate" | "quiet" | "done" | "dropped" | "parked";

export interface TodoPlateInput {
  status: TodoStatus;
  start?: string;
  due?: string;
}

export interface TodoPlateContext {
  now: Date;
  /** IANA timezone the box is configured for — NOT a bare UTC comparison. */
  timeZone: string;
}

/**
 * The box-local calendar date (UTC-midnight epoch of that date) `now`
 * falls on when read in `timeZone`. `Intl.DateTimeFormat`'s `"en-CA"`
 * locale formats as `YYYY-MM-DD` directly, avoiding hand-rolled
 * offset arithmetic (which DST transitions would make wrong).
 *
 * Exported for callers that need to compare a wall-clock instant against
 * `start`/`due`-shaped calendar epochs on the same basis this module
 * uses internally (e.g. the review sweep's "crossed `start` since the
 * last sweep" baseline, which must be a calendar-day comparison, not a
 * raw-epoch one — a sweep that runs mid-afternoon must not undercount a
 * `start` dated earlier that same box-local day).
 */
export function boxLocalDateEpoch(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatted = formatter.format(now);
  const epoch = parseIsoDate(formatted);
  invariant(epoch !== null, `box-local date formatting produced an unparseable date: "${formatted}"`);
  return epoch;
}

/**
 * Derive the plate-state for a todo. `start`/`due` are assumed already
 * attribute-valid (`validateTodoAttributes` returned no errors for them);
 * an unresolvable `start` (e.g. relative with no `due`) is treated the same
 * as absent — validation is what reports that case, not this function.
 */
export function deriveTodoPlateState(todo: TodoPlateInput, ctx: TodoPlateContext): TodoPlateState {
  switch (todo.status) {
    case "done":
      return "done";
    case "dropped":
      return "dropped";
    case "parked":
      return "parked";
    case "open": {
      const today = boxLocalDateEpoch(ctx.now, ctx.timeZone);
      const dueEpoch = todo.due !== undefined && todo.due !== "" ? parseIsoDate(todo.due) : null;
      if (dueEpoch !== null && today > dueEpoch) return "escalated";
      const startEpoch =
        todo.start !== undefined && todo.start !== "" ? resolveStartEpoch(todo.start, todo.due) : null;
      if (startEpoch !== null) {
        return today >= startEpoch ? "on-plate" : "quiet";
      }
      return "on-plate";
    }
    default:
      return assertNever(todo.status);
  }
}
