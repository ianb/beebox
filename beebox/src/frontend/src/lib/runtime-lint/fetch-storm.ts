/**
 * Runtime lint check `fetch-storm`: one request (procedure and input) does
 * not start more than 8 times in 10 s.
 *
 * Counted where requests begin: the tRPC link chain (`runtimeLintLink`, above
 * the retry link, so one logical query counts once and its transport retries
 * do not), and the raw file text query (`components/file-view-data.ts`, whose
 * own retries run through its query function and so do count). TanStack's
 * `fetchStatus` is not the counting point: invalidating an active query
 * cancels and restarts it while the status stays "fetching".
 *
 * Plan: `docs/plans/runtime-lint.md`, Track 2.
 */

import type { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { opaqueId, procedureName, reportRuntimeLint } from "./report";

const WINDOW_MS = 10_000;
const LIMIT = 8;
const MAX_TRACKED = 500;

const startsByRequest = new Map<string, number[]>();

/** Count one start at time `now`; reports when the window holds more than the limit. */
export function countRequestStart({ procedure, input, now }: { procedure: string; input: unknown; now: number }): void {
  const inputKey = input === undefined ? "" : JSON.stringify(input);
  const key = `${procedure}|${inputKey}`;
  const starts = (startsByRequest.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  starts.push(now);
  startsByRequest.delete(key);
  startsByRequest.set(key, starts);
  if (startsByRequest.size > MAX_TRACKED) {
    const oldest = startsByRequest.keys().next().value;
    if (oldest !== undefined) startsByRequest.delete(oldest);
  }
  if (starts.length > LIMIT) {
    reportRuntimeLint({ check: "fetch-storm", procedure: procedureName(procedure), input: opaqueId(key), starts: starts.length, windowMs: WINDOW_MS });
  }
}

export function noteRequestStart(procedure: string, input: unknown): void {
  countRequestStart({ procedure, input, now: performance.now() });
}

/** Counts each tRPC query once, before the retry link. Passes every operation through unchanged. */
export function runtimeLintLink<TRouter extends AnyRouter>(): TRPCLink<TRouter> {
  return () => ({ op, next }) => {
    if (op.type === "query") noteRequestStart(op.path, op.input);
    return next(op);
  };
}

/** Tests only. */
export function resetFetchStormForTest(): void {
  startsByRequest.clear();
}
