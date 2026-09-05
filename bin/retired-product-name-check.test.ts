import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkAllowlist,
  findContentMatches,
  findPathMatches,
  formatInventory,
  validateAllowlist,
} from "./retired-product-name-check.js";

const callback = ["callback", "box"].join(" ");
const compact = ["callback", "box"].join("");
const kebab = ["callback", "box"].join("-");
const derivativeClerk = ["callback", "clerk"].join("-");
const snake = ["callback", "box"].join("_");
const cliToken = ["c", "b"].join("");
const dotState = [".", kebab].join("");
const configCli = [".config", cliToken].join("/");
const header = ["x", cliToken].join("-");
const session = [cliToken, "session"].join("_");
const firstDomain = [kebab, "zulipchat.com"].join(".");
const secondDomain = [cliToken, "ianbicking.org"].join(".");
const service = ["com", "callback"].join(".");
const scheduleService = [service, kebab, "schedules"].join("-");
const dottedService = [service, "scheduler"].join(".");
const deployService = ["callback", "deploy"].join("-");
const home = ["/home", "callback"].join("/");
const account = ["User=", "callback"].join("");
const cbPrefixClass = [cliToken, "prefix"].join("-");
const cbPrefix = ["CB", "SECRET_KEY"].join("_");
const callbackPrefix = ["CALLBACK", "TOKEN"].join("_");

test("matches the four branded text forms without matching generic callback prose", () => {
  const findings = findContentMatches("README.md", `${callback} ${compact} ${kebab} ${snake} callback`);
  assert.deepEqual(
    findings.map(({ occurrenceClass, line }) => [occurrenceClass, line]),
    [
      ["display-name", 1],
      ["compact-name", 1],
      ["kebab-name", 1],
      ["snake-name", 1],
    ],
  );
});

test("matches the derivative Clerk name", () => {
  assert.deepEqual(
    findContentMatches("README.md", derivativeClerk).map(({ occurrenceClass }) => occurrenceClass),
    ["derivative-clerk-name"],
  );
});

test("specialized operational forms win over broad token patterns", () => {
  const text = [
    `${dotState}/agent-guide.md`,
    `${configCli}/settings.json`,
    `${header}-request-id`,
    session,
    `${cbPrefix} ${callbackPrefix}`,
    `${firstDomain} ${secondDomain}`,
    `${scheduleService} ${dottedService} ${deployService} ${home}/boxes ${account}`,
    `run ${cliToken} init now`,
  ].join("\n");
  assert.deepEqual(
    findContentMatches("ops.md", text).map(({ occurrenceClass }) => occurrenceClass),
    [
      "dot-state-directory",
      "config-cli-directory",
      "header-prefix",
      "session-key",
      cbPrefixClass,
      "callback-prefix",
      "old-domain",
      "old-domain",
      "old-service",
      "old-service",
      "old-service",
      "old-home",
      "old-account",
      "standalone-cli-token",
    ],
  );
});

test("finds executable declarations and CLI-derived identifiers without matching callback parameters", () => {
  const text = `.name("${cliToken}") ${cliToken}Binary ${cliToken}Path\nconst ${cliToken} = () => {};`;
  assert.deepEqual(
    findContentMatches("cli.ts", text).map(({ occurrenceClass }) => occurrenceClass),
    ["standalone-cli-token", "standalone-cli-token", "standalone-cli-token"],
  );
});

test("finds commands after escaped newlines and validation commands", () => {
  assert.deepEqual(
    findContentMatches("fixture.ts", `console.error(\`\\n${cliToken} upgrade failed\`); \`${cliToken} validate file\``).map(
      (finding) => finding.occurrenceClass,
    ),
    ["standalone-cli-token", "standalone-cli-token"],
  );
});

test("finds newly invented CLI verbs without flagging callback grammar", () => {
  const findings = findContentMatches(
    "commands.md",
    `${cliToken} refresh-maps\n\`${cliToken} create\`\nrun ${cliToken} procedure\nfor (const ${cliToken} of callbacks)\nconst callback = (${cliToken}: string) => ${cliToken}`,
  );
  assert.deepEqual(findings.map(({ occurrenceClass }) => occurrenceClass), [
    "standalone-cli-token",
    "standalone-cli-token",
    "standalone-cli-token",
  ]);
});

test("reports path occurrences separately from content occurrences", () => {
  assert.deepEqual(
    findPathMatches([kebab, "src", "file.ts"].join("/")).map(({ occurrenceClass }) => occurrenceClass),
    ["path-kebab-name"],
  );
  assert.deepEqual(
    findPathMatches([".config", cliToken, "settings.json"].join("/")).map(({ occurrenceClass }) => occurrenceClass),
    ["path-config-cli-directory"],
  );
});

test("allowlist requires exact shape and detects stale or unlisted findings", () => {
  assert.deepEqual(validateAllowlist([]), []);
  assert.match(validateAllowlist([{ path: "x", occurrenceClass: "bad", expectedCount: 0, reason: "" }]).join("\n"), /invalid occurrenceClass/);
  assert.match(validateAllowlist([{ path: "docs/**", occurrenceClass: "display-name", expectedCount: 1, reason: "history" }]).join("\n"), /invalid path/);

  const findings = findContentMatches("history.md", compact);
  const allowed = checkAllowlist(findings, [{ path: "history.md", occurrenceClass: "compact-name", expectedCount: 1, reason: "history" }]);
  assert.deepEqual(allowed.violations, []);
  assert.deepEqual(allowed.staleEntries, []);

  const stale = checkAllowlist(findings, [{ path: "history.md", occurrenceClass: "compact-name", expectedCount: 2, reason: "history" }]);
  assert.equal(stale.violations.length, 0);
  assert.equal(stale.staleEntries.length, 1);

  const unlisted = checkAllowlist(findings, []);
  assert.equal(unlisted.violations.length, 1);
});

test("inventory is grouped deterministically", () => {
  const findings = [
    ...findContentMatches([kebab, "a.md"].join("/"), compact),
    ...findContentMatches("bin/tool.ts", `run ${cliToken} init`),
  ];
  const output = formatInventory(findings);
  assert.match(output, /By occurrence class:/);
  assert.match(output, /compact-name: 1/);
  assert.match(output, /standalone-cli-token: 1/);
  assert.match(output, /By top-level subtree:/);
  assert.equal(output.includes(`${kebab}: 1`), true);
  assert.match(output, /By extension:/);
  assert.match(output, /\.md: 1/);
  assert.match(output, /\.ts: 1/);
});
