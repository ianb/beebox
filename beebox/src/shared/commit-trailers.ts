/**
 * Git commit-trailer parsing and the trailer-key vocabulary the history
 * browse UI reads.
 *
 * One module so the writers' vocabulary, the facet builder
 * (`lib/git-log.ts`), the `--grep` builder (`webapp/trpc/routers/history.ts`)
 * and the frontend readers cannot drift apart — they did, which is what
 * left procedure and trick commits looking like hand edits in the timeline.
 *
 * Leaf module: pure string handling, no git/process/DOM dependency.
 */

import { invariant } from "./invariant.js";

/**
 * Trailer keys that name a connector performing some action on a card.
 * For the browse UI these are treated as a single axis — selecting a
 * connector matches any of these trailers with that value.
 */
export const CONNECTOR_TRAILER_KEYS = [
  "Pulled-By",
  "Created-By",
  "Fetched-By",
  "Pushed-By",
  "Sent-By",
] as const;

/**
 * Trailer keys indicating a user-facing touchpoint (webapp, API call, voice/text input).
 */
export const TOUCHPOINT_TRAILER_KEYS = ["Source", "Endpoint", "Type"] as const;

/**
 * Trailer keys indicating feedback signal on a brief or card.
 */
export const FEEDBACK_TRAILER_KEYS = [
  "Thumbs",
  "Reactions",
  "Rating",
  "Feedback-Source",
] as const;

/**
 * Trailer keys that say what caused a commit rather than who typed it —
 * the "triggered by" axis.
 *
 * `Workflow` has no writer left: it is the name procedures went by before
 * the rename, and it stays here so a box's pre-rename history keeps
 * answering the same filter as its procedure runs (see `TRIGGER_KINDS`).
 */
export const TRIGGER_TRAILER_KEYS = [
  "Triggered-By",
  "Procedure",
  "Workflow",
  "Run-By",
] as const;

/**
 * The `Triggered-By` trailer for one actor, or no trailer at all.
 *
 * Attribution is optional at the operation level because a test (or a future
 * caller that genuinely has no actor) should not have to invent one — but a
 * surface a person or an agent reaches through always has one, so the git log
 * can answer "who mounted this" (`docs/plans/agent-capability-delegation.md`).
 */
export function triggeredByTrailer(actor: string | undefined): Record<string, string> {
  return actor === undefined ? {} : { "Triggered-By": actor };
}

/** Trailer key naming the step within a procedure run. */
export const TRIGGER_STEP_TRAILER_KEY = "Step";

/**
 * The kinds of thing that can trigger a commit.
 *
 * - `procedure` — a `bbx procedure` run (`Procedure:`, or pre-rename `Workflow:`)
 * - `trick` — a `bbx trick` run (`Run-By: trick/<name>`)
 * - `command` — any other named invocation (`Triggered-By: bbx wakeup`, `generateDocs`)
 */
