// # Which commands a bbx run loads, from its argv
//
// `selectVerb` reads the argv after the legacy handoff rewrite and names the one
// command module the run needs. Whatever it cannot place with certainty loads
// every command, so help output and the unknown-command error stay unchanged
// (`src/cli/entry/select-verb.ts`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { selectVerb, surfaceKeys, verbRegistryKey } from "../../../src/cli/entry/select-verb.js";
import { SURFACE } from "../../../src/cli/entry/surface-data.js";

// `scheduler` is a split family, on both surfaces; `serve` is engine only.
const surfaces = { agent: new Set(["ls", "agentContext", "scheduler", "remind"]), engine: new Set(["serve", "scheduler"]) };

// A verb's key is its name in camelCase, the form layout rule 4 gives a
// hyphenated module file.
void test("A verb's registry key is its name in camelCase", async (t) => {
  t.check(["ls", "agent-context", "migrate-view-links"].map(verbRegistryKey), ["ls", "agentContext", "migrateViewLinks"]);
});

// The cases, each argv as typed after `bbx`.
void test("Each argv selects one verb, every command, or none", async (t) => {
  const cases: string[][] = [
    ["ls", "_content"],
    ["agent-context", "--json"],
    ["remind", "--help"],
    ["engine", "serve", "/box"],
    ["scheduler", "status"],
    ["--version"],
    ["-V"],
    [],
    ["--help"],
    ["help", "ls"],
    ["engine"],
    ["engine", "--help"],
    ["--box", "/x", "ls"],
    ["lss"],
    ["engine", "nonesuch"],
    ["serve"],
    ["engine", "ls"],
    ["engine", "scheduler", "start"],
  ];
  t.check(cases.map((args) => [args.join(" "), selectVerb(args, surfaces)]), [
    ["ls _content", { kind: "verb", key: "ls" }],
    ["agent-context --json", { kind: "verb", key: "agentContext" }],
    ["remind --help", { kind: "verb", key: "remind" }],
    ["engine serve /box", { kind: "verb", key: "serve" }],
    ["scheduler status", { kind: "verb", key: "scheduler" }],
    ["--version", { kind: "none" }],
    ["-V", { kind: "none" }],
    ["", { kind: "all" }],
    ["--help", { kind: "all" }],
    ["help ls", { kind: "all" }],
    ["engine", { kind: "all" }],
    ["engine --help", { kind: "all" }],
    ["--box /x ls", { kind: "all" }],
    ["lss", { kind: "all" }],
    ["engine nonesuch", { kind: "all" }],
    ["serve", { kind: "all" }],
    ["engine ls", { kind: "all" }],
    ["engine scheduler start", { kind: "verb", key: "scheduler" }],
  ]);
});

// With the real surface table: `pub` is an agent verb only, and `serve` an
// engine verb only. A verb on the wrong surface loads everything, so Commander
// reports the unknown command (exit 1) as the full program always has.
void test("The real surface table puts each verb on its own surface", async (t) => {
  const real = surfaceKeys(SURFACE);
  t.check([selectVerb(["engine", "pub", "status"], real), selectVerb(["pub", "status"], real), selectVerb(["serve"], real)], [
    { kind: "all" },
    { kind: "verb", key: "pub" },
    { kind: "all" },
  ]);
});
