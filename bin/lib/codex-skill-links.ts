/**
 * The `.agents/skills/` half of the Codex mirror (`bin/generate-agents-md.ts`):
 * one symlink per tracked `.claude/skills/<name>/SKILL.md`, and removal of
 * every entry that has no tracked source.
 */

import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

function gitLsFiles(checkoutDir: string, ...patterns: string[]): string[] {
  const out = execFileSync(
    "git",
    ["-C", checkoutDir, "ls-files", "--", ...patterns],
    { encoding: "utf8" },
  );
  return out.split("\n").filter((line) => line !== "");
}

function lstatIfPresent(
  path: string,
): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

// Remove every `.agents/skills/` entry this generator would not create: a
// symlink, directory, or file whose name has no tracked `.claude/skills/<name>/
// SKILL.md`. Real directories here are pre-symlink copies (the main checkout
// kept three from 2026-07 that Codex kept loading). Safety: nothing is removed
// unless `.agents/skills` resolves to exactly `<checkout>/.agents/skills`, and
// a directory holding a git-tracked file is skipped with a warning.
function pruneUnexpectedSkillEntries(
  checkoutDir: string,
  expected: ReadonlySet<string>,
): void {
  const skillsDir = join(checkoutDir, ".agents", "skills");
  const canonicalSkillsDir = join(realpathSync(checkoutDir), ".agents", "skills");
  if (realpathSync(skillsDir) !== canonicalSkillsDir) {
    console.warn(
      `generate-agents-md: .agents/skills resolves outside ${canonicalSkillsDir}; not pruning it`,
    );
    return;
  }
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (expected.has(entry.name)) continue;
    const path = join(skillsDir, entry.name);
    if (dirname(path) !== skillsDir) continue;
    const rel = join(".agents", "skills", entry.name);
    if (entry.isSymbolicLink()) {
      unlinkSync(path);
      console.log(`generate-agents-md: removed stale skill link ${rel}`);
      continue;
    }
    if (gitLsFiles(checkoutDir, `:(literal)${rel}`).length > 0) {
      console.warn(
        `generate-agents-md: not removing ${rel}: it contains git-tracked files`,
      );
      continue;
    }
    rmSync(path, { recursive: true });
    console.log(
      `generate-agents-md: removed ${rel}: no tracked .claude/skills/${entry.name}/SKILL.md`,
    );
  }
}

// Link every tracked Claude skill into the repo-scoped location Codex scans.
// Symlinks keep scripts/references/assets attached without duplicating them.
// Entries with no tracked source are pruned first; a real entry at a tracked
// skill's name is left alone and warned about instead of being overwritten.
export function generateSkillLinks(checkoutDir: string): string[] {
  const skillNames = gitLsFiles(checkoutDir, ".claude/skills/*/SKILL.md")
    .map((path) => path.split("/"))
    .filter(
      (parts) =>
        parts.length === 4 &&
        parts[0] === ".claude" &&
        parts[1] === "skills" &&
        parts[3] === "SKILL.md",
    )
    .map((parts) => parts[2])
    .filter((name): name is string => name !== undefined)
    .toSorted();
  const expected = new Set(skillNames);
  const skillsDir = join(checkoutDir, ".agents", "skills");
  mkdirSync(skillsDir, { recursive: true });
  pruneUnexpectedSkillEntries(checkoutDir, expected);

  const written: string[] = [];
  for (const name of skillNames) {
    const target = join("..", "..", ".claude", "skills", name);
    const path = join(skillsDir, name);
    const existing = lstatIfPresent(path);
    if (existing === undefined) {
      symlinkSync(target, path, "dir");
    } else if (!existing.isSymbolicLink() || readlinkSync(path) !== target) {
      // Still refuse to overwrite — a hand-authored native Codex skill at a
      // tracked skill's name is a real thing to protect (see the test of the
      // same name). But SKIP it and keep going rather than throwing.
      //
      // Throwing aborted the whole run at the FIRST such entry, so one
      // unexpected directory silently cost every later skill AND the AGENTS.md
      // mirrors after it. The main checkout sat on 2026-07-06 copies of all 15
      // skills for seven weeks that way, and the only symptom was Codex
      // sessions working from stale instructions — invisible unless someone ran
      // the generator by hand. A loud skip keeps the protection and bounds the
      // damage to the one entry it is protecting.
      console.warn(
        `generate-agents-md: refusing to overwrite existing Codex skill path: .agents/skills/${name} — ` +
          "leaving it as-is. If this is a stale generated copy rather than a native Codex skill, " +
          "remove it and re-run to restore the symlink.",
      );
      continue;
    }
    written.push(join(".agents", "skills", name));
  }
  return written;
}
