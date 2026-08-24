/**
 * Step 4 of `cb wakeup`: initialize connectors, resolve the active
 * (`--connector X`) scope, run each connector's `sync()`, and print a
 * per-connector + total summary.
 *
 * Kept next to wakeup.ts so the command's action handler stays a thin
 * sequence of steps rather than carrying the connector loop inline.
 */

import { createGmailConnector } from "../../connectors/gmail.js";
import { createGoogleCalendarConnector } from "../../connectors/google-calendar.js";
import { createTelegramConnector } from "../../connectors/telegram.js";
import { createGoogleDriveConnector } from "../../connectors/google-drive.js";
import { createPublishSubmissionsConnector } from "../../connectors/publish-submissions.js";
import {
  ConnectorFatalError,
  getAllConnectors,
  type Connector,
  type ConnectorProcedureTrigger,
} from "../../connectors/index.js";
import { errorMessage } from "../../lib/error-guards.js";
import { createCliContext } from "../../core/commands/index.js";
import { runConnectorProcedureTriggers } from "../../core/commands/connector-procedure-triggers.js";

/**
 * Run the configured connectors and report results.
 *
 * Returns the connector that was scoped to via `--connector X` (or
 * `undefined` for a full wakeup) so later steps can scope their inbox
 * scan and the reactor's `sourceFilter`.
 */
export async function runConnectors(
  boxRoot: string,
  options: {
    connector?: string | undefined;
    /** Explicit working set for deterministic orchestration tests. */
    connectors?: Connector[] | undefined;
    /** Procedure boundary injection; production uses the normal command runner. */
    runProcedureTriggers?: ((procedures: ConnectorProcedureTrigger[]) => Promise<number>) | undefined;
  },
): Promise<{ activeConnector: Connector | undefined; errorCount: number }> {
  let connectors = options.connectors;
  if (connectors === undefined) {
    createGmailConnector(boxRoot);
    createGoogleCalendarConnector(boxRoot);
    createTelegramConnector(boxRoot);
    createGoogleDriveConnector(boxRoot);
    createPublishSubmissionsConnector(boxRoot);
    connectors = getAllConnectors();
  }

  if (connectors.length === 0) {
    console.log("  No connectors configured.");
    return { activeConnector: undefined, errorCount: 0 };
  }

  // Filter by name if specified
  const toRun = options.connector
    ? connectors.filter((c) => c.name === options.connector)
    : connectors;

  if (toRun.length === 0) {
    console.error(`Connector not found: ${options.connector}`);
    process.exit(1);
  }

  const activeConnector = options.connector ? toRun[0] : undefined;

  let totalCreated = 0;
  let totalPushed = 0;
  let totalJobs = 0;
  let totalErrors = 0;
  const procedures: ConnectorProcedureTrigger[] = [];

  for (const connector of toRun) {
    connector.triggeredBy = "cb wakeup";
    console.log(`Syncing ${connector.name}...`);

    try {
      const result = await connector.sync();
      const counts = reportSyncResult(result);
      totalPushed += counts.pushed;
      totalCreated += counts.created;
      totalJobs += counts.jobs;
      totalErrors += counts.errors;
      procedures.push(...(result.procedures ?? []));
    } catch (err) {
      // A misconfiguration is not a sync failure: counting it would let the
      // wakeup continue into intake, the reactor and push having quietly
      // decided the box has no new mail. Abort the cycle instead.
      if (err instanceof ConnectorFatalError) throw err;
      console.error(`  Failed: ${errorMessage(err)}`);
      totalErrors++;
    }
  }

  const runProcedureTriggers = options.runProcedureTriggers
    ?? ((requested: ConnectorProcedureTrigger[]) => (
      runConnectorProcedureTriggers(createCliContext(boxRoot), requested)
    ));
  totalErrors += await runProcedureTriggers(procedures);

  const parts: string[] = [];
  if (totalPushed > 0) parts.push(`${totalPushed} pushed`);
  parts.push(`${totalCreated} created`);
  if (totalJobs > 0) parts.push(`${totalJobs} jobs`);
  parts.push(`${totalErrors} errors`);
  console.log(`\nTotal: ${parts.join(", ")}.`);

  return { activeConnector, errorCount: totalErrors };
}

/** The exit status applied after the rest of the wakeup cycle finishes. */
export function wakeupExitCodeForConnectorErrors(errorCount: number): 1 | undefined {
  return errorCount > 0 ? 1 : undefined;
}

type SyncResult = Awaited<ReturnType<Connector["sync"]>>;

/**
 * Print one connector's sync result and return the counts it
 * contributed, for the run's running totals.
 */
function reportSyncResult(
  result: SyncResult
): { pushed: number; created: number; jobs: number; errors: number } {
  let pushed = 0;
  let created = 0;
  let jobs = 0;
  let errors = 0;

  if (result.pushed && result.pushed.length > 0) {
    console.log(`  Pushed ${result.pushed.length} card(s):`);
    for (const card of result.pushed) {
      console.log(`    - ${card}`);
    }
    pushed = result.pushed.length;
  }

  if (result.created.length > 0) {
    console.log(`  Created ${result.created.length} card(s):`);
    for (const card of result.created) {
      console.log(`    - ${card}`);
    }
    created = result.created.length;
  }

  if (result.jobs && result.jobs.length > 0) {
    console.log(`  Jobs created: ${result.jobs.length}`);
    for (const job of result.jobs) {
      console.log(`    - ${job}`);
    }
    jobs = result.jobs.length;
  }

  if (result.updated.length > 0) {
    console.log(`  Updated ${result.updated.length} card(s)`);
  }

  if (result.error) {
    console.error(`  Error: ${result.error}`);
    errors = 1;
  } else if (
    result.created.length === 0 &&
    result.updated.length === 0 &&
    (!result.pushed || result.pushed.length === 0)
  ) {
    console.log("  No new items.");
  }

  return { pushed, created, jobs, errors };
}
