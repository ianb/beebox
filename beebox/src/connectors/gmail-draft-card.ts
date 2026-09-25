/**
 * Writing to `email-outbound` draft cards, and the draft failures that are the
 * card's own fault.
 *
 * A draft upload fails for one of two kinds of reason. Some are box-wide or
 * passing — an expired Google grant, a missing scope, a 5xx, a network error —
 * and every draft fails the same way until they clear, so the connector keeps
 * retrying and the connector-level "failing" alert covers them. Others are in
 * the card: a required field missing, an `in-reply-to` ref that resolves to
 * nothing, a message Gmail rejects as malformed. Those can never succeed until
 * someone edits the card, so retrying them every sync is retrying forever. The
 * connector stamps such a card with `gmail-draft-error` instead and stops; the
 * dashboard lists it, and deleting the field (after fixing the card) retries.
 *
 * The other kind is retried, but not forever. Its first failure stamps
 * `gmail-draft-failing-since`; a card still failing a week later is stranded
 * the same way, with the last error. A successful upload clears the stamp.
 */

import * as fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { renderFrontmatterBlock, splitCardContent } from "../cards/index.js";
import { CardIOError } from "../core/card-io.js";
import { errorMessage } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";
import { GmailDraftRejectedError } from "../services/google-gmail.js";

/** The frontmatter field that marks a draft the connector has stopped retrying. */
export const DRAFT_ERROR_FIELD = "gmail-draft-error";

/** When a retried failure started; cleared by a successful upload. */
export const DRAFT_FAILING_SINCE_FIELD = "gmail-draft-failing-since";

/** How long a draft is retried after its first failure before it is stranded. */
const DRAFT_RETRY_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

export class MissingFieldError extends Error {
  constructor(readonly field: string) {
    super(`Draft is missing required <${field}>`);
    this.name = "MissingFieldError";
  }
}

export class UnresolvedInReplyToRefError extends Error {
  constructor(readonly ref: string, readonly sourcePath: string) {
    super(
      `in-reply-to ref "${ref}" did not resolve to a readable email-message card with message-id and thread-id (looked at ${sourcePath})`,
    );
    this.name = "UnresolvedInReplyToRefError";
  }
}

class StampDraftCardError extends Error {
  constructor(readonly cardPath: string, detail: string) {
    super(`stampDraftCard: ${detail}`);
    this.name = "StampDraftCardError";
  }
}

/** A failure that only an edit to the card can fix, so retrying it is pointless. */
function isCardProblem(error: unknown): boolean {
  return (
    error instanceof MissingFieldError ||
    error instanceof UnresolvedInReplyToRefError ||
    error instanceof CardIOError ||
    error instanceof GmailDraftRejectedError
  );
}

/** Set (and optionally remove) frontmatter fields on a draft card, keeping the body. */
export async function stampDraftCard(opts: {
  cardPath: string;
  fields: Record<string, string>;
  remove?: readonly string[];
}): Promise<void> {
  const content = await fs.readFile(opts.cardPath, "utf-8");
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    throw new StampDraftCardError(opts.cardPath, `${opts.cardPath} has no frontmatter`);
  }
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (e) {
    throw new StampDraftCardError(opts.cardPath, `invalid YAML in ${opts.cardPath}: ${errorMessage(e)}`);
  }
  if (!isRecord(fm)) {
    throw new StampDraftCardError(opts.cardPath, `frontmatter in ${opts.cardPath} is not a mapping`);
  }
  const fields: Record<string, unknown> = { ...fm, ...opts.fields };
  for (const key of opts.remove ?? []) delete fields[key];
  await fs.writeFile(opts.cardPath, renderFrontmatterBlock(fields, split.body));
}

/**
 * What a failed upload does to the card: `stranded` (stamped
 * `gmail-draft-error`, no longer retried), `marked` (first retried failure,
 * stamped `gmail-draft-failing-since`), or `retrying` (unchanged).
 */
export async function recordDraftFailure(opts: {
  cardPath: string;
  error: unknown;
  now: Date;
  /** The card's current `gmail-draft-failing-since`, or null. */
  failingSince: string | null;
}): Promise<"stranded" | "marked" | "retrying"> {
  const { cardPath, error, now, failingSince } = opts;
  const message = errorMessage(error);
  const strand = async (reason: string): Promise<"stranded"> => {
    await stampDraftCard({ cardPath, fields: { [DRAFT_ERROR_FIELD]: reason }, remove: [DRAFT_FAILING_SINCE_FIELD] });
    return "stranded";
  };
  if (isCardProblem(error)) return strand(message);
  const started = failingSince === null ? Number.NaN : Date.parse(failingSince);
  // Missing, or hand-edited into something unreadable: the clock starts now.
  if (Number.isNaN(started)) {
    await stampDraftCard({ cardPath, fields: { [DRAFT_FAILING_SINCE_FIELD]: now.toISOString() } });
    return "marked";
  }
  if (now.getTime() - started >= DRAFT_RETRY_LIMIT_MS) {
    return strand(`Upload kept failing for 7 days, since ${failingSince}: ${message}`);
  }
  return "retrying";
}
