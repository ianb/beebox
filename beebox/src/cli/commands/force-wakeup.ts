/**
 * `bbx force-wakeup [--connector <name>]` — run a wakeup now, and say what it
 * did.
 *
 * This is the agent's verb. `bbx wakeup` is the engine's: it runs the cycle in
 * its own process, with the box service's credentials, and in an agent's shell
 * every Google connector would find no service and report nothing new — a
 * forced run that quietly disagreed with the scheduled one. So this verb never
 * runs the cycle in-process, under ANY spawn profile. It asks the box's own
 * server, which runs the same supervised `bbx wakeup` child the Sync button and
 * the scheduler run; with no reachable server it refuses and names the missing
 * piece (`docs/plans/agent-capability-delegation.md`).
 *
 * The output answers "did it sync?" per connector, because that is the question
 * the 2026-09-14 incident could not answer: a total of "0 errors" says nothing
 * about a service the box never contacted.
 */

import { Command } from "commander";
import type { inferRouterOutputs } from "@trpc/server";
import { boxClient } from "../lib/box-client.js";
import { reportRefusal, refusalFor, type VerbRefusal } from "../lib/credentialed-verb.js";
import type { AppRouter } from "../../webapp/trpc/router.js";
import type { WakeupConnectorOutcome } from "./wakeup-outcome.js";

type ForceResult = inferRouterOutputs<AppRouter>["wakeup"]["force"];

interface ForceWakeupOptions {
  connector?: string;
  json?: boolean;
}

/** One connector's line: what it did, or why it did nothing. */
function connectorLine(entry: WakeupConnectorOutcome): string {
  if (entry.error !== undefined) return `  ${entry.name}: error: ${entry.error}`;
  if (entry.skipped !== undefined) {
    return `  ${entry.name}: skipped (${entry.skipped.reason}): ${entry.skipped.detail}`;
  }
  const parts = [`${String(entry.created)} created`, `${String(entry.updated)} updated`];
  if (entry.pushed > 0) parts.push(`${String(entry.pushed)} pushed`);
  if (entry.jobs > 0) parts.push(`${String(entry.jobs)} jobs`);
  return `  ${entry.name}: ${parts.join(", ")}`;
}

/**
 * The reactor's own line. It is reported separately from the connectors
 * because it is the step a caller waiting on a job depends on, and it skips
 * for a benign reason (another reactor holds the lock) that must not read as
 * "nothing to do".
 */
function reactorLine(outcome: NonNullable<ForceResult["outcome"]>): string {
  if (outcome.reactorSkipped) return "reactor: skipped (another reactor running)";
  if (!outcome.reactorOk) return "reactor: failed";
  return `reactor: ok, ${String(outcome.jobsProcessed)} jobs processed, ${String(outcome.jobsRemaining)} remaining`;
}

/**
 * The whole run as lines for a person. Separated from printing so a test reads
 * what an operator sees.
 */
export function forceWakeupLines(result: ForceResult): string[] {
  const { outcome } = result;
  if (outcome === null) return [result.detail];
  if (outcome.skipped === "wakeup-running") return ["wakeup skipped: already running"];

  const lines: string[] = [];
  if (outcome.connectors.length === 0) lines.push("  no connectors ran");
  for (const entry of outcome.connectors) lines.push(connectorLine(entry));
  lines.push(reactorLine(outcome));
  if (result.detail !== "") lines.push(result.detail);
  return lines;
}

/**
 * Ask the server to run the cycle. Every failure — no box environment, a
 * refusal from the server, a dead socket — comes back as one relayable
 * refusal naming the party who can act on it.
 */
export async function forceWakeup(options: ForceWakeupOptions): Promise<
  { ok: true; value: ForceResult } | { ok: false; error: VerbRefusal }
> {
  const client = boxClient();
  if (!client.ok) {
    return {
      ok: false,
      error: { kind: "BOX_UNREACHABLE", message: client.error.message, fix: "machine" },
    };
  }
  try {
    const value = await client.value.wakeup.force.mutate(
      options.connector === undefined ? {} : { connector: options.connector },
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: refusalFor(error, { remote: true }) };
  }
}

export const forceWakeupCommand = new Command("force-wakeup")
  .description("Run a wakeup now on the box's server, and report what each connector did")
  .option("-c, --connector <name>", "Only run this connector (its exact name, e.g. google-drive)")
  .option("--json", "Print the result as one JSON object")
  .action(async (options: ForceWakeupOptions) => {
    const result = await forceWakeup(options);
    if (!result.ok) {
      reportRefusal(result.error, options.json === true);
      process.exit(1);
    }
    if (options.json === true) {
      console.log(JSON.stringify(result.value));
    } else {
      for (const line of forceWakeupLines(result.value)) console.log(line);
    }
    // A skipped cycle is not a failure: nothing ran, and nothing went wrong.
    if (!result.value.ok) process.exit(1);
  });
