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
    // eslint failed — write output to stderr, exit 2 for Claude Code feedback
    const output = e.stdout ? e.stdout.toString() : "";
    const errOutput = e.stderr ? e.stderr.toString() : "";
    if (output) {
      process.stderr.write(output);
    }
    if (errOutput) {
      process.stderr.write(errOutput);
    }
    process.exit(2);
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
