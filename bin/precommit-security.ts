#!/usr/bin/env node --import tsx
import { execFileSync, spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
}).split("\0").filter(Boolean);
const added = execFileSync("git", ["diff", "--cached", "--no-ext-diff", "--unified=0", "--"], {
  cwd: repoRoot,
  encoding: "utf8",
}).split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));

const conflict = added.find((line) => /^\+(?:<<<<<<<|>>>>>>>)(?: |$)/u.test(line));
if (conflict) {
  process.stderr.write("pre-commit security: staged merge-conflict marker\n");
  process.exit(1);
}
const privateKey = added.find((line) => /BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u.test(line));
if (privateKey) {
  process.stderr.write("pre-commit security: staged private key\n");
  process.exit(1);
}

function isStagedBinary(file: string): boolean {
  const numstat = execFileSync(
    "git",
    ["diff", "--cached", "--numstat", "--no-ext-diff", "--", file],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return numstat.startsWith("-\t-");
}

const shellFiles = staged.filter((file) => {
  if (file.startsWith(".husky/") || /\.(?:sh|bash)$/u.test(file)) return true;
  if (isStagedBinary(file)) return false;
  const content = execFileSync("git", ["show", `:${file}`], { cwd: repoRoot, encoding: "utf8" });
  return /^#!.*\b(?:ba|z|k)?sh\b/u.test(content);
});
if (shellFiles.length > 0) {
  const result = spawnSync("pnpm", ["exec", "shellcheck", "-x", "-P", "bin/lib", "--", ...shellFiles], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
