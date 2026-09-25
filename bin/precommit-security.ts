#!/usr/bin/env node --import tsx
import { execFileSync, spawnSync } from "node:child_process";

const repoRoot = process.cwd();

/**
 * Node's default 1MB `maxBuffer` is far too small for these reads: a staged
 * diff or file listing can be megabytes (a generated catalog, a large fixture),
 * and exceeding it kills git with SIGTERM and throws ENOBUFS — the hook then
 * blocks the commit with a stack trace instead of a security verdict.
 */
const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * A shebang is in the first line, so a file too large to be a script by hand
 * is not worth buffering to sniff one.
 */
const MAX_SHEBANG_SNIFF_BYTES = 1024 * 1024;

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: MAX_BUFFER,
}).split("\0").filter(Boolean);
const added = execFileSync("git", ["diff", "--cached", "--no-ext-diff", "--unified=0", "--"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: MAX_BUFFER,
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
    { cwd: repoRoot, encoding: "utf8", maxBuffer: MAX_BUFFER },
  );
  return numstat.startsWith("-\t-");
}

function stagedBlobSize(file: string): number {
  const size = execFileSync("git", ["cat-file", "-s", `:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  }).trim();
  return Number(size);
}

const shellFiles = staged.filter((file) => {
  if (file.startsWith(".husky/") || /\.(?:sh|bash)$/u.test(file)) return true;
  if (isStagedBinary(file)) return false;
  if (stagedBlobSize(file) > MAX_SHEBANG_SNIFF_BYTES) return false;
  const content = execFileSync("git", ["show", `:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return /^#!.*\b(?:ba|z|k)?sh\b/u.test(content);
});
if (shellFiles.length > 0) {
  const result = spawnSync("pnpm", ["exec", "shellcheck", "-x", "-P", "bin/lib", "--", ...shellFiles], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
