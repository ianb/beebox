/**
 * `cb chat review` — the nightly pass that titles and summarizes chat sessions.
 *
 * `status` reports how many sessions have accumulated enough new material;
 * `run` reads their unread spans and writes title / `contains` /
 * `contains-evidence` back to each husk card.
 *
 * See docs/implemented-plans/chat-review.md.
 */

import { Command } from "commander";

import { requireBoxRoot } from "../../lib/paths.js";
import { getBoxTime } from "../../lib/time.js";
import {
  discoverSessions,
  QUIESCENCE_MS,
  REVIEW_CHAR_THRESHOLD,
  type DiscoveryResult,
} from "../../core/chat/review/discovery.js";
import { loadReviewState } from "../../core/chat/review/state.js";
import { createSdkChatReviewer } from "../../core/chat/review/reviewer.js";
import { LockHeldError, runChatReview, type RunSummary } from "../../core/chat/review/run.js";
import { getOwnerEmail } from "../../webapp/auth.js";

/** Default per-run cap on sessions reviewed; overflow waits for the next run. */
const DEFAULT_MAX_SESSIONS = 20;

async function discover(boxRoot: string): Promise<DiscoveryResult> {
  const state = await loadReviewState(boxRoot);
  return discoverSessions(boxRoot, {
    now: getBoxTime(boxRoot),
    quiescenceMs: QUIESCENCE_MS,
    state,
  });
}

function describeSkips(result: DiscoveryResult): string[] {
  const lines: string[] = [];
  if (result.deferredActive.length > 0) {
    lines.push(`  deferred (active within 30m): ${String(result.deferredActive.length)}`);
  }
  if (result.belowThreshold > 0) {
    lines.push(
      `  below the ${String(REVIEW_CHAR_THRESHOLD)}-char threshold: ${String(result.belowThreshold)}`,
    );
  }
  if (result.tooFewTurns > 0) lines.push(`  too few user turns: ${String(result.tooFewTurns)}`);
  if (result.missingTranscripts > 0) {
    lines.push(`  husks whose transcript is gone: ${String(result.missingTranscripts)}`);
  }
  return lines;
}

const statusCommand = new Command("status")
  .description("Report how many chat sessions have enough new material to review")
  .option("--check", "Exit 0 when sessions are ready, 1 when none (for procedure prechecks)")
  .action(async (options: { check?: boolean }) => {
    const boxRoot = await requireBoxRoot();
    const result = await discover(boxRoot);

    const count = result.qualified.length;
    console.log(`${String(count)} chat session${count === 1 ? "" : "s"} ready to review`);
    for (const line of describeSkips(result)) console.log(line);

    if (options.check && count === 0) process.exit(1);
  });

const runCommand = new Command("run")
  .description("Review sessions that have grown, writing title/contains/account to each husk")
  .option("--max-sessions <n>", "Per-run cap on sessions reviewed", String(DEFAULT_MAX_SESSIONS))
  .option("--dry-run", "List the sessions that would be reviewed, without calling a model")
  .action(async (options: { maxSessions: string; dryRun?: boolean }) => {
    const boxRoot = await requireBoxRoot();
    const maxSessions = Number.parseInt(options.maxSessions, 10);
    if (Number.isNaN(maxSessions) || maxSessions < 1) {
      console.error(`--max-sessions must be a positive integer, got "${options.maxSessions}"`);
      process.exit(1);
    }

    if (options.dryRun) {
      const result = await discover(boxRoot);
      const planned = result.qualified.slice(0, maxSessions);
      const overflow = result.qualified.length - planned.length;
      console.log(
        `would review ${String(planned.length)} of ${String(result.qualified.length)} qualified session(s)`,
      );
      for (const session of planned) {
        const kind = session.bootstrap === null ? "increment" : session.bootstrap;
        console.log(
          `  ${session.sessionId}  ${String(session.spanChars)} new chars (${kind})  ${session.huskPath}`,
        );
      }
      if (overflow > 0) console.log(`  (+${String(overflow)} beyond the per-run cap)`);
      for (const line of describeSkips(result)) console.log(line);
      return;
    }

    let summary: RunSummary;
    try {
      summary = await runChatReview(boxRoot, {
        reviewer: createSdkChatReviewer({ boxRoot }),
        maxSessions,
        now: getBoxTime(boxRoot),
        ownerEmail: getOwnerEmail(),
      });
    } catch (e) {
      if (e instanceof LockHeldError) {
        console.error(`another chat review is already running — ${e.message}`);
        process.exit(1);
      }
      throw e;
    }

    const parts = [`reviewed ${String(summary.reviewed)} session(s)`];
    // A quiet night still reports what it looked at — "nothing happened" and
    // "every transcript was missing" must not print the same thing.
    if (summary.deferredActive > 0) parts.push(`${String(summary.deferredActive)} still active`);
    if (summary.belowThreshold > 0) parts.push(`${String(summary.belowThreshold)} below threshold`);
    if (summary.missingTranscripts > 0) {
      parts.push(`${String(summary.missingTranscripts)} husk(s) with no transcript`);
    }
    if (summary.exhausted > 0) parts.push(`${String(summary.exhausted)} given up on`);
    if (summary.sessionErrors > 0) parts.push(`${String(summary.sessionErrors)} error(s)`);
    if (summary.bootstrapped > 0) parts.push(`${String(summary.bootstrapped)} read from the top`);
    if (summary.rewritten > 0) parts.push(`${String(summary.rewritten)} transcript(s) rewritten`);
    if (summary.alreadyApplied > 0) {
      parts.push(`${String(summary.alreadyApplied)} already applied`);
    }
    if (summary.reviewerFailures > 0) parts.push(`${String(summary.reviewerFailures)} failure(s)`);
    if (summary.overflow > 0) parts.push(`${String(summary.overflow)} deferred to the next run`);
    console.log(parts.join(", "));
    for (const rejection of summary.rejected) {
      console.log(`  leak scan dropped ${rejection}`);
    }
  });

export const chatReviewCommand = new Command("review")
  .description("Title and summarize chat sessions that have grown since the last pass")
  .addCommand(statusCommand)
  .addCommand(runCommand);
