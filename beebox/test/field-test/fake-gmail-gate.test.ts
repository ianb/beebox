// # The `BBX_FAKE_GMAIL` gate
//
// Email intake runs in CLI subprocesses, so a field run hands the Gmail connector
// a mailbox on disk instead of an injected service: `BBX_FAKE_GMAIL=<state file>`.
// The gate that honors it is fail-closed.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initBox } from "../../src/core/box/structure/core.js";
import { createGmailConnector } from "../../src/connectors/gmail/connector.js";
import { runConnectors } from "../../src/cli/commands/wakeup/connectors.js";
import type { GmailMessage } from "../../src/services/google-gmail-types.js";
import { TEST_BOX_MARKER } from "../../src/field-test/run-box.js";
import {
  appendMessageToState,
  emptyFakeGmailState,
  loadFakeGmailState,
  saveFakeGmailState,
} from "../../src/field-test/fake-gmail-state.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const labels = [{ id: "INBOX", name: "INBOX", type: "system" }];

function message(opts: { id: string; subject: string }): GmailMessage {
  return {
    id: opts.id,
    threadId: `t-${opts.id}`,
    labelIds: ["INBOX"],
    internalDate: "1785596400000",
    snippet: `Snippet ${opts.id}`,
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Message-ID", value: `<${opts.id}@example.com>` },
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "box@example.com" },
        { name: "Subject", value: opts.subject },
      ],
      body: { data: Buffer.from(`Body ${opts.id}`).toString("base64url") },
    },
  };
}

/** A scratch directory for state files and fixtures, outside any box. */
async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bbx-fake-gmail-"));
}

/** Seed a rule that tracks anything in INBOX, so an arriving message shows up
 *  as cards rather than as a silently advanced cursor. */
const trackInbox = JSON.stringify({
  rules: [{
    name: "inbox",
    query: "label:INBOX",
    action: { type: "track", budget: { threads: 5, window: "7d" } },
  }],
});

// ## The gate refuses a box that is not a field-test box
//
// `BBX_FAKE_GMAIL` against a box with no `config/test-box` marker throws at sync.
// It never falls back to the real Gmail service, and never warns and continues —
// silently diverting a real box's mail is the failure this gate exists to
// prevent.
void test("BBXFAKEGMAIL against a box with no config/test-box marker throws at sync.", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_FAKE_GMAIL;
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L70
  const dir = await scratch();
  const statePath = join(dir, "gmail.json");
  await saveFakeGmailState(statePath, { ...emptyFakeGmailState(), labels });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", trackInbox);
  box.commitAll("initialize box");
  process.env.BBX_FAKE_GMAIL = statePath;

  // doctest:L79
  await t.checkThrows(async () => (await createGmailConnector(box.root).sync()), "FakeGmailNotPermittedError");

  // `bbx wakeup`'s connector loop absorbs sync failures so one flaky service cannot
  // stop a cycle — but this is a misconfiguration, not a failed sync, so it is a
  // `ConnectorFatalError` and the loop rethrows instead of printing a line and
  // carrying on into intake, the reactor and push.

  // doctest:L89
  await t.checkThrows(async () => (await runConnectors(box.root, { connector: "gmail" })), "FakeGmailNotPermittedError");

  // With the marker in place the same box syncs from the file. A first sync only
  // establishes the checkpoint and baselines the rule; the injected message then
  // arrives as cards, and nothing else does.

  // doctest:L98
  await box.seed(TEST_BOX_MARKER, "field-test box\n");
  box.commitAll("mark as a field-test box");

  // doctest:L101
  await t.checkText((await createGmailConnector(box.root).sync()).created.length, "0");

  // doctest:L104
  await saveFakeGmailState(statePath, appendMessageToState({
    state: await loadFakeGmailState(statePath),
    message: message({ id: "arrived", subject: "Arrived" }),
  }));
  const result = await createGmailConnector(box.root).sync();
  t.check(result.created.map((p) => p.split(".").slice(-2).join(".")).toSorted(), [
    "body.txt",
    "email-message.card",
    "email-thread.card",
  ]);

  // doctest:L112
  const messageCard = result.created.find((p) => p.endsWith(".email-message.card")) ?? "";
  const card = await readFile(join(box.root, messageCard), "utf-8");
  await t.checkText(card.includes("Arrived"), "true");
});

// ## An unset env var leaves the real path alone
//
// Without `BBX_FAKE_GMAIL` the connector behaves exactly as before: a box with no
// Google access and no `googleServices.gmail` opt-in reports a skip rather than
// reaching for a fake.
void test("Without BBXFAKEGMAIL the connector behaves exactly as before:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L130
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("initialize box");
  t.check(await createGmailConnector(box.root).sync(), {
    success: true,
    created: [],
    updated: [],
    skipped: {
      reason: "not-allowed",
      detail: "Enable it in box settings (`googleServices.gmail` in `_config/box.json`)",
    },
  });
});
