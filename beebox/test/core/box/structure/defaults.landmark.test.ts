// # installRootLandmark — create, repair, keep
//
// `installRootLandmark` keeps every box's `_content/` carrying a usable
// landmark card. It installs one when none exists, **repairs** one that exists
// but is inert (no real role — e.g. an un-migrated XML-body card), and leaves a
// real landmark alone.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir } from "node:fs/promises";
import { installRootLandmark } from "../../../../src/core/box/structure/defaults.js";
import { parseLandmarkFields } from "../../../../src/schemas/landmark.js";
import { stageFiles, commitPaths } from "../../../../src/lib/git/core/operations.js";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import assert from "node:assert/strict";

async function makeContentBox() {
  const dir = await mkdtemp(join(tmpdir(), "lm-"));
  await mkdir(join(dir, "_content"), { recursive: true });
  return dir;
}

async function rootLabel(dir: string) {
  const contentDir = join(dir, "_content");
  const f = (await readdir(contentDir)).find((n) => n.endsWith(".landmark.card"));
  if (!f) return "(none)";
  const fields = parseLandmarkFields(await readFile(join(contentDir, f), "utf8"));
  return fields?.navigation?.label ?? "(no label)";
}

function gitInit(dir: string) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

// A box with no landmark gets one installed under `_content/` (returns its
// box-relative path so the caller can commit it; label + symbol present). The
// label is the box's OWN name, not a fixed word: this card's label is the box's
// display name everywhere a box is named — the switcher, the dashboard header,
// the browser tab — so a fleet scaffolded with one hardcoded label would be a
// fleet of identical-looking tabs.
void test("A box with no landmark gets one installed under content/ (returns its box-rel...", async (t) => {
  const A = await makeContentBox();
  const rA = await installRootLandmark(A);
  t.check(rA, "_content/Box.landmark.card");

  t.check(await rootLabel(A), basename(A));

  // The root place carries the box's two onboarding openers, so a new box's first
  // chat offers them (they moved here from the briefing seed).

  t.check(parseLandmarkFields(await readFile(join(A, "_content/Box.landmark.card"), "utf8"))?.navigation?.openers, [
    "Let me tell you what this box is for.",
    "What can you do?",
  ]);
});

// An inert root landmark — here the legacy XML-body shape, which the frontmatter
// parser reads as having no role — is repaired in place (the existing filename is
// kept and returned):
void test("An inert root landmark — here the legacy XML-body shape, which the frontmatte...", async (t) => {
  const B = await makeContentBox();
  await writeFile(join(B, "_content", "Box.landmark.card"), "---\ncontent-type: application/x-card+xml\n---\n<landmark><navigation><label>Old</label></navigation></landmark>\n");
  const rB = await installRootLandmark(B);
  t.check(rB, "_content/Box.landmark.card");

  t.check(await rootLabel(B), basename(B));
});

// A repair keeps the place summary. An inert landmark whose body the agent
// wrote gets the stock frontmatter back, and its body survives:
void test("A repair keeps the place summary.", async (t) => {
  const S = await makeContentBox();
  await writeFile(join(S, "_content", "Box.landmark.card"), "---\nsymbol:\n  glyph: 📦\n---\nTwo lists so far: groceries and the landlord.\n");
  await installRootLandmark(S);
  const repaired = await readFile(join(S, "_content", "Box.landmark.card"), "utf8");
  t.check(repaired, `---
navigation:
  label: ${basename(S)}
  openers:
    - Let me tell you what this box is for.
    - What can you do?
symbol:
  glyph: 📦
---
Two lists so far: groceries and the landlord.
`);

  t.check(parseLandmarkFields(repaired), {
    navigation: {
      label: basename(S),
      openers: ["Let me tell you what this box is for.", "What can you do?"],
    },
    symbol: { glyph: "📦" },
  });
});

// A real landmark (it has a navigation role) is left untouched — returns null, the
// user owns it:
void test("A real landmark (it has a navigation role) is left untouched — returns null,...", async (t) => {
  const C = await makeContentBox();
  await writeFile(join(C, "_content", "Home.landmark.card"), "---\nsymbol:\n  glyph: 🏠\nnavigation:\n  label: Home\n---\n");
  const rC = await installRootLandmark(C);
  t.check(rC, null);

  t.check(await rootLabel(C), "Home");
});

// The returned path is what the wakeup commits, so a refilled landmark persists
// (this is the staging + commit sequence `runHousekeeping` runs) — an inert one
// becomes tracked rather than lingering as an uncommitted working file:
void test("The returned path is what the wakeup commits, so a refilled landmark persists...", async (t) => {
  const G = await makeContentBox();
  gitInit(G);
  await writeFile(join(G, "_content", "Box.landmark.card"), "---\ncontent-type: application/x-card+xml\n---\n<landmark><navigation><label>Old</label></navigation></landmark>\n");
  const gp = await installRootLandmark(G);
  assert.ok(gp);
  await stageFiles(G, [gp]);
  await commitPaths(G, { paths: [gp], message: "Refill root landmark", trailers: { "Created-By": "housekeeping" } });
  t.check(execFileSync("git", ["ls-files"], { cwd: G }).toString().trim(), "_content/Box.landmark.card");
});
