// # Journey fixture boundaries
//
// A collected but unreported walk still blocks a new run, without deleting its evidence.
// Even notes from a failed preparation (no before snapshot) must be read first.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeProjectDir } from "../../src/core/chat/session/transcript-paths.ts";
import { assertPreviousRunsReported, allocateRun } from "./journeys/provisioning.ts";

void test("line 14", async (t) => {
  t.teardown(async () => {
    try {
      if (previousProjects === undefined) delete process.env.BBX_CLAUDE_PROJECTS_DIR;
      else process.env.BBX_CLAUDE_PROJECTS_DIR = previousProjects;
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const root = mkdtempSync(join(tmpdir(), "journey-provision-"));
  const previousProjects = process.env.BBX_CLAUDE_PROJECTS_DIR;
  const projects = join(root, "claude-projects");
  process.env.BBX_CLAUDE_PROJECTS_DIR = projects;
  const work = join(root, "work");
  const boxes = join(root, "boxes");
  const spec = join(root, "C-reconnection");
  const prior = join(work, "C-reconnection-2026-09-20");
  mkdirSync(prior, { recursive: true });
  mkdirSync(join(spec, "reports"), { recursive: true });
  writeFileSync(join(prior, "notes.md"), "I tried it.");
  writeFileSync(join(prior, "after.json"), "{}");
  await t.checkThrows(async () => (assertPreviousRunsReported({ work, journeyDir: spec, id: "C-reconnection" })), "UnreportedJourneyError");

  t.check(existsSync(join(prior, "notes.md")), true);

  writeFileSync(join(spec, "reports", "2026-09-20.md"), "");
  await t.checkThrows(async () => (assertPreviousRunsReported({ work, journeyDir: spec, id: "C-reconnection" })), "UnreportedJourneyError");

  writeFileSync(join(spec, "reports", "2026-09-20.md"), "Reviewed the evidence.");
  assertPreviousRunsReported({ work, journeyDir: spec, id: "C-reconnection" });
  mkdirSync(join(boxes, "c-reconnection-2026-09-20-2"), { recursive: true });
  const allocated = allocateRun({ work, boxes, id: "C-reconnection", date: "2026-09-20" });
  t.check(allocated.boxSlug, "c-reconnection-2026-09-20-3");

  t.check(existsSync(allocated.boxDir), false);

  // A transcript can survive a deleted box; its directory must also reserve the slug.
  const retainedTranscript = join(projects, encodeProjectDir(allocated.boxDir));
  mkdirSync(retainedTranscript, { recursive: true });
  writeFileSync(join(retainedTranscript, "old-session.jsonl"), '{"type":"user"}');
  t.check(allocateRun({ work, boxes, id: "C-reconnection", date: "2026-09-20" }).boxSlug, "c-reconnection-2026-09-20-4");

  t.check(existsSync(join(retainedTranscript, "old-session.jsonl")), true);

  await t.checkThrows(async () => (allocateRun({ work, boxes, id: "../real-box" })), "InvalidJourneyIdError");
});
