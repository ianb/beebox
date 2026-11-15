/**
 * Trigger activations: one armed trigger in one chat session, stored in
 * `.beebox/triggers/<session>.json` as `{ activations: [...] }`. Every write
 * goes through the session's trigger lock (`.beebox/triggers/<session>.lock`),
 * which the runner also holds through a fire's admission, delivery and state
 * write, so a disarm runs either before admission or after the write. See
 * plan:activity-triggers (Track A).
 *
 * Expiry is a pure decision (`expiryOf`) applied at read as well as by the
 * runner's timers, so a deadline that passed while nothing ran still reads as
 * `expired`.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { withFileLock } from "../../lib/file-lock.js";
import { getBoxTime } from "../../lib/time.js";
import { errnoCode } from "../../shared/error-guards.js";
import { lastActivitySeq } from "../activity/log.js";
import { emitTriggerChanged } from "./events.js";
import { appendTrace } from "./trace.js";

/** The default expiry: whichever of these comes first. */
export const DEFAULT_EXPIRES = { turns: 20, minutes: 120 } as const;
/** How long an arm, disarm or fire waits for the session's trigger lock. */
const LOCK_WAIT_MS = 5000;
const SESSION_ID = /^[\w-]{1,128}$/;

const finiteLimit = z.number().positive().finite();

/**
 * `{ turns?, minutes? }` with at least one positive finite limit, or the
 * string `"never"`. `{}` is rejected: unlimited is only by assertion.
 */
export const expiresSchema = z.union([
  z.literal("never"),
  z.object({ turns: finiteLimit.int().optional(), minutes: finiteLimit.optional() }).strict()
    .refine((value) => value.turns !== undefined || value.minutes !== undefined, {
      message: "expires needs a positive `turns` or `minutes` limit, or the string \"never\"",
    }),
]);
export type Expires = z.infer<typeof expiresSchema>;

export const ACTIVATION_STATES = ["armed", "failed", "done", "expired", "disarmed", "delivery-failed"] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];
/** States the runner never evaluates again. */
export const TERMINAL_STATES: readonly ActivationState[] = ["done", "expired", "disarmed", "delivery-failed"];

export const activationSchema = z.object({
  id: z.string().min(1),
  /** Box-relative path of the trigger file. */
  file: z.string().min(1),
  config: z.unknown(),
  label: z.string(),
  /** Seconds between ticks; absent when the module exports no `tick`. */
  tick: z.number().optional(),
  armedAt: z.string(),
  /** The log's highest `seq` at arm time; `history` is everything above it. */
  armedAtSeq: z.number().int().nonnegative(),
  /** ISO time of the `minutes` limit, or null when there is none. */
  deadline: z.string().nullable(),
  lastEvalSeq: z.number().int().nonnegative(),
  lastEvalAt: z.string().optional(),
  turnsSeen: z.number().int().nonnegative(),
  fires: z.number().int().nonnegative(),
  lastFireAt: z.string().optional(),
  expires: expiresSchema,
  state: z.enum(ACTIVATION_STATES),
  error: z.string().optional(),
  /** Whether an agent turn has carried this activation's `expired` state in a hint. */
  noticed: z.boolean(),
});
export type Activation = z.infer<typeof activationSchema>;

const fileSchema = z.object({ activations: z.array(activationSchema) });

/** Thrown for a session id that is not a plain id. */
export class TriggerSessionIdError extends Error {
  constructor() {
    super("A trigger activation needs a plain chat session id");
    this.name = "TriggerSessionIdError";
  }
}

/** Thrown when a write would build on an activation file that fails the schema. */
export class TriggerFileInvalidError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super("The activation file for this chat is invalid; fix or remove it under .beebox/triggers/");
    this.name = "TriggerFileInvalidError";
    this.sessionId = sessionId;
  }
}

/** A session's store: the box and the chat session. */
export interface TriggerSession {
  boxRoot: string;
  sessionId: string;
}

export function triggersDir(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "triggers");
}

export function activationFilePath({ boxRoot, sessionId }: TriggerSession): string {
  if (!SESSION_ID.test(sessionId)) throw new TriggerSessionIdError();
  return path.join(triggersDir(boxRoot), `${sessionId}.json`);
}

function lockPath({ boxRoot, sessionId }: TriggerSession): string {
  return path.join(triggersDir(boxRoot), `${sessionId}.lock`);
}

/** Run `fn` holding the session's trigger lock. Not re-entrant. */
export async function withTriggerLock<T>(who: TriggerSession, fn: () => Promise<T>): Promise<T> {
  await fsp.mkdir(triggersDir(who.boxRoot), { recursive: true });
  return withFileLock({ lockPath: lockPath(who), metadata: { purpose: "trigger activations", sessionId: who.sessionId }, waitMs: LOCK_WAIT_MS }, fn);
}

export type ActivationFileRead = { activations: Activation[]; invalid: false } | { activations: []; invalid: true };

