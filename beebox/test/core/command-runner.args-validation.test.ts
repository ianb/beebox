// # commands: the parseCommandArgs boundary rejects wrong-typed args loudly
//
// Every command validates its untyped `args` bag through `parseCommandArgs`
// (`command-runner.ts`) — the dispatch boundary. A wrong-typed field is a
// `CommandArgsError`, surfaced by `runCommand` as a clean `{ success: false }`
// result naming the field — never silently dropped, never a stack trace.
// Presence checks stay with the command (friendlier error text), so a missing
// field gets the command's own message, not a schema failure.

import { test } from "tap";
import "agent-doctest/tap";
import { runCommand, createCollectorContext, getCommand, listCommands } from "../../src/core/command-runner.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// ## A lookup loads every command with no other import
//
// `getCommand`/`listCommands` read `commands.ts`'s registry directly, and
// `command-runner.ts` imports that registry at its own load — so importing a
// lookup above (with no side-effect `import "../../src/core/commands.js"`
// alongside it) is sufficient to have every command registered:
void test("getCommand/listCommands read commands.ts's registry directly, and command-run...", async (t) => {
  // doctest:L23
  t.check(getCommand("search")?.name, "search");

  // doctest:L26
  await t.checkText(listCommands().length > 15, "true");
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
  // doctest:L33
  const box = await makeTmpBox();
  const badLimit = await runCommand({
    name: "search",
    args: { query: "dentist", limit: "5" },
    ctx: createCollectorContext(box.root).ctx,
  });
  t.check(badLimit.success, false);

  // doctest:L42
  t.check(badLimit.error, "invalid command arguments: limit: Invalid input: expected number, received string");

  // ## Enum fields enumerate their valid values in the error

  // doctest:L49
  const badMode = await runCommand({
    name: "search",
    args: { query: "dentist", mode: "fuzzy" },
    ctx: createCollectorContext(box.root).ctx,
  });
  t.check(badMode.success, false);

  // doctest:L57
  t.check(badMode.error, "invalid command arguments: mode: Invalid option: expected one of \"text\"|\"hybrid\"");

  // ## Presence checks keep the command's own friendlier error

  // doctest:L64
  const noQuery = await runCommand({
    name: "search",
    args: {},
    ctx: createCollectorContext(box.root).ctx,
  });
  t.check(noQuery.error, "a search query is required — e.g. bbx search \"dentist appointment\"");
});
