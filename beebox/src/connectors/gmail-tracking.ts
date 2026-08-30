/** Gmail tracked-working-set discovery and automatic tracking budgets. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { cardFields, parseCardText } from "../core/card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { EmailThreadSchema } from "../schemas/email-thread.js";

const TRACKED_THREAD_GLOB = "**/*.email-thread.card";
const TRACKED_THREAD_IGNORE = [
  "node_modules/**",
  ".git/**",
  "tmp/**",
  ".beebox/**",
  "procedure/runs/**",
  "store/trash/**",
];

export interface TrackedGmailThread {
  threadId: string;
  absPath: string;
  relPath: string;
}

class DuplicateTrackedGmailThreadError extends Error {
  readonly threadId: string;
  readonly paths: string[];

  constructor(threadId: string, paths: string[]) {
    super(`Gmail thread ${threadId} is tracked by more than one card: ${paths.join(", ")}`);
    this.name = "DuplicateTrackedGmailThreadError";
    this.threadId = threadId;
    this.paths = paths;
  }
}

class InvalidAutomaticTrackingEventError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(`Invalid automatic Gmail tracking timestamp: ${value}`);
    this.name = "InvalidAutomaticTrackingEventError";
    this.value = value;
  }
}

/** Find every live email-thread card and index it by its full Gmail thread ID. */
export async function findTrackedGmailThreads(
  boxRoot: string,
): Promise<Map<string, TrackedGmailThread>> {
  const schemas = await createCardSchemaMap(boxRoot);
  const paths = await glob(TRACKED_THREAD_GLOB, {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: TRACKED_THREAD_IGNORE,
  });
  const tracked = new Map<string, TrackedGmailThread>();
  for (const absPath of paths.toSorted()) {
    const relPath = path.relative(boxRoot, absPath);
    const content = await fs.readFile(absPath, "utf-8");
    const parsed = parseCardText(content, {
      source: relPath,
      schemas,
      type: "email-thread",
    });
    const fields = cardFields(parsed, EmailThreadSchema);
    const threadId = fields["thread-id"];
    const existing = tracked.get(threadId);
    if (existing !== undefined) {
      throw new DuplicateTrackedGmailThreadError(threadId, [existing.relPath, relPath]);
    }
    tracked.set(threadId, { threadId, absPath, relPath });
  }
  return tracked;
}

export interface AutomaticTrackingBudget {
  threads: number;
  windowMs: number;
}

export interface AutomaticTrackingBudgetStatus {
  remaining: number;
  events: string[];
}

/** Calculate remaining capacity in a rolling automatic-thread tracking window. */
export function remainingAutomaticTrackingBudget(opts: {
  budget: AutomaticTrackingBudget;
  events: string[];
  now: Date;
}): AutomaticTrackingBudgetStatus {
  const cutoff = opts.now.getTime() - opts.budget.windowMs;
  const events = opts.events.filter((value) => {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      throw new InvalidAutomaticTrackingEventError(value);
    }
    return timestamp >= cutoff;
  });
  return {
    remaining: Math.max(0, opts.budget.threads - events.length),
    events,
  };
}