/** The raw file, without expiry applied. A hand-edited file that fails the schema is reported, warned about once per read, and treated as empty. */
export async function readActivationFile(who: TriggerSession): Promise<ActivationFileRead> {
  const { sessionId } = who;
  let raw: string;
  try {
    raw = await fsp.readFile(activationFilePath(who), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { activations: [], invalid: false };
    throw e;
  }
  try {
    const parsed = fileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { activations: parsed.data.activations, invalid: false };
    console.warn(`[triggers] ignoring an invalid activation file for ${sessionId}: ${parsed.error.message}`);
  } catch (e) {
    console.warn(`[triggers] ignoring an unparseable activation file for ${sessionId}:`, e);
  }
  return { activations: [], invalid: true };
}

async function writeActivations(who: TriggerSession, activations: readonly Activation[]): Promise<void> {
  await writeFileAtomic(activationFilePath(who), { content: `${JSON.stringify({ activations }, null, 2)}\n` });
}

/**
 * Why an activation is expired at `now`: `"turns"` when it has seen its
 * limit of person turns, `"time"` when its deadline has passed, or null. A
 * terminal activation is never re-judged.
 */
export function expiryOf(activation: Pick<Activation, "expires" | "turnsSeen" | "deadline" | "state">, now: Date): null | "turns" | "time" {
  if (TERMINAL_STATES.includes(activation.state)) return null;
  if (activation.expires === "never") return null;
  if (activation.expires.turns !== undefined && activation.turnsSeen >= activation.expires.turns) return "turns";
  if (activation.deadline !== null && Date.parse(activation.deadline) <= now.getTime()) return "time";
  return null;
}

/** `activation` with `expiryOf` applied: the `expired` state with the reason in `error`, or unchanged. */
export function applyExpiry(activation: Activation, now: Date): Activation {
  const why = expiryOf(activation, now);
  if (why === null) return activation;
  return { ...activation, state: "expired", error: why === "turns" ? "reached its turn limit" : "reached its deadline" };
}

/** The session's activations, expiry applied at read, oldest first. */
export async function listActivations(who: TriggerSession, opts?: { now?: Date }): Promise<Activation[]> {
  const now = opts?.now ?? getBoxTime(who.boxRoot);
  return (await readActivationFile(who)).activations.map((a) => applyExpiry(a, now));
}

/** Every session with an activation file: `[sessionId, activations]`, expiry applied. For the runner's boot scan. */
export async function listAllActivations(boxRoot: string, opts?: { now?: Date }): Promise<Map<string, Activation[]>> {
  let names: string[];
  try {
    names = await fsp.readdir(triggersDir(boxRoot));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return new Map();
    throw e;
  }
  const out = new Map<string, Activation[]>();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const sessionId = name.slice(0, -".json".length);
    if (!SESSION_ID.test(sessionId)) continue;
    out.set(sessionId, await listActivations({ boxRoot, sessionId }, opts));
  }
  return out;
}

function deadlineFor(expires: Expires, armedAt: Date): string | null {
  if (expires === "never" || expires.minutes === undefined) return null;
  return new Date(armedAt.getTime() + expires.minutes * 60_000).toISOString();
}

export interface ArmOptions {
  sessionId: string;
  file: string;
  config: unknown;
  label: string;
  tick?: number | undefined;
  expires?: Expires | undefined;
  now?: Date | undefined;
}

/** Add an activation to the session. The expiry defaults to {@link DEFAULT_EXPIRES}. */
export async function armActivation(boxRoot: string, opts: ArmOptions): Promise<Activation> {
  const expires = expiresSchema.parse(opts.expires ?? DEFAULT_EXPIRES);
  const now = opts.now ?? getBoxTime(boxRoot);
  const who = { boxRoot, sessionId: opts.sessionId };
  return withTriggerLock(who, async () => {
    const seq = await lastActivitySeq(boxRoot);
    const activation: Activation = {
      id: randomBytes(4).toString("hex"),
      file: opts.file,
      config: opts.config,
      label: opts.label,
      ...(opts.tick === undefined ? {} : { tick: opts.tick }),
      armedAt: now.toISOString(),
      armedAtSeq: seq,
      deadline: deadlineFor(expires, now),
      lastEvalSeq: seq,
      turnsSeen: 0,
      fires: 0,
      expires,
      state: "armed",
      noticed: false,
    };
    const read = await readActivationFile(who);
    if (read.invalid) throw new TriggerFileInvalidError(who.sessionId);
    await writeActivations(who, [...read.activations, activation]);
    return activation;
  });
}

/**
 * Read the session's activations, let `fn` return the new list, write it.
 * Under the lock. `fn` receives the stored states with expiry applied, so a
 * caller never resurrects an activation whose deadline has passed.
 */
export async function updateActivations(who: TriggerSession, update: ActivationUpdate): Promise<Activation[]> {
  return withTriggerLock(who, () => updateActivationsLocked(who, update));
}

