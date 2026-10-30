// # `create-after-success` chains are contained to the box
//
// A scheduled script can declare `create-after-success: [{ path, args }]` — after
// a successful run, each entry is created from its card type's default template.
// That `path` is card-authored data (an agent writes scheduled-script cards), and
// this is a *write* path, so it goes through the shared ref algebra as a
// `write-target`: leading `/` means the box root, and a `..` that climbs out of
// the box resolves to nothing. An escaping entry is a logged error that skips only
// that entry — the rest of the chain still runs.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import { handleCreateAfterSuccess } from "../../../src/cli/tick-utils.js";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";

function makeScript(overrides: Partial<ParsedScheduledScript>): ParsedScheduledScript {
  return {
    cron: undefined, at: undefined, rrule: undefined, until: undefined,
    notBefore: undefined, onWakeup: false, once: false, enabled: true,
    action: { kind: "runs", command: "true" }, requestedBy: undefined,
    description: undefined, reason: undefined,
    createAfterSuccess: [], budget: undefined, lockGroup: undefined,
    timeoutMs: undefined, requires: undefined,
    ...overrides,
  };
}

/** Run the chain handler with console output captured instead of printed. */
async function runChainWith(box: TmpBox, { createAfterSuccess, quiet }: { createAfterSuccess: ParsedScheduledScript["createAfterSuccess"]; quiet: boolean }) {
  const errors: unknown[] = [];
  const logs: unknown[] = [];
  const realError = console.error;
  const realLog = console.log;
  console.error = (msg: unknown) => { errors.push(msg); };
  console.log = (msg: unknown) => { logs.push(msg); };
  try {
    await handleCreateAfterSuccess({
      boxRoot: box.root,
      scriptName: "nightly-notes",
      parsed: makeScript({ createAfterSuccess }),
      quiet,
    });
  } finally {
    console.error = realError;
    console.log = realLog;
  }
  return { errors, logs };
}

const runChain = (box: TmpBox, createAfterSuccess: ParsedScheduledScript["createAfterSuccess"]) => runChainWith(box, { createAfterSuccess, quiet: false });

// ## A `../` chain path is refused and writes nothing outside the box
//
// The escaping entry is skipped with an error naming the script and the path; the
// ordinary entry after it is still created.
void test("The escaping entry is skipped with an error naming the script and the path; t...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const { errors } = await runChain(box, [
    { path: "../outside/Evil.doc.card", args: { title: "Evil", body: "escaped" } },
    { path: "_content/notes/Daily.doc.card", args: { title: "Daily", body: "ok" } },
  ]);
  t.check(errors, [
    "  Chain: nightly-notes: path \"../outside/Evil.doc.card\" escapes the box — skipping",
  ]);

  // Nothing was written above the box root:

  t.check(existsSync(join(box.root, "outside")), false);

  // The normal entry created its card from the `doc` default template:

  t.check(await box.list("_content/notes"), "_content/notes/Daily.doc.card");

  await t.checkText(await box.read("_content/notes/Daily.doc.card"), "---\ntitle: Daily\n---\nok");

  // ## A leading `/` addresses the box root, not the OS root
  //
  // `/_content/kept/Weekly.doc.card` is the canonical box-root form, so it lands
  // inside the box like any other in-box path.

  const second = await runChain(box, [
    { path: "/_content/kept/Weekly.doc.card", args: { title: "Weekly", body: "weekly" } },
  ]);
  t.check(second.errors, []);

  t.check(await box.list("_content/kept"), "_content/kept/Weekly.doc.card");

  // Re-running the same chain is idempotent — an existing target is left alone:

  const third = await runChain(box, [
    { path: "/_content/kept/Weekly.doc.card", args: { title: "Weekly", body: "changed" } },
  ]);
  t.check(third.logs, [
    "  Chain: /_content/kept/Weekly.doc.card already exists, skipping",
  ]);
});

// ## A quiet chain prints nothing to stdout
//
// `bbx tick --json` keeps stdout to one JSON object, so creating a chained card
// and skipping an existing one must not log.
void test("A quiet chain prints nothing to stdout", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const chain = [{ path: "_content/notes/Daily.doc.card", args: { title: "Daily", body: "ok" } }];
  t.check((await runChainWith(box, { createAfterSuccess: chain, quiet: true })).logs, []);

  t.check((await runChainWith(box, { createAfterSuccess: chain, quiet: true })).logs, []);
});
