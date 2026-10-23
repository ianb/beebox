// # Knowledge-audit behavior extraction
//
// Behavior extraction reads a bounded first page from the main agent transcript
// and every subagent transcript. Short reads stay quiet; if either transcript is
// actually longer than the page, the audit announces what it omitted.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { mkdir, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { PACKAGE_ROOT } from "../../../../../src/lib/package-root.js";
import { dirname, join } from "node:path";
import { MAX_SESSION_ENTRIES } from "../../../../../src/cli/lib/session.js";
import { getSessionLogPath } from "../../../../../src/core/chat/session/transcript-paths.js";
import { assertFixturePathInBox, ensureAuditPackageDocs } from "../../../../../src/dev/lib/test-runner/runner/fixtures.js";
import { extractBehavior, loadTests } from "../../../../../src/dev/lib/test-runner/runner/run-test.js";
import { runChecks } from "../../../../../src/dev/lib/audit-checks.js";
import { makeTmpBox } from "../../../../helpers/test-helpers.js";

function raw(uuid: string) {
  return {
    type: "user",
    uuid,
    timestamp: "2026-08-06T12:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "audit fixture" }] },
  };
}

async function writeLog(logPath: string, count: number): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const lines = Array.from({ length: count }, (_, i) => JSON.stringify(raw(`entry-${String(i)}`)));
  await writeFile(logPath, `${lines.join("\n")}\n`);
}

async function captureWarnings(action: () => Promise<void>): Promise<string[]> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    await action();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

