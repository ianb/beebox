// # commands: the parseCommandArgs boundary rejects wrong-typed args loudly
//
// Every command validates its untyped `args` bag through `parseCommandArgs`
// (`command-runner.ts`) — the dispatch boundary. A wrong-typed field is a
// `CommandArgsError`, surfaced by `runCommand` as a clean `{ success: false }`
// result naming the field — never silently dropped, never a stack trace.
// Presence checks stay with the command (friendlier error text), so a missing
// field gets the command's own message, not a schema failure.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { unordered } from "@ianbicking/tap-check/check";
import { runCommand, createCollectorContext, getCommand, listCommands } from "../../src/core/command-runner.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// ## A lookup loads every command with no other import
//
// `getCommand`/`listCommands` read `commands.ts`'s registry directly, and
// `command-runner.ts` imports that registry at its own load — so importing a
// lookup above (with no side-effect `import "../../src/core/commands.js"`
// alongside it) is sufficient to have every command registered:
void test("getCommand/listCommands read commands.ts's registry directly, and command-run...", async (t) => {
  t.check(getCommand("search")?.name, "search");

  t.check(listCommands().map((c) => c.name), unordered([
    "create",
    "connector-sync",
    "answer",
    "dismiss",
    "question-decide",
    "question-reraise",
    "trash",
    "move",
    "procedure-run",
    "procedure-resume",
    "procedure-list",
    "procedure-gc",
    "procedure-status",
    "scan-import",
    "pdf-reanalyze",
    "upload",
    "attachments",
    "ls",
    "search",
    "wakeup",
    "intake",
    "triage",
    "handle",
  ]));
});

// ## Wrong-typed fields fail loudly, naming the field
void test("Wrong-typed fields fail loudly, naming the field", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const badLimit = await runCommand({
    name: "search",
    args: { query: "dentist", limit: "5" },
    ctx: createCollectorContext(box.root).ctx,
  });
  t.check(badLimit, { success: false, error: "invalid command arguments: limit: Invalid input: expected number, received string" });

  // ## Enum fields enumerate their valid values in the error

  const badMode = await runCommand({
    name: "search",
    args: { query: "dentist", mode: "fuzzy" },
    ctx: createCollectorContext(box.root).ctx,
  });
  t.check(badMode, { success: false, error: "invalid command arguments: mode: Invalid option: expected one of \"text\"|\"hybrid\"" });

  // ## Presence checks keep the command's own friendlier error

  const noQuery = await runCommand({
    name: "search",
    args: {},
    ctx: createCollectorContext(box.root).ctx,
  });
  t.check(noQuery, { success: false, error: "a search query is required — e.g. bbx search \"dentist appointment\"" });
});
