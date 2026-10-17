// Tests for how the finish preflight classifies Apple code (ios-app/, mac-app/,
// apple-shared/) and the check it names.
//   node --import tsx --test bin/finish-preflight-apple.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { groupPaths, verificationCommands } from "./finish-preflight-lib.js";

const PACKAGES = new Set(["beebox", "site"]);
const NO_SKIP = { value: false, reason: "the merge of main brought code in" };
const allScripts = (): ((pkg: string, script: string) => boolean) => () => true;

test("apple code is one group checked by bin/apple-test with the changed paths", () => {
  const paths = [
    "ios-app/BeeBox/A.swift",
    "mac-app/Package.swift",
    "apple-shared/Sources/X.swift",
  ];
  const grouped = groupPaths(paths, PACKAGES);
  assert.deepEqual(grouped.unknown, []);
  assert.deepEqual(grouped.groups["(apple)"], paths);
  const commands = verificationCommands({
    paths,
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  const apple = commands.find((command) => command.kind === "apple");
  assert.equal(commands.filter((command) => command.kind === "apple").length, 1);
  assert.deepEqual(apple?.argv, ["bin/apple-test", "--changed", ...paths]);
  assert.equal(apple?.skip, undefined);
});

test("a docs-only .md under ios-app follows the docs-only rule", () => {
  const docsOnly = verificationCommands({
    paths: ["ios-app/README.md"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  }).find((command) => command.kind === "apple");
  assert.equal(docsOnly?.skip, "docs-only diff");

  const mixed = verificationCommands({
    paths: ["ios-app/README.md", "mac-app/Sources/A.swift"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  }).find((command) => command.kind === "apple");
  assert.deepEqual(mixed?.argv, [
    "bin/apple-test",
    "--changed",
    "mac-app/Sources/A.swift",
  ]);
  assert.equal(mixed?.skip, undefined);
});

test("no apple path, no apple check", () => {
  const commands = verificationCommands({
    paths: ["bin/x.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.equal(
    commands.some((command) => command.kind === "apple"),
    false,
  );
});