void test("line 45", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await outside.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  const shortId = "short-audit";
  const canonicalBox = await realpath(box.root);
  await writeLog(getSessionLogPath(canonicalBox, shortId), 2);
  const shortWarnings = await captureWarnings(async () => { await extractBehavior(box.root, shortId); });
  t.check(shortWarnings, []);

  const longId = "long-audit";
  const mainLog = getSessionLogPath(canonicalBox, longId);
  await writeLog(mainLog, MAX_SESSION_ENTRIES + 1);
  const subagentLog = join(dirname(mainLog), longId, "subagents", "agent-a.jsonl");
  await writeLog(subagentLog, MAX_SESSION_ENTRIES + 1);

  const longWarnings = await captureWarnings(async () => { await extractBehavior(box.root, longId); });
  const pageSize = String(MAX_SESSION_ENTRIES);
  t.check(longWarnings, [
    str`[test-runner] Behavior extraction from ${any(String).endsWith("/long-audit.jsonl")} has ${String(MAX_SESSION_ENTRIES + 1)} entries; using the first ${pageSize}.`,
    str`[test-runner] Behavior extraction from ${any(String).endsWith("/long-audit/subagents/agent-a.jsonl")} has ${String(MAX_SESSION_ENTRIES + 1)} entries; using the first ${pageSize}.`,
  ]);

  // Claude stores transcripts under the physical directory. A symbolic-link cwd
  // must find that transcript, including its response, instead of the lexical path.
  // An absent transcript rejects collection before any audit checks can pass.

  const linkedCwd = box.path("linked-cwd");
  const physicalCwd = box.path("physical-cwd");
  await mkdir(physicalCwd);
  await symlink(physicalCwd, linkedCwd, "dir");
  const linkedLog = getSessionLogPath(await realpath(physicalCwd), "linked-audit");
  await mkdir(dirname(linkedLog), { recursive: true });
  await writeFile(linkedLog, JSON.stringify({
    type: "assistant", uuid: "linked-response", timestamp: "2026-08-06T12:00:00Z",
    message: { role: "assistant", content: [{ type: "text", text: "Captured response" }] },
  }) + "\n");
  t.check((await extractBehavior(linkedCwd, "linked-audit")).responseText, "Captured response");

  // An agent may delete its own cwd; the transcript is still found by the
  // physical path the runner resolved before the run.
  const deletedCwd = join(await realpath(box.root), "deleted-cwd");
  const deletedLog = getSessionLogPath(deletedCwd, "deleted-audit");
  await mkdir(dirname(deletedLog), { recursive: true });
  await writeFile(deletedLog, JSON.stringify({
    type: "assistant", uuid: "deleted-response", timestamp: "2026-08-06T12:00:00Z",
    message: { role: "assistant", content: [{ type: "text", text: "Response after rmdir" }] },
  }) + "\n");
  t.check((await extractBehavior(deletedCwd, "deleted-audit")).responseText, "Response after rmdir");

  await t.checkThrows(async () => (await extractBehavior(linkedCwd, "missing-audit")), "KnowledgeAuditTranscriptError: Claude knowledge-audit transcript is missing for session missing-audit: «*». No audit checks were evaluated.");

  const linkedPackage = box.path("node_modules/beebox");
  const outside = await makeTmpBox();
  await mkdir(dirname(linkedPackage), { recursive: true });
  await symlink(outside.root, linkedPackage, "dir");

  const linkedFixtureRejected = await assertFixturePathInBox(
    box.root,
    "node_modules/beebox/box-docs/README.md",
  ).then(() => "accepted", (error: Error) => error.message);
  t.check(linkedFixtureRejected, "Knowledge-audit fixture path crosses a symbolic link: node_modules/beebox/box-docs/README.md");

  const linkedPackageDocsRejected = await ensureAuditPackageDocs(box.root, {
    id: "photos",
    prompt: "photos",
    expected_level: "knows_about",
    watch_for: "photos docs",
    should_read: ["node_modules/beebox/box-docs/phone-photos.md"],
  }).then(() => "accepted", (error: Error) => error.message);
  t.check(linkedPackageDocsRejected, "Knowledge-audit fixture path crosses a symbolic link: node_modules/beebox/box-docs/README.md");

  const escapingFixtureRejected = await assertFixturePathInBox(box.root, "../outside.txt")
    .then(() => "accepted", (error: Error) => error.message);
  t.check(escapingFixtureRejected, "Knowledge-audit fixture path escapes the box: ../outside.txt");

  const photosAudit = (await loadTests("src/dev/knowledge-audits.yaml")).tests
    .find((audit) => audit.id === "iphone-photos-album-setup");
  const isForbiddenResponse = (response: string) => photosAudit !== undefined && runChecks(photosAudit, {
    behavior: { filesRead: [], searches: [], bashCommands: [], bashRawCommands: [], responseText: response, responseLength: response.length, context: null },
    newOrModifiedCards: new Map(),
  }).notMatchesChecks.some((check) => check.found);
  t.check(
    {
      refusesCommands: !isForbiddenResponse("I can't run commands on your Mac or handle the token."),
      spacedRefusal: !isForbiddenResponse("I can not run commands on your Mac."),
      explainsCommands: !isForbiddenResponse("I can explain the commands; you should run them locally."),
      willInstall: isForbiddenResponse("I'll install osxphotos for you."),
      curlyWillInstall: isForbiddenResponse("I’ll install osxphotos for you."),
      willMint: isForbiddenResponse("I will mint the token for you."),
      canDoSetup: isForbiddenResponse("I can do most of the setup for you."),
    },
    {
    refusesCommands: true,
    spacedRefusal: true,
    explainsCommands: true,
    willInstall: true,
    curlyWillInstall: true,
    willMint: true,
    canDoSetup: true,
  },
  );
});

// A worktree's box clone links `node_modules/beebox` to the engine running the
// audit. That link is the engine's own package, so audit setup refreshes the
// engine's generated docs instead of refusing:
void test("A worktree's box clone links nodemodules/beebox to the engine running the audit.", async (t) => {
  t.teardown(async () => {
    try {
      await clone.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const clone = await makeTmpBox();
  await mkdir(clone.path("node_modules"), { recursive: true });
  await symlink(PACKAGE_ROOT, clone.path("node_modules/beebox"), "dir");

  await ensureAuditPackageDocs(clone.root, {
    id: "voice",
    prompt: "voice",
    expected_level: "knows_about",
    watch_for: "voice docs",
    should_read: ["node_modules/beebox/box-docs/chat-voice.md"],
  });
  t.check(await stat(clone.path("node_modules/beebox/box-docs/chat-voice.md")).then((info) => info.isFile()), true);
});