/** How to change a session's activations: `fn` returns the new list; `now` fixes the clock for expiry. */
export interface ActivationUpdate {
  fn: (activations: Activation[]) => Activation[] | Promise<Activation[]>;
  now?: Date | undefined;
  /** `false` when the caller emits `trigger-changed` itself (the runner); an expiry this write persists is then traced here but announced there. */
  announce?: boolean | undefined;
}

/**
 * `updateActivations` for a caller that already holds the session's trigger
 * lock. Whichever write first persists an expiry (a turn count, a deadline
 * timer, an admission that saw the clock) records it once in the trace and,
 * unless `announce` is false, emits `trigger-changed`.
 */
export async function updateActivationsLocked(who: TriggerSession, update: ActivationUpdate): Promise<Activation[]> {
  const now = update.now ?? getBoxTime(who.boxRoot);
  const read = await readActivationFile(who);
  if (read.invalid) throw new TriggerFileInvalidError(who.sessionId);
  const next = await update.fn(read.activations.map((a) => applyExpiry(a, now)));
  await writeActivations(who, next);
  const expired = next.filter((a) => a.state === "expired" && !TERMINAL_STATES.includes(read.activations.find((s) => s.id === a.id)?.state ?? "expired"));
  for (const a of expired) {
    const byTurns = a.expires !== "never" && a.expires.turns !== undefined && a.turnsSeen >= a.expires.turns;
    await appendTrace(who.boxRoot, { at: now.toISOString(), session: who.sessionId, activation: a.id, label: a.label, reason: byTurns ? "turns" : "time", entries: 0, records: [], outcome: "expired", error: a.error ?? "expired", ms: 0 });
  }
  if (expired.length > 0 && update.announce !== false) emitTriggerChanged(who.boxRoot, who.sessionId);
  return next;
}

/** Patch one activation by id; returns the patched record, or null when there is none. */
export async function patchActivation(
  who: TriggerSession & { id: string },
  patch: { fn: (activation: Activation) => Activation; now?: Date | undefined },
): Promise<Activation | null> {
  let patched: Activation | null = null;
  await updateActivations(who, {
    now: patch.now,
    fn: (activations) => activations.map((a) => {
      if (a.id !== who.id) return a;
      patched = patch.fn(a);
      return patched;
    }),
  });
  return patched;
}

/**
 * Disarm by id, label or all. Returns the activations that changed state.
 * One already terminal is left as it is (a done trigger is not "disarmed"),
 * except `delivery-failed`, which the agent clears this way.
 */
export async function disarmActivations(
  who: TriggerSession,
  which: ({ id: string } | { label: string } | { all: true }) & { now?: Date | undefined },
): Promise<Activation[]> {
  const changed: Activation[] = [];
  await updateActivations(who, {
    now: which.now,
    fn: (activations) => activations.map((a) => {
      const matches = "all" in which ? true : "id" in which ? a.id === which.id : a.label === which.label;
      if (!matches || (TERMINAL_STATES.includes(a.state) && a.state !== "delivery-failed")) return a;
      const { error: _error, ...rest } = a;
      const next: Activation = { ...rest, state: "disarmed" };
      changed.push(next);
      return next;
    }),
  });
  return changed;
}

/**
 * Count one person turn against every `armed` or `failed` activation and
 * mark those at their `turns` limit `expired`. Called once per person turn,
 * before the activity cursor is attempted. Returns whether anything changed
 * state, so the caller can emit `trigger-changed`. A session with no file
 * returns false without writing one.
 */
export async function countPersonTurn(who: TriggerSession, opts?: { now?: Date }): Promise<{ expired: Activation[] }> {
  const read = await readActivationFile(who);
  if (read.invalid || read.activations.length === 0) return { expired: [] };
  const now = opts?.now ?? getBoxTime(who.boxRoot);
  const expired: Activation[] = [];
  await updateActivations(who, {
    now,
    fn: (activations) => activations.map((a) => {
      if (a.state !== "armed" && a.state !== "failed") return a;
      const next = applyExpiry({ ...a, turnsSeen: a.turnsSeen + 1 }, now);
      if (next.state === "expired") expired.push(next);
      return next;
    }),
  });
  return { expired };
}

/** Remove the session's activation file, under its lock so a write in flight cannot recreate it; for chat deletion. */
export async function removeActivationFile(who: TriggerSession): Promise<void> {
  await withTriggerLock(who, () => fsp.rm(activationFilePath(who), { force: true }));
  await fsp.rm(lockPath(who), { force: true });
}

/** The `expires` in words: "20 turns or 2 hours", "never". */
export function describeExpires(expires: Expires): string {
  if (expires === "never") return "never";
  const parts: string[] = [];
  if (expires.turns !== undefined) parts.push(`${String(expires.turns)} turn${expires.turns === 1 ? "" : "s"}`);
  if (expires.minutes !== undefined) {
    parts.push(expires.minutes % 60 === 0
      ? `${String(expires.minutes / 60)} hour${expires.minutes === 60 ? "" : "s"}`
      : `${String(expires.minutes)} minute${expires.minutes === 1 ? "" : "s"}`);
  }
  return parts.join(" or ");
}
