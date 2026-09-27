// Ambient declarations for the Claude Code `Workflow` runtime.
//
// A workflow script is not an ordinary module. The host parses it as plain
// JavaScript, gives it no filesystem and no Node API — so it can import
// nothing — and runs its body inside an async function, injecting the names
// below as globals. That last part is why every workflow ends in a top-level
// `return`, which TypeScript rejects as a grammar error (TS1108) and which the
// sources silence with a single `@ts-expect-error` on that one line.
//
// This file deliberately has no imports and no exports. That makes it a global
// script rather than a module, so `*.workflow.ts` sees these names without an
// import statement it would not be allowed to write.

/** How much thinking an agent is asked to spend. */
type WorkflowEffort = "low" | "medium" | "high" | "max";

/**
 * The subset of JSON Schema the runtime validates an agent's structured return
 * against. An agent given a `schema` returns an object matching it (or `null`
 * if the agent failed); one given no schema returns its text.
 */
interface WorkflowJsonSchema {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  description?: string;
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Readonly<Record<string, WorkflowJsonSchema>>;
  items?: WorkflowJsonSchema;
  enum?: readonly string[];
}

interface WorkflowAgentOptions {
  /** Short identifier for this agent in the run log. */
  label: string;
  /** Which declared phase this agent belongs to; must match a `meta.phases` title. */
  phase?: string;
  /** Validates the agent's return value, and shapes what it is asked to return. */
  schema?: WorkflowJsonSchema;
  /** Defaults to the runtime's own choice when omitted. */
  effort?: WorkflowEffort;
  /** A named subagent type, when the run should not use the default one. */
  agentType?: string;
}

/**
 * Run one subagent and wait for it. Resolves to `null` when the agent fails —
 * every call site has to decide what a missing result means, since a workflow
 * that drops failures silently reports a partial run as a complete one.
 *
 * `TResult` is the shape the `schema` option validates; with no schema the
 * agent's text comes back.
 */
declare function agent<TResult = string>(
  prompt: string,
  opts?: WorkflowAgentOptions,
): Promise<TResult | null>;

/**
 * Run thunks concurrently, preserving order. A failed member is `null` in the
 * returned array rather than a rejection, so one dead agent does not abandon
 * the other results.
 */
declare function parallel<TResult>(
  thunks: ReadonlyArray<() => PromiseLike<TResult>>,
): Promise<Array<TResult | null>>;

/**
 * Map a stage over items concurrently, with the same null-for-failure contract
 * as `parallel`. The runtime also accepts further stages after the first,
 * chaining each item's result into the next; only the single-stage form is
 * declared here, because that is the form this directory uses.
 */
declare function pipeline<TItem, TResult>(
  items: readonly TItem[],
  stage: (item: TItem) => PromiseLike<TResult>,
): Promise<Array<TResult | null>>;

/** Write a line to the run log. This is the only output a workflow has. */
declare function log(message: string): void;

/** Declare that the run has entered a phase; the title must appear in `meta.phases`. */
declare function phase(title: string): void;

/** One page of the browser pass: where to go, and which stories to check there. */
interface WorkflowPageAssignment {
  slug: string;
  path: string;
  ids: string[];
}

/**
 * Whatever the caller passed as `Workflow({args: …})` — untrusted JSON, and
 * absent entirely when the workflow is invoked bare. The optional keys below
 * are the union of what the five workflows in this directory accept; each one
 * validates the handful it needs and throws when a required key is missing.
 */
interface WorkflowArgs {
  /** Every workflow: absolute path to the repository root. */
  root?: string;
  /** consolidate: the group names to run a deduplicating merger over. */
  groups?: string[];
  /** verify: how many batches `make-batches.ts` wrote into `batches.json`. */
  batchCount?: number;
  /** verify: a pre-computed page assignment, skipping the mapping agent. */
  pages?: WorkflowPageAssignment[];
  /** panel: story ids a code verifier called inaccurate. */
  flagged?: string[];
  /** panel: story ids the running app was driven through and failed. */
  browserFailed?: string[];
  /** recheck: the catalog date to re-check against, and which stories. */
  date?: string;
  ids?: string[];
  /** recheck: names the output directory, so two rechecks cannot merge into each other. */
  run?: string;
}

declare const args: WorkflowArgs | undefined;

/**
 * Metadata the host injects about the running workflow. Its shape is not
 * documented anywhere reachable from this repository, so it is `unknown` on
 * purpose — a use site narrows it rather than trusting a guess made here.
 */
declare const workflow: unknown;

/** Agent-spend accounting for the run. */
declare const budget: {
  readonly total: number;
  readonly remaining: number;
};