export const TRIGGER_KINDS = ["procedure", "trick", "command"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** How a trigger kind is spoken in the UI, singular and as a group heading. */
export const TRIGGER_KIND_LABELS: Record<TriggerKind, { one: string; group: string }> = {
  procedure: { one: "procedure", group: "Procedures" },
  trick: { one: "trick", group: "Tricks" },
  command: { one: "command", group: "Commands" },
};

/**
 * One trigger, identified by a `<kind>/<name>` id.
 *
 * The id is what the filter persists (view-card params, URL query) and what
 * `buildTriggerGrep` turns back into a trailer pattern; `name` is what a
 * boxholder reads. Every kind is prefixed, including `command`, so an id is
 * never ambiguous about which trailer key it came from.
 */
export interface CommitTrigger {
  id: string;
  kind: TriggerKind;
  name: string;
}

/** Matches an id produced by `triggerId` — validate filter input against this. */
export const TRIGGER_ID_PATTERN = /^(?:procedure|trick|command)\/.+$/;

/** Compose the persisted id for a kind and run name. */
export function triggerId(kind: TriggerKind, name: string): string {
  return `${kind}/${name}`;
}

const TRIGGER_KIND_SET = new Set<string>(TRIGGER_KINDS);

function isTriggerKind(value: string): value is TriggerKind {
  return TRIGGER_KIND_SET.has(value);
}

/** Split a persisted id back into kind and name; null when it is not a trigger id. */
export function parseTriggerId(id: string): CommitTrigger | null {
  const slash = id.indexOf("/");
  if (slash <= 0) return null;
  const kind = id.slice(0, slash);
  const name = id.slice(slash + 1);
  if (name === "" || !isTriggerKind(kind)) return null;
  return { id, kind, name };
}

/**
 * Read one trailer line as a trigger, or null when the key is not a trigger key.
 *
 * `Run-By` is only ever written as `trick/<name>`; any other shape is kept as
 * a command rather than guessed at, so an unrecognized writer still shows up
 * in history instead of vanishing from the axis.
 */
export function triggerFromTrailer(key: string, value: string): CommitTrigger | null {
  const name = value.trim();
  if (name === "") return null;
  if (key === "Procedure" || key === "Workflow") {
    return { id: triggerId("procedure", name), kind: "procedure", name };
  }
  if (key === "Run-By") {
    const trick = name.startsWith("trick/") ? name.slice("trick/".length) : null;
    return trick !== null && trick !== ""
      ? { id: triggerId("trick", trick), kind: "trick", name: trick }
      : { id: triggerId("command", name), kind: "command", name };
  }
  if (key === "Triggered-By") {
    return { id: triggerId("command", name), kind: "command", name };
  }
  return null;
}

/** Human label for a trigger: the bare name for a command, kind-qualified otherwise. */
export function triggerLabel(trigger: CommitTrigger): string {
  return trigger.kind === "command"
    ? trigger.name
    : `${TRIGGER_KIND_LABELS[trigger.kind].one} ${trigger.name}`;
}

/** Sort triggers by kind (procedures, tricks, commands) then name. */
export function compareTriggers(a: CommitTrigger, b: CommitTrigger): number {
  const byKind = TRIGGER_KINDS.indexOf(a.kind) - TRIGGER_KINDS.indexOf(b.kind);
  return byKind !== 0 ? byKind : a.name.localeCompare(b.name);
}

/** Escape a value so it can be interpolated into a git `--grep` ERE pattern. */
export function escapeGrep(value: string): string {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}

/** The trailer-line pattern (unanchored) that one trigger id matches. */
function triggerGrepBody(trigger: CommitTrigger): string {
  const name = escapeGrep(trigger.name);
  if (trigger.kind === "procedure") return `(Procedure|Workflow): ${name}`;
  if (trigger.kind === "trick") return `Run-By: trick/${name}`;
  return `Triggered-By: ${name}`;
}

/**
 * One `--grep` pattern matching any of the given trigger ids — the OR within
 * the triggered-by axis, which git's `--all-match` then ANDs with other axes.
 *
 * Throws on an id that is not a trigger id: a filter value we cannot express
 * would otherwise silently widen the result to every commit.
 */
export function buildTriggerGrep(ids: readonly string[]): string {
  const bodies = ids.map((id) => {
    const trigger = parseTriggerId(id);
    invariant(trigger !== null, `not a trigger id: ${JSON.stringify(id)}`);
    return triggerGrepBody(trigger);
  });
  return `^(${bodies.join("|")})$`;
}

/** A commit's parsed trailers, as `parseTrailersMulti` returns them. */
export type ParsedTrailers = Record<string, string | string[]>;

function trailerList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** First value of a trailer that may repeat. */
export function trailerString(value: string | string[] | undefined): string | undefined {
  const list = trailerList(value);
  return list[0];
}

/**
 * Every trigger named by a commit's trailers, deduplicated and ordered by kind.
 * Empty for a hand edit — which is the distinction the History timeline exists
 * to draw.
 */
export function commitTriggers(trailers: ParsedTrailers | undefined): CommitTrigger[] {
  if (trailers === undefined) return [];
  const byId = new Map<string, CommitTrigger>();
  for (const key of TRIGGER_TRAILER_KEYS) {
    for (const value of trailerList(trailers[key])) {
      const trigger = triggerFromTrailer(key, value);
      if (trigger !== null && !byId.has(trigger.id)) byId.set(trigger.id, trigger);
    }
  }
  return [...byId.values()].toSorted(compareTriggers);
}

/** The step within a procedure run, when the commit names one. */
export function commitStep(trailers: ParsedTrailers | undefined): string | undefined {
  const step = trailerString(trailers?.[TRIGGER_STEP_TRAILER_KEY])?.trim();
  return step === undefined || step === "" ? undefined : step;
}

/** Trailer keys rendered as their own UI element, so the commit body drops them. */
const RENDERED_TRAILER_KEYS = new Set<string>([
  "Session",
  "Phase",
  ...TRIGGER_TRAILER_KEYS,
  TRIGGER_STEP_TRAILER_KEY,
  ...FEEDBACK_TRAILER_KEYS,
  "Agent",
  "Items-Processed",
]);

/** One trailer line: `Key: value`. */
const TRAILER_LINE = /^([A-Za-z-]+):\s*(.+)$/;

/** Drop the trailers the UI renders itself from a commit body. */
export function stripTrailers(body: string): string {
  return body
    .split("\n")
    .filter((line) => {
      const key = line.match(TRAILER_LINE)?.[1];
      return key === undefined || !RENDERED_TRAILER_KEYS.has(key);
    })
    .join("\n")
    .trim();
}

/**
 * Parse git trailers from a commit body (single-value).
 */
export function parseTrailers(body: string | undefined): Record<string, string> {
  const trailers: Record<string, string> = {};
  if (!body) return trailers;

  for (const line of body.split("\n")) {
    const match = line.match(TRAILER_LINE);
    if (match) {
      const [, key, value] = match;
      invariant(key !== undefined && value !== undefined, "regex capture groups missing on a successful match");
      trailers[key] = value;
    }
  }
  return trailers;
}

/**
 * Parse git trailers from a commit body (multi-value).
 */
export function parseTrailersMulti(body: string | undefined): ParsedTrailers {
  const trailers: ParsedTrailers = {};
  if (!body) return trailers;

  for (const line of body.split("\n")) {
    const match = line.match(TRAILER_LINE);
    if (match) {
      const [, key, value] = match;
      invariant(key !== undefined && value !== undefined, "regex capture groups missing on a successful match");
      const existing = trailers[key];
      if (existing === undefined) {
        trailers[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        trailers[key] = [existing, value];
      }
    }
  }
  return trailers;
}

/**
 * Scan a commit's trailer block for the axes the History filter bar offers.
 * Accumulates into caller-owned maps so one pass over a whole log can build
 * every facet.
 */
export function collectTrailerFacets(
  block: string,
  into: { connectors: Set<string>; triggers: Map<string, CommitTrigger> }
): void {
  const connectorKeys = new Set<string>(CONNECTOR_TRAILER_KEYS);
  for (const line of block.split("\n")) {
    const match = line.match(TRAILER_LINE);
    if (!match) continue;
    const [, key, rawValue] = match;
    invariant(key !== undefined && rawValue !== undefined, "regex capture groups missing on a successful match");
    const value = rawValue.trim();
    if (value === "") continue;
    if (connectorKeys.has(key)) {
      into.connectors.add(value);
      continue;
    }
    const trigger = triggerFromTrailer(key, value);
    if (trigger !== null) into.triggers.set(trigger.id, trigger);
  }
}
