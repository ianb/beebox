/**
 * `cb field-test` — the agent field-test tier's harness commands
 * (`docs/plans/agent-field-tests.md`). Track 1 ships `inject-email`; `run` and
 * `list` land with Track 2.
 */

import { Command } from "commander";
import chalk from "chalk";
import { errorMessage } from "../../lib/error-guards.js";
import { loadEmailFixture } from "../../field-test/email-fixture.js";
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

export const fieldTestCommand = new Command("field-test")
  .description("Agent field-test runs (persona operator against a real box)")
  .addCommand(injectEmailCommand);
