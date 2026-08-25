/**
 * Checklist-item `pre` actions — the world changing between activities
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * Two exist, and they use DIFFERENT wakeups on purpose (they are not
 * interchangeable — `cb wakeup --connector <name>` skips on-wakeup scripts by
 * design, `src/cli/commands/wakeup.ts`):
 *
 *   inject-email  append the fixture to the run's fake-Gmail state, then a
 *                 CONNECTOR-SCOPED wakeup: sync + intake for that connector
 *                 only (`--connector` already skips on-wakeup scripts;
 *                 `--skip-housekeeping` drops the rest). Mail arriving must not
 *                 also run the day's maintenance — that is what a day advance
 *                 is for, and doing it here would make the two the same thing.
 *   advance-days  the day boundary: stop the server, move the box clock, run a
 *                 FULL wakeup plus `cb tick` (the due scheduled work a new day
 *                 brings), restart the server. Long-lived in-server state does
 *                 not survive a simulated day, by construction.
 *
 * Both are run only after the box is quiescent — the caller's ordering, not
 * enforced here, because quiescence is the loop's business.
 */

import * as path from "node:path";
import { execa } from "execa";
import { fileExists } from "../lib/file-exists.js";
import { cbBinary } from "./run-box.js";
import { loadEmailFixture } from "./email-fixture.js";
import {
  appendMessageToState,
  emptyFakeGmailState,
  loadFakeGmailState,
  saveFakeGmailState,
  type FakeGmailState,
} from "./fake-gmail-state.js";

/** Neither wakeup nor tick should ever take this long against a fresh box;
 *  past it, something is wedged and the run wants to hear about it. */
const WAKEUP_TIMEOUT_MS = 15 * 60_000;

class FieldPreActionError extends Error {
  constructor({ action, detail }: { action: string; detail: string }) {
    super(`Field-test pre action ${action} failed: ${detail}`);
    this.name = "FieldPreActionError";
  }
}

/** A run's first injection may precede any state file; an absent file is an
 *  empty mailbox, the one "missing" case that is not an error. */
async function readOrCreateState(statePath: string): Promise<FakeGmailState> {
  if (await fileExists(statePath)) return loadFakeGmailState(statePath);
  return emptyFakeGmailState();
}

