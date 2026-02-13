#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

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
