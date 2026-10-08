// Tests for bin/lib/codex-skill-links.ts (the `.agents/skills/` half of
// bin/generate-agents-md.ts) against a throwaway git repo. Split from
// generate-agents-md.test.ts with the code, which outgrew one file.
//   node --import tsx --test bin/codex-skill-links.test.ts

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { generateSkillLinks } from "./lib/codex-skill-links.js";

const repo = mkdtempSync(join(tmpdir(), "codex-skill-links-test-"));
after(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]): void {
  execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

before(() => {
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  git("commit", "-q", "--allow-empty", "-m", "init");
});

test("links tracked Claude skills into the Codex skill directory", () => {
  mkdirSync(join(repo, ".claude", "skills", "finish"), { recursive: true });
  writeFileSync(
    join(repo, ".claude", "skills", "finish", "SKILL.md"),
    "---\nname: finish\n---\n",
  );
  writeFileSync(
    join(repo, ".claude", "skills", "finish", "helper.txt"),
    "linked asset\n",
  );
  git(
    "add",
    ".claude/skills/finish/SKILL.md",
    ".claude/skills/finish/helper.txt",
  );
  git("commit", "-q", "-m", "add skill");

  assert.deepEqual(generateSkillLinks(repo), [".agents/skills/finish"]);
  assert.equal(
    readlinkSync(join(repo, ".agents", "skills", "finish")),
    join("..", "..", ".claude", "skills", "finish"),
  );
  assert.equal(
    readFileSync(
      join(repo, ".agents", "skills", "finish", "helper.txt"),
      "utf8",
    ),
    "linked asset\n",
  );
});

test("regeneration removes stale generated skill links", () => {
  git("rm", "-q", "-r", ".claude/skills/finish");
  git("commit", "-q", "-m", "remove skill");

  assert.deepEqual(generateSkillLinks(repo), []);
  assert.equal(existsSync(join(repo, ".agents", "skills", "finish")), false);
});

test("refuses to overwrite an existing native Codex skill, and keeps going", () => {
  mkdirSync(join(repo, ".claude", "skills", "finish"), { recursive: true });
  writeFileSync(
    join(repo, ".claude", "skills", "finish", "SKILL.md"),
    "---\nname: finish\n---\n",
  );
  mkdirSync(join(repo, ".claude", "skills", "later"), { recursive: true });
  writeFileSync(
    join(repo, ".claude", "skills", "later", "SKILL.md"),
    "---\nname: later\n---\n",
  );
  mkdirSync(join(repo, ".agents", "skills", "finish"), { recursive: true });
  writeFileSync(
    join(repo, ".agents", "skills", "finish", "SKILL.md"),
    "native\n",
  );
  git("add", ".claude/skills/finish/SKILL.md", ".claude/skills/later/SKILL.md");
  git("commit", "-q", "-m", "restore skill");

  // The native skill is left untouched — that protection is the point.
  const written = generateSkillLinks(repo);
  assert.equal(
    readFileSync(join(repo, ".agents", "skills", "finish", "SKILL.md"), "utf8"),
    "native\n",
  );

  // ...but it no longer aborts the run. `later` sorts after `finish`, so under
  // the old throw-on-first-conflict behavior it was never linked at all — one
  // unexpected directory silently cost every skill after it.
  assert.ok(written.includes(".agents/skills/later"));
  assert.equal(
    readlinkSync(join(repo, ".agents", "skills", "later")),
    join("..", "..", ".claude", "skills", "later"),
  );
});

function put(rel: string, content: string): void {
  mkdirSync(join(repo, rel, ".."), { recursive: true });
  writeFileSync(join(repo, rel), content);
}

test("prunes entries with no tracked skill source; keeps git-tracked ones", () => {
  const skills = join(repo, ".agents", "skills");
  // A pre-symlink real copy, a stray file, a foreign symlink (its target must
  // survive), and a real directory holding a git-tracked file (protected).
  put(".agents/skills/skill-creator/references/x.md", "stale copy\n");
  put(".agents/skills/stray.md", "stray\n");
  const outside = mkdtempSync(join(tmpdir(), "generate-agents-md-outside-"));
  writeFileSync(join(outside, "keep.txt"), "keep\n");
  symlinkSync(outside, join(skills, "foreign"), "dir");
  put(".agents/skills/tracked-native/SKILL.md", "tracked\n");
  symlinkSync(outside, join(skills, "tracked-link"), "dir");
  git("add", "-f", ".agents/skills/tracked-native/SKILL.md", ".agents/skills/tracked-link");
  git("commit", "-q", "-m", "track a native skill");

  const written = generateSkillLinks(repo);

  for (const gone of ["skill-creator", "stray.md", "foreign"])
    assert.equal(existsSync(join(skills, gone)), false, gone);
  assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep\n");
  assert.equal(readFileSync(join(skills, "tracked-native", "SKILL.md"), "utf8"), "tracked\n");
  assert.equal(readlinkSync(join(skills, "tracked-link")), outside);
  // The tracked-name native skill from the previous test is still untouched.
  assert.equal(readFileSync(join(skills, "finish", "SKILL.md"), "utf8"), "native\n");
  assert.ok(written.includes(".agents/skills/later"));
  rmSync(outside, { recursive: true, force: true });
  git("rm", "-q", "-r", "--cached", ".agents/skills/tracked-native", ".agents/skills/tracked-link");
  git("commit", "-q", "-m", "untrack native skill");
});

test("writes nothing when .agents/skills resolves outside the checkout", () => {
  const elsewhere = mkdtempSync(join(tmpdir(), "generate-agents-md-elsewhere-"));
  writeFileSync(join(elsewhere, "precious.txt"), "precious\n");
  const skills = join(repo, ".agents", "skills");
  rmSync(skills, { recursive: true, force: true });
  symlinkSync(elsewhere, skills, "dir");
  assert.deepEqual(generateSkillLinks(repo), []);
  assert.equal(readFileSync(join(elsewhere, "precious.txt"), "utf8"), "precious\n");
  assert.deepEqual(readdirSync(elsewhere), ["precious.txt"]);
  unlinkSync(skills);
  rmSync(elsewhere, { recursive: true, force: true });
});