/** Run a `cb` subcommand against the run's box, failing loudly with its output. */
async function runCb(opts: {
  args: string[];
  packageRoot: string;
  env: NodeJS.ProcessEnv;
  action: string;
}): Promise<string> {
  const result = await execa(cbBinary(), opts.args, {
    cwd: opts.packageRoot,
    env: { ...process.env, ...opts.env },
    reject: false,
    all: true,
    timeout: WAKEUP_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw new FieldPreActionError({
      action: opts.action,
      detail: `cb ${opts.args.join(" ")} exited ${String(result.exitCode)}:\n${String(result.all)}`,
    });
  }
  return String(result.all);
}

/**
 * Drain the box's pending jobs to completion. A single wakeup runs only ONE
 * reactor cycle (`maxCycles: 1`, `src/cli/commands/wakeup.ts`), so a job the
 * arrival spawns — or a low-priority follow-up a connector-scoped cycle skips
 * (`src/core/reactor/cycle.ts`: an all-low-priority cycle is skipped under
 * `skipLowPriority`) — survives it and sits in `box/jobs`. That lone leftover
 * keeps the box from ever going quiescent, so without this every email item and
 * every day boundary burns its full quiescence timeout (seen in the first
 * onboarding run: a `gmail.intake` job left by the dentist email was still
 * pending two items later). `cb reactor` processes every source, low priority
 * included, across several cycles — leaving the box the way a user finds it
 * "later", with the arrived work finished and nothing pending. It does not sync
 * (no `--sync`) or push, so it only drains what already exists.
 *
 * Two accepted properties of using the plain drain here: it processes ALL
 * pending jobs, not only the ones this pre action caused, and it runs finalize.
 * That matches "the box has caught up by the time the user looks" and no
 * current scenario relies on leaving a job pending across a pre action; a
 * scenario that ever wanted to observe pending work would need a narrower
 * drain. `cb reactor` also exits 0 when jobs still remain after its cycle
 * budget, so the loop re-checks quiescence after the pre actions
 * (`run-item.ts`) rather than trusting this call's exit code.
 */
async function drainJobs(opts: { packageRoot: string; env: NodeJS.ProcessEnv; action: string }): Promise<void> {
  await runCb({
    args: ["reactor", "--max-cycles", "5"],
    packageRoot: opts.packageRoot,
    env: opts.env,
    action: opts.action,
  });
}

export interface BaselineGmailSyncOptions {
  statePath: string;
  packageRoot: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Establish the mailbox before the run starts: write an empty state file and
 * run one connector-scoped wakeup against it.
 *
 * Not optional, and not merely tidy. A track rule's FIRST sync only sets the
 * history checkpoint and baselines the rule against what is already there — by
 * design, so connecting a real mailbox does not retro-import ten years of mail.
 * Without this the run's first injected message is part of that baseline and
 * silently never arrives, which reads in the report as "the box ignored my
 * email" rather than as a harness bug.
 */
export async function baselineGmailSync(options: BaselineGmailSyncOptions): Promise<void> {
  const { statePath, packageRoot, env } = options;
  await saveFakeGmailState(statePath, emptyFakeGmailState());
  await runCb({
    args: ["wakeup", "--connector", "gmail", "--skip-push", "--skip-housekeeping"],
    packageRoot,
    env: { ...env, CB_FAKE_GMAIL: statePath },
    action: "gmail baseline sync",
  });
}

export interface InjectEmailOptions {
  /** The scenario's `emails/` directory. */
  emailsDir: string;
  /** Fixture name without the `.yaml`. */
  fixture: string;
  /** The run's fake-Gmail state file (also the child's `CB_FAKE_GMAIL`). */
  statePath: string;
  /** The box's git/package root — the wakeup's working directory. */
  packageRoot: string;
  /** Env overlay for the wakeup child (`CB_TIME`, `CB_FAKE_GMAIL`). */
  env: NodeJS.ProcessEnv;
  /** The run's simulated clock — the arrival date for a fixture with no `date:`. */
  now: Date;
}

/**
 * Land one fixture in the box's mailbox and let the real pipeline see it:
 * append to the fake state (message + its `messagesAdded` history record, so
 * the next sync sees exactly one new message), then a connector-scoped wakeup.
 *
 * A fixture with no `date:` arrives at `now` — the run's SIMULATED clock, which
 * the harness process does not itself run on. Passing it explicitly is why the
 * harness needs no global `CB_TIME` of its own.
 */
export async function injectEmail(options: InjectEmailOptions): Promise<string> {
  const { emailsDir, fixture, statePath, packageRoot, env, now } = options;
  const loaded = await loadEmailFixture(path.join(emailsDir, `${fixture}.yaml`), { now });
  const state = appendMessageToState({
    state: await readOrCreateState(statePath),
    message: loaded.message,
    attachments: loaded.attachments,
  });
  await saveFakeGmailState(statePath, state);
  const wakeupEnv = { ...env, CB_FAKE_GMAIL: statePath };
  await runCb({
    args: ["wakeup", "--connector", "gmail", "--skip-push", "--skip-housekeeping"],
    packageRoot,
    env: wakeupEnv,
    action: `inject-email ${fixture}`,
  });
  // The connector-scoped wakeup syncs the mail and runs one reactor cycle; drain
  // the rest so the box is fully caught up before the operator looks at it.
  await drainJobs({ packageRoot, env: wakeupEnv, action: `inject-email ${fixture} drain` });
  return loaded.message.id;
}

export interface AdvanceDaysOptions {
  days: number;
  /** The box clock BEFORE the advance. */
  from: Date;
  packageRoot: string;
  /** Env overlay minus `CB_TIME`, which this function sets to the new day. */
  env: NodeJS.ProcessEnv;
}

/**
 * Move the box clock forward and run the day's maintenance at the new time.
 * The caller stops the server before calling and restarts it after — this
 * function deliberately does not own the server, so the same code path serves
 * both a scenario `advance-days` and any future manual day step.
 */
export async function advanceDays(options: AdvanceDaysOptions): Promise<Date> {
  const { days, from, packageRoot, env } = options;
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  const dayEnv = { ...env, CB_TIME: to.toISOString() };
  await runCb({ args: ["wakeup", "--skip-push"], packageRoot, env: dayEnv, action: `advance-days ${String(days)}` });
  await runCb({ args: ["tick"], packageRoot, env: dayEnv, action: `advance-days ${String(days)}` });
  // The wakeup and tick each run one reactor cycle; drain any jobs they queued
  // (a new day's scheduled work, mail refreshed overnight) so the next item does
  // not open on a box that is still churning and never goes quiescent.
  await drainJobs({ packageRoot, env: dayEnv, action: `advance-days ${String(days)} drain` });
  return to;
}
