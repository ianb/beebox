// # `bbx chat whats-changed` + turn marker
//
// The chat turn marker (`src/core/chat/turn-marker.ts`) records the git HEAD a
// session was left at after each reply; `summarizeWhatsChanged`
// (`src/core/chat/whats-changed.ts`) diffs `marker.head..HEAD` (committed) plus
// the uncommitted working tree to tell the agent what changed since it last
// spoke. The ranged git helpers it needs live in `src/lib/git-range.ts`.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import {
  recordTurnMarker,
  loadTurnMarker,
  recordTurnMarkerForSession,
} from "../../../src/core/chat/turn-marker.js";
import { summarizeWhatsChanged } from "../../../src/core/chat/whats-changed.js";

// ## Marker round-trip
//
// `recordTurnMarker` writes one file per session; `loadTurnMarker` reads it back,
// returning `null` for an absent or malformed marker.
void test("recordTurnMarker writes one file per session; loadTurnMarker reads it back, r...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L25
  const box = await makeTmpBox({ git: true });
  recordTurnMarker(box.root, { sessionId: "sess-1", head: "deadbeef", time: "2026-06-14T00:00:00Z" });
  t.check(loadTurnMarker(box.root, "sess-1"), {
    head: "deadbeef",
    time: "2026-06-14T00:00:00Z",
  });

  // doctest:L30
  await t.checkText(loadTurnMarker(box.root, "never-recorded") === null, "true");
});

// ## Report: commits since the marker, plus the uncommitted tree
//
// After recording the marker, a later commit shows up as "since your last reply",
// an earlier commit does not, and an untracked file shows in the working tree.
void test("After recording the marker, a later commit shows up as \"since your last reply...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L44
  const box = await makeTmpBox({ git: true });
  await box.write("_content/Trip.doc.card", "first");
  box.commitAll("add trip card");
  // Mark this point as "my last reply".
  await recordTurnMarkerForSession(box.root, "sess-1");
  // Work since: one new commit, plus one new untracked file.
  await box.write("_content/Trip.doc.card", "first\nsecond");
  box.commitAll("expand trip card");
  await box.write("_content/Notes.doc.card", "scratch");
  const report = await summarizeWhatsChanged(box.root, { sessionId: "sess-1" });

  // doctest:L55
  await t.checkText(report.includes("Commits since your last reply"), "true");

  // doctest:L58
  await t.checkText(report.includes("expand trip card"), "true");

  // doctest:L61
  await t.checkText(report.includes("add trip card"), "false");

  // doctest:L64
  await t.checkText(report.includes("Uncommitted working tree"), "true");

  // doctest:L67
  await t.checkText(report.includes("Untracked: _content/Notes.doc.card"), "true");

  // Scoping to a card path narrows every section to that path: the Trip card's
  // commit stays, the out-of-scope Notes file drops out.

  // doctest:L75
  const scoped = await summarizeWhatsChanged(box.root, { sessionId: "sess-1", card: "_content/Trip.doc.card" });
  await t.checkText(scoped.includes("Scope: _content/Trip.doc.card"), "true");

  // doctest:L79
  await t.checkText(scoped.includes("expand trip card"), "true");

  // doctest:L82
  await t.checkText(scoped.includes("Notes"), "false");
});

// ## Marker-absent fallback (first turn)
//
// With no marker yet, the report falls back to the last few commits, labeled as
// such, rather than claiming a precise delta.
void test("With no marker yet, the report falls back to the last few commits, labeled as...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L96
  const box = await makeTmpBox({ git: true });
  await box.write("_content/Trip.doc.card", "first");
  box.commitAll("add trip card");
  const report = await summarizeWhatsChanged(box.root, { sessionId: "no-marker-session" });

  // doctest:L101
  await t.checkText(report.includes("No turn marker yet"), "true");

  // doctest:L104
  await t.checkText(report.includes("add trip card"), "true");
});
