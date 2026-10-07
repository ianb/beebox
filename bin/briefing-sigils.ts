/**
 * CLI for the launcher's briefing check: reads a briefing on stdin, takes one
 * or more skill directories (e.g. `.claude/skills`), and prints each skill
 * sigil in the briefing's prose as `line N: <token>`.
 *
 * Exit 0: none found. Exit 3: found (distinct from node's own exit 1 on a
 * crash). Exit 2: usage error or no skills could be read (fails closed, since
 * an empty skill list would pass every briefing).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";

import { findSkillSigils } from "./lib/briefing-sigils.ts";

function skillNames(dirs: string[]): Set<string> {
  const names = new Set<string>();
  for (const dir of dirs) {
    // A checkout without skills contributes none; other read failures throw.
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) if (entry.isDirectory()) names.add(entry.name);
  }
  return names;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  process.stderr.write("usage: briefing-sigils.ts <skills-dir>... < briefing\n");
  process.exit(2);
}
const skills = skillNames(dirs);
if (skills.size === 0) {
  process.stderr.write(`briefing-sigils: no skill directories found under ${dirs.join(", ")}\n`);
  process.exit(2);
}
const hits = findSkillSigils(readFileSync(0, "utf8"), skills);
for (const hit of hits) process.stdout.write(`line ${hit.line}: ${hit.token}\n`);
process.exit(hits.length > 0 ? 3 : 0);
