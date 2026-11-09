// # Command shorthand (`command-shorthand.ts`)
//
// An activity line with nothing plainer to say names its command by the first
// words: program and subcommands, up to three, stopping at a flag, path, or
// quoted value. Joined commands add a count; `cd` and `VAR=x` set up the real
// command and are skipped; a pipeline shows its first stage.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { commandShorthand } from "../../../src/components/chat/ChatMessages/command-shorthand.js";

void test("Command shorthand keeps the first command's leading words and counts the rest", async (t) => {
  t.check(
    [
      "bbx view check",
      "bbx view check --json home",
      "git status --short && git branch --show-current",
      "cd _content && bbx search 'lease terms'; echo done",
      "FOO=1 BAR=2 ./bin/tool run fast now later",
      "rg -n 'a && b' src | head -5",
      "sed -n '1,20p' notes.md",
      "cat notes.md",
      "echo \"x; y\" && ls",
      "cd /tmp",
      "'quoted' arg",
      "$(which bbx) status",
      "FOO=$(printf a && printf b) bbx view check",
      "",
    ].map(commandShorthand),
    [
      { head: "bbx view check", more: 0 },
      { head: "bbx view check", more: 0 },
      { head: "git status", more: 1 },
      { head: "bbx search", more: 1 },
      { head: "tool run fast", more: 0 },
      { head: "rg", more: 0 },
      { head: "sed", more: 0 },
      { head: "cat", more: 0 },
      { head: "echo", more: 1 },
      { head: "cd", more: 0 },
      null,
      null,
      // Command substitution could hide a separator; generic label.
      null,
      null,
    ],
  );
});
