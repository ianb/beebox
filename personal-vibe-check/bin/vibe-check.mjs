#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

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
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch (_e) {
    // Not valid JSON — nothing to lint
    process.exit(0);
  }

  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath) {
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
    const output = e.stdout ? e.stdout.toString().trim() : "";
    const errOutput = e.stderr ? e.stderr.toString().trim() : "";
    const lintErrors = [output, errOutput].filter(Boolean).join("\n");
    const hookOutput = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `Lint errors in ${filePath} (edit was saved, fix before committing):\n${lintErrors}`,
      },
    });
    process.stdout.write(hookOutput + "\n");
  }
}

function runFullCheck() {
  const steps = [
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
