/**
 * `cb field-test` — the agent field-test tier's harness commands
 * (`docs/plans/agent-field-tests.md`): `run` a scenario, `list` the corpus, and
 * `inject-email` for driving a fake mailbox by hand.
 */

import * as path from "node:path";
import { readdir } from "node:fs/promises";
import { Command } from "commander";
import chalk from "chalk";
import { errorMessage } from "../../lib/error-guards.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { loadEmailFixture } from "../../field-test/email-fixture.js";
import { fieldScenarioDir, loadFieldScenario } from "../../field-test/scenario.js";
import { runFieldScenario, DEFAULT_RUNS_ROOT } from "../../field-test/run.js";
import { loadRunResults } from "../../field-test/results.js";
import { writeFieldReport, REPORT_FILENAME } from "../../field-test/report.js";
import { FAKE_GMAIL_ENV } from "../../field-test/fake-gmail-gate.js";
import {
  appendMessageToState,
  emptyFakeGmailState,
  loadFakeGmailState,
  saveFakeGmailState,
  type FakeGmailState,
} from "../../field-test/fake-gmail-state.js";
import { fileExists } from "../../lib/file-exists.js";

const FIXTURE_HELP = `A fixture is a YAML file (a scenario keeps them in emails/<name>.yaml):

  id: dentist-reminder          # optional; defaults to the filename stem
  threadId: t-dentist           # optional; defaults to t-<id>
  from: Bright Smiles Dental <appointments@example.com>
  to: boxholder@example.com
  cc: partner@example.com       # optional
  subject: Your appointment on Thursday
  date: 2026-03-02T09:00:00Z    # optional; defaults to the box clock (CB_TIME)
  labelIds: [INBOX]             # optional; defaults to [INBOX]
  body: |
    Multi-line plain text.
  attachments:                  # optional
    - filename: flyer.pdf
      mimeType: application/pdf
      path: ../assets/flyer.pdf # relative to the fixture; or inline base64 as \`data:\`

The message is appended to the fake-Gmail state file along with a messagesAdded
history record at a fresh checkpoint, so the next \`cb wakeup --connector gmail\`
sees exactly one new message.`;

async function readOrCreateState(statePath: string): Promise<FakeGmailState> {
  // A run's first injection may precede any state file — an absent file means
  // an empty mailbox, which is the only "missing" case that is not an error.
  if (await fileExists(statePath)) return loadFakeGmailState(statePath);
  return emptyFakeGmailState();
}

const injectEmailCommand = new Command("inject-email")
  .description("Append an email fixture to a fake-Gmail state file")
  .argument("<fixture>", "Path to an email fixture YAML file")
  .option("--state <path>", `State file to append to (default: $${FAKE_GMAIL_ENV})`)
  .addHelpText("after", `\n${FIXTURE_HELP}`)
  .action(async (fixture: string, options: { state?: string }) => {
    // TODO(env-migration): harness var, still a direct read (see lib/env.ts).
    const statePath = options.state ?? process.env[FAKE_GMAIL_ENV];
    if (!statePath) {
      console.error(
        chalk.red(`No state file: pass --state <path> or set ${FAKE_GMAIL_ENV}.`),
      );
      process.exit(1);
    }
    try {
      const loaded = await loadEmailFixture(fixture);
      const state = appendMessageToState({
        state: await readOrCreateState(statePath),
        message: loaded.message,
        attachments: loaded.attachments,
      });
      await saveFakeGmailState(statePath, state);
      console.log(
        `Injected ${loaded.message.id} into ${statePath} (historyId ${String(state.historyId)}).`,
      );
    } catch (error) {
      console.error(chalk.red(errorMessage(error)));
      process.exit(1);
    }
  });

/** A scenario argument is either a corpus name (`onboarding-first-days`) or a
 *  path to a scenario directory — a path is what a one-off or an in-progress
 *  scenario looks like before it joins the corpus. */
function resolveScenarioArgument(scenario: string): string {
  if (scenario.includes(path.sep) || scenario.startsWith(".")) return path.resolve(scenario);
  return fieldScenarioDir(scenario);
}

const listCommand = new Command("list")
  .description("List the checked-in field-test scenarios")
  .action(async () => {
    const corpusDir = path.join(PACKAGE_ROOT, "field-tests");
    const entries = (await readdir(corpusDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
    for (const name of entries) {
      try {
        const scenario = await loadFieldScenario(path.join(corpusDir, name));
        const items = `${String(scenario.checklist.length)} item(s)`;
        console.log(`${chalk.bold(scenario.name)}  ${chalk.dim(items)}\n  ${scenario.description.trim()}`);
      } catch (error) {
        // A scenario that no longer loads is exactly what `list` should shout
        // about: the alternative is discovering it when a run starts.
        console.log(`${chalk.bold(name)}  ${chalk.red("does not load")}\n  ${errorMessage(error)}`);
      }
    }
  });

const runCommand = new Command("run")
  .description("Run a field-test scenario end to end (real operator, real box, real browser)")
  .argument("<scenario>", "Scenario name from field-tests/, or a path to a scenario directory")
  .option("--runs-root <dir>", `Where the run directory is created (default: ${DEFAULT_RUNS_ROOT})`)
  .action(async (scenario: string, options: { runsRoot?: string }) => {
    try {
      const result = await runFieldScenario({
        scenarioDir: resolveScenarioArgument(scenario),
        runsRoot: options.runsRoot,
      });
      const failedChecks = result.items.flatMap((item) => item.checks.filter((c) => !c.passed));
      console.log("");
      for (const item of result.items) {
        const checks = `${String(item.checks.filter((c) => c.passed).length)}/${String(item.checks.length)} checks`;
        console.log(`  ${item.id}: ${item.debrief?.outcome ?? "no debrief"} — ${checks}`);
      }
      if (result.aborted) {
        console.error(chalk.red(`Run aborted at ${result.aborted.itemId ?? "(setup)"}: ${result.aborted.reason}`));
        process.exit(1);
      }
      // A failing hard assert is the tier's whole point; exit non-zero so an
      // unattended run cannot be mistaken for a clean one.
      if (failedChecks.length > 0) process.exit(1);
    } catch (error) {
      console.error(chalk.red(errorMessage(error)));
      process.exit(1);
    }
  });

const reportCommand = new Command("report")
  .description(`Regenerate ${REPORT_FILENAME} from a run's results.json`)
  .argument("<run-dir>", "Run directory (contains results.json)")
  .action(async (runDir: string) => {
    try {
      const resolvedDir = path.resolve(runDir);
      const loaded = await loadRunResults(resolvedDir);
      // Write to the directory the caller pointed at, not `results.json`'s own
      // stored `runDir`: a run directory that was moved or copied since it ran
      // still has to write its report where it now lives.
      const result = { ...loaded, runDir: resolvedDir };
      await writeFieldReport(result);
      console.log(`Wrote ${path.join(result.runDir, REPORT_FILENAME)}`);
    } catch (error) {
      console.error(chalk.red(errorMessage(error)));
      process.exit(1);
    }
  });

export const fieldTestCommand = new Command("field-test")
  .description("Agent field-test runs (persona operator against a real box)")
  .addCommand(runCommand)
  .addCommand(listCommand)
  .addCommand(injectEmailCommand)
  .addCommand(reportCommand);
