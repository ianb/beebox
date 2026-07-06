/**
 * Inbound third-party response validation (Track D.2).
 *
 * The Google/Telegram service real implementations parse raw API responses
 * with unchecked `.json<T>()` casts — a compile-time assertion with zero
 * runtime checking, so an API shape drift lands in a card as silent
 * `undefined`s instead of a loud failure. {@link validateResponse} runs a
 * narrow zod schema (only the fields we consume) over the raw bytes at that
 * boundary and throws {@link ConnectorResponseError} — naming the service and
 * operation — the moment the shape stops matching.
 *
 * Deliberately validate-and-passthrough: the schema proves the response is
 * well-shaped, then the caller returns its already-typed value unchanged. That
 * keeps the existing narrow interfaces and the interface/real/fake triad intact
 * (fakes construct typed values and never touch this path), and lets the
 * schemas stay drift-TOLERANT where they must — extra keys are ignored, and
 * open-ended enum-ish fields (e.g. calendar `status`) use `z.string()` so a new
 * Google value can't break a sync it has no business breaking.
 */

import type { z } from "zod";

/** Thrown when a third-party API response fails its inbound schema. */
export class ConnectorResponseError extends Error {
  readonly service: string;
  readonly operation: string;
  /** The zod issues, already summarized to `path: message` lines. */
  readonly issues: readonly string[];

  constructor(params: { service: string; operation: string; issues: readonly string[] }) {
    const { service, operation, issues } = params;
    super(
      `${service}.${operation}: response did not match expected shape ` +
        `(${issues.length} problem${issues.length === 1 ? "" : "s"}):\n` +
        issues.map((i) => `  - ${i}`).join("\n"),
    );
    this.name = "ConnectorResponseError";
    this.service = service;
    this.operation = operation;
    this.issues = issues;
  }
}

/**
 * Validate `raw` against `schema`. On success returns nothing (the caller keeps
 * its already-typed value); on failure throws {@link ConnectorResponseError}
 * with every issue at once. Never echoes the raw payload (it may hold personal
 * mail/message content) — only the field paths and zod messages.
 */
export function validateResponse(
  raw: unknown,
  ctx: { schema: z.ZodType; service: string; operation: string },
): void {
  const result = ctx.schema.safeParse(raw);
  if (result.success) return;
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
  throw new ConnectorResponseError({ service: ctx.service, operation: ctx.operation, issues });
}
