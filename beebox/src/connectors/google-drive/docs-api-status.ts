/**
 * The box's open Google Docs API problem, if any: Drive syncing Google Docs at
 * reduced fidelity (no revision tracking, no lossy-content report) for a reason
 * the boxholder can fix — the Docs API disabled on the Cloud project, or a
 * grant without `documents.readonly`.
 *
 * The condition is found inside a pull and read later by the `google-docs-api`
 * health check, the Google settings section, and the chat-start snapshot, so
 * it is stored: `_bookkeeping/connectors/google-docs-api.state.json`, written
 * only by the Drive connector at the end of a full pass. It lives in its own
 * file, outside the strict connector-activity record, so an older binary never
 * reads it. See docs/plans/drive-docs-api-health.md.
 *
 * There is no dismissal (boxholder decision, 2026-10-20). The problem clears
 * when the Docs API answers again, when a complete pass finds no Docs, or —
 * for every reader at once — when Drive is disabled or Google disconnected.
 */

import { z } from "zod";
import { isGoogleServiceAllowed } from "../../core/box/config.js";
import { readGoogleAuthStatus } from "../../google/auth-status.js";
import { errorMessage } from "../../shared/error-guards.js";
import { loadTransientState, transientStatePath, updateTransientState } from "../../transient-state.js";
import type { DocsApiFailure, DocsApiOutcome } from "./handlers/docs/api-failure.js";

const STATE_NAME = "google-docs-api";

const diagnosisSchema = z.strictObject({
  kind: z.enum(["service-disabled", "scope-insufficient"]),
  /** One sentence for the boxholder, with the count of Docs and the fix. */
  message: z.string(),
  /** Where to fix it, when there is one place (the Docs API enable page). */
  link: z.string().nullable(),
  /** Docs whose last pull on the pass that wrote this hit the failure. */
  docs: z.number().int().positive(),
  /** When this problem was first seen; kept while it continues. */
  since: z.iso.datetime(),
});

const fileSchema = z.strictObject({
  version: z.literal(1),
  diagnosis: diagnosisSchema.nullable(),
});

export type DocsApiDiagnosis = z.infer<typeof diagnosisSchema>;
type DocsApiStatusFile = z.infer<typeof fileSchema>;

const EMPTY_FILE: DocsApiStatusFile = { version: 1, diagnosis: null };

/** The stored file does not match its schema: a hand edit or a future version. Reported, never reset. */
export class DocsApiStatusInvalidError extends Error {
  constructor(filePath: string, detail: string) {
    super(`Google Docs API status at ${filePath} is invalid: ${detail}`);
    this.name = "DocsApiStatusInvalidError";
  }
}

function parseFile(boxRoot: string, raw: unknown): DocsApiStatusFile {
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DocsApiStatusInvalidError(transientStatePath(boxRoot, STATE_NAME), z.prettifyError(parsed.error));
  }
  return parsed.data;
}

type FixableFailure = DocsApiFailure & { kind: DocsApiDiagnosis["kind"] };

function isFixable(failure: DocsApiFailure): failure is FixableFailure {
  return failure.kind !== "other";
}

function describe(failure: FixableFailure, docs: number): string {
  const subject = docs === 1 ? "1 Google Doc is" : `${String(docs)} Google Docs are`;
  return `${subject} syncing without revision tracking or lossy-content details: ${failure.message}`;
}

/**
 * The diagnosis after one connector pass. Pure; every open/clear decision is
 * here.
 *
 * - A fixable failure on any pull opens (or continues) the problem. A
 *   disabled API is preferred over a missing scope: it is the one to fix first.
 * - Otherwise a pull that reached the Docs API clears it.
 * - Otherwise a complete pass with no Doc pulls clears it: no Docs are syncing,
 *   so none sync at reduced fidelity (the last Doc card was deleted).
 * - Otherwise — an incomplete pass, or only transient (`other`) failures —
 *   nothing is known, and the previous value stands.
 */
export function nextDocsApiDiagnosis(input: {
  previous: DocsApiDiagnosis | null;
  outcomes: readonly DocsApiOutcome[];
  /** No sync failures and no folder cap: every Doc card the box tracks was pulled. */
  passComplete: boolean;
  now: Date;
}): DocsApiDiagnosis | null {
  const { previous, outcomes, passComplete, now } = input;
  const fixable = outcomes.flatMap((outcome) => (!outcome.ok && isFixable(outcome.failure) ? [outcome.failure] : []));
  const first = fixable.find((failure) => failure.kind === "service-disabled") ?? fixable[0];
  if (first !== undefined) {
    return {
      kind: first.kind,
      message: describe(first, fixable.length),
      link: first.link,
      docs: fixable.length,
      since: previous?.since ?? now.toISOString(),
    };
  }
  if (outcomes.some((outcome) => outcome.ok)) return null;
  if (outcomes.length === 0 && passComplete) return null;
  return previous;
}

/** The stored diagnosis as written, with no suppression. Throws {@link DocsApiStatusInvalidError}. */
export async function loadDocsApiDiagnosis(boxRoot: string): Promise<DocsApiDiagnosis | null> {
  const raw = await loadTransientState<unknown>({ boxRoot, connectorName: STATE_NAME, defaultValue: EMPTY_FILE });
  return parseFile(boxRoot, raw).diagnosis;
}

/**
 * Bring the stored diagnosis up to date after a connector pass, or clear it
 * (`next` returning null) when the pass skipped. Never throws: the sync's
 * result is real either way, and a damaged file is already reported by the
 * health check.
 */
export async function recordDocsApiDiagnosis(
  boxRoot: string,
  next: (previous: DocsApiDiagnosis | null) => DocsApiDiagnosis | null,
): Promise<void> {
  try {
    await updateTransientState<unknown>({
      boxRoot,
      connectorName: STATE_NAME,
      defaultValue: EMPTY_FILE,
      update: (raw): DocsApiStatusFile => ({ version: 1, diagnosis: next(parseFile(boxRoot, raw).diagnosis) }),
    });
  } catch (e) {
    console.error(`[google-drive] could not record the Docs API status for ${boxRoot}: ${errorMessage(e)}`);
  }
}

/**
 * The open problem as the boxholder should see it: null while Drive is not
 * enabled for this box, Google is not connected, or the grant needs
 * reauthorizing (the `google-auth` check covers that, and Drive is paused).
 * Those states end Drive syncing at once, before any pass could clear the file.
 * Throws {@link DocsApiStatusInvalidError} for a damaged file.
 */
export async function readDocsApiDiagnosis(boxRoot: string): Promise<DocsApiDiagnosis | null> {
  if (!(await isGoogleServiceAllowed(boxRoot, "drive"))) return null;
  const auth = await readGoogleAuthStatus(boxRoot);
  if (!auth.connected || auth.needsReauthSince !== null) return null;
  return loadDocsApiDiagnosis(boxRoot);
}
