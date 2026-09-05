#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Narrow an unknown value to a plain object we can safely index. Used instead
 * of an `as` cast when reading fields out of `JSON.parse` output.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * An error thrown by `execSync` carries the child process's captured
 * stdout/stderr as extra (optional, untyped-by-Error) properties. We only
 * know it's an `Error` for certain, so read the rest defensively.
 */
function getExecOutput(error: unknown): { stdout: string; stderr: string } {
  if (!isRecord(error)) return { stdout: "", stderr: "" };
  const stdout = error.stdout;
  const stderr = error.stderr;
  return {
    stdout: typeof stdout === "string" || Buffer.isBuffer(stdout) ? stdout.toString().trim() : "",
    stderr: typeof stderr === "string" || Buffer.isBuffer(stderr) ? stderr.toString().trim() : "",
  };
}

const args = process.argv.slice(2);

// vibe-check lint --hook: Claude Code PostToolUse hook mode
// Reads JSON from stdin, extracts file_path, runs eslint, exits 2 on failure
if (args[0] === "lint" && args.includes("--hook")) {
  await runLintHook();
} else {
  runFullCheck();
}

async function runLintHook() {
  // Read JSON from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    }
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch (_e) {
    // Not valid JSON — nothing to lint
    process.exit(0);
  }

  const toolInput = isRecord(input) ? input.tool_input : undefined;
  const filePath = isRecord(toolInput) ? toolInput.file_path : undefined;
  if (typeof filePath !== "string" || filePath.length === 0) {
    process.exit(0);
  }

  // Only lint TypeScript/TSX files
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
    process.exit(0);
  }

  // Walk up to find the nearest package.json (subproject root)
  let dir = dirname(filePath);
  while (dir !== "/") {
    if (existsSync(`${dir}/package.json`)) {
      break;
    }
    dir = dirname(dir);
  }
  if (dir === "/") {
    process.exit(0);
  }

  // Run eslint on the specific file from the subproject root
  try {
    execSync(`npx eslint --no-warn-ignored ${JSON.stringify(filePath)}`, {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    // eslint failed — output JSON so Claude sees the errors, but exit 0
    // so the edit is not reverted. Lint is enforced at pre-commit time.
    const { stdout, stderr } = getExecOutput(e);
    const lintErrors = [stdout, stderr].filter(Boolean).join("\n");
    const hookOutput = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `Lint errors in ${filePath} (edit was saved, fix before committing):\n${lintErrors}`,
      },
    });
    process.stdout.write(hookOutput + "\n");
  }
}

interface Step {
  name: string;
  cmd: string;
  condition?: () => boolean;
}

function runFullCheck() {
  const steps: Step[] = [
    {
      name: "TypeScript",
      cmd: "npx tsc --noEmit",
    },
    {
      name: "ESLint",
      cmd: "npx eslint src/",
    },
    {
      name: "oxlint",
      cmd: "npx oxlint -A no-unused-vars",
    },
    {
      name: "knip",
      cmd: "npx knip",
      condition: () => existsSync("knip.json"),
    },
    {
      name: "Circular deps",
      cmd: "npx madge --circular --extensions ts,tsx src/",
    },
  ];

  let failed = false;

  for (const step of steps) {
    if (step.condition && !step.condition()) {
      console.log(`\n⏭  ${step.name} — skipped (no config found)`);
      continue;
    }

    console.log(`\n▶  ${step.name}`);
    console.log("─".repeat(40));

    try {
      execSync(step.cmd, { stdio: "inherit" });
      console.log(`✓  ${step.name} passed`);
    } catch (_e) {
      console.error(`✗  ${step.name} failed`);
      failed = true;
      break;
    }
  }

  console.log("");
  if (failed) {
    console.error("vibe-check: FAILED");
    process.exit(1);
  } else {
    console.log("vibe-check: ALL PASSED");
  }
}
