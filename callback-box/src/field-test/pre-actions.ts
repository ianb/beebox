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

export class FieldPreActionError extends Error {
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
  await runCb({
    args: ["wakeup", "--connector", "gmail", "--skip-push", "--skip-housekeeping"],
    packageRoot,
    env: { ...env, CB_FAKE_GMAIL: statePath },
    action: `inject-email ${fixture}`,
  });
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
  return to;
}
