/**
 * cb retro - Retrospective over a box's chat sessions.
 *
 * Mines what the boxholder implicitly taught the agent (corrections,
 * preferences, register, recurring asks) and feeds the integration step
 * that updates personality/guide cards under the evidence model. See
 * `docs/implemented-plans/box-retrospectives.md`.
 *
 * `status` reports how many sessions are ready; `scan` runs the walker
 * (and, with the observer, records observations and the run report).
 */

import { Command } from "commander";

import { requireBoxRoot } from "../../lib/paths.js";
import {
  discoverSessions,
  QUIESCENCE_MS,
  type DiscoveryResult,
} from "../../core/retro/discovery.js";
import { createSdkRetroObserver } from "../../core/retro/observer.js";
import { runRetroScan } from "../../core/retro/scan.js";
import { loadRetroState } from "../../core/retro/state.js";

/** Default per-run cap on sessions observed; overflow waits for the next run. */
const DEFAULT_MAX_SESSIONS = 20;

async function discover(boxRoot: string): Promise<DiscoveryResult> {
  const state = await loadRetroState(boxRoot);
  return discoverSessions(boxRoot, {
    now: new Date(),
    quiescenceMs: QUIESCENCE_MS,
    state,
  });
}

function describeSkips(result: DiscoveryResult): string[] {
  const lines: string[] = [];
  if (result.deferredActive.length > 0) {
    lines.push(`  deferred (active within 30m): ${result.deferredActive.length}`);
  }
  if (result.alreadyProcessed > 0 || result.nonChat > 0) {
    lines.push(
      `  skipped: ${result.alreadyProcessed} already processed, ${result.nonChat} non-chat`
    );
  }
  if (result.missingTranscripts > 0) {
    lines.push(`  missing transcripts: ${result.missingTranscripts}`);
  }
  return lines;
}

const statusCommand = new Command("status")
  .description("Report how many chat sessions are ready for retrospective observation")
  .option("--check", "Exit 0 when sessions are ready, 1 when none (for procedure prechecks)")
  .action(async (options: { check?: boolean }) => {
    const boxRoot = await requireBoxRoot();
    const result = await discover(boxRoot);

    const count = result.qualified.length;
    const plural = count === 1 ? "" : "s";
    console.log(`${count} chat session${plural} ready to scan`);
    for (const line of describeSkips(result)) console.log(line);

    if (options.check && count === 0) process.exit(1);
  });

const scanCommand = new Command("scan")
  .description("Observe new chat sessions and record what the boxholder taught")
  .option("--max-sessions <n>", "Per-run cap on sessions observed", String(DEFAULT_MAX_SESSIONS))
  .option("--dry-run", "List the sessions that would be observed, without observing")
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
        `would observe ${planned.length} of ${result.qualified.length} qualified session(s)`
      );
      for (const session of planned) {
        const thread = session.threadRef ? `  ${session.threadRef}` : "";
        console.log(
          `  ${session.sessionId}  ${session.mtime.toISOString()}  ${session.userMessages} user message(s)${thread}`
        );
      }
      if (overflow > 0) console.log(`  (+${overflow} beyond the per-run cap)`);
      for (const line of describeSkips(result)) console.log(line);
      return;
    }

    const observer = createSdkRetroObserver({ boxRoot });
    const summary = await runRetroScan(boxRoot, {
      observer,
      maxSessions,
      now: new Date(),
    });

    if (summary.reportPath === null) {
      console.log(`run ${summary.runId}: no sessions ready to observe`);
      return;
    }
    const parts = [
      `observed ${summary.observed} session(s)`,
      `${summary.observations} observation(s)`,
    ];
    if (summary.duplicatesSkipped > 0) parts.push(`${summary.duplicatesSkipped} duplicate(s) skipped`);
    if (summary.observerFailures > 0) parts.push(`${summary.observerFailures} failure(s)`);
    console.log(`run ${summary.runId}: ${parts.join(", ")}`);
    console.log(`report: ${summary.reportPath}`);
  });

export const retroCommand = new Command("retro")
  .description("Retrospective: mine chat sessions for what the boxholder taught the agent")
  .addCommand(statusCommand)
  .addCommand(scanCommand);
