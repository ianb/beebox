#!/usr/bin/env node --import tsx
/**
 * Agent SDK updater (`pnpm update-agent-sdk`): bumps
 * `@anthropic-ai/claude-agent-sdk` in callback-box/package.json to the newest
 * npm release that clears the pnpm `minimumReleaseAge` guard, installs, and
 * typechecks. `--check` only reports staleness (exit 1 when behind) without
 * touching anything.
 *
 * Why this exists: the SDK bundles the Claude Code binary the box agents run
 * (it ignores $PATH and any system `claude`), frozen at install time. And a
 * `^0.x.y` caret never crosses 0.x minors, so plain `pnpm update` silently
 * stopped updating when upstream moved 0.2 → 0.3 — we shipped a two-month-old
 * agent binary without noticing. This script crosses minors deliberately;
 * typecheck (here) plus the test suite and the steering probe (run them after)
 * are the gate. See issues/code-quality/2026-05-09-claude-code-sdk-binary-currency.md.
 *
 * After a bump, run:
 *   pnpm -C callback-box test
 *   node --import tsx callback-box/scripts/sdk-steering-probe.ts   (real API calls)
 * then commit. Prod picks the new version up on the next main-merge deploy
 * (the lockfile change triggers a clean reinstall on the server).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PACKAGE = "@anthropic-ai/claude-agent-sdk";
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(REPO_ROOT, "callback-box", "package.json");

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf-8", cwd: REPO_ROOT });
}

/** Publish timestamps per version, from the npm registry. */
function publishTimes(): Map<string, Date> {
  const raw = JSON.parse(run("npm", ["view", PACKAGE, "time", "--json"])) as Record<string, string>;
  const times = new Map<string, Date>();
  for (const [version, iso] of Object.entries(raw)) {
    if (version === "created" || version === "modified") continue;
    if (version.includes("-")) continue; // skip prereleases
    times.set(version, new Date(iso));
  }
  return times;
}

/** The pnpm minimumReleaseAge setting in minutes (0 when unset). */
function minimumReleaseAgeMinutes(): number {
  const out = run("pnpm", ["config", "get", "minimumReleaseAge"]).trim();
  const minutes = Number.parseInt(out, 10);
  return Number.isNaN(minutes) ? 0 : minutes;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Newest mature (release-age-cleared) version on the registry. */
function newestMatureVersion(): string {
  const cutoff = Date.now() - minimumReleaseAgeMinutes() * 60_000;
  let best: string | null = null;
  for (const [version, published] of publishTimes()) {
    if (published.getTime() > cutoff) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  if (best === null) {
    console.error(`update-agent-sdk: no ${PACKAGE} release clears minimumReleaseAge`);
    process.exit(2);
  }
  return best;
}

function installedVersion(): string {
  const pkgPath = path.join(REPO_ROOT, "node_modules", PACKAGE, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
  return pkg.version;
}

/** Version of the platform's bundled Claude Code binary, or null if not found. */
function bundledCliVersion(): string | null {
  const scopeDir = path.join(REPO_ROOT, "node_modules", "@anthropic-ai");
  for (const entry of fs.readdirSync(scopeDir)) {
    if (!entry.startsWith("claude-agent-sdk-")) continue;
    const binary = path.join(scopeDir, entry, "claude");
    if (!fs.existsSync(binary)) continue;
    try {
      return execFileSync(binary, ["--version"], { encoding: "utf-8" }).trim();
    } catch (_e) {
      continue; // wrong-platform variant (e.g. musl on glibc) — try the next
    }
  }
  return null;
}

function rewriteManifest(target: string): void {
  const manifest = fs.readFileSync(MANIFEST, "utf-8");
  const specRe = /"@anthropic-ai\/claude-agent-sdk":\s*"[^"]+"/;
  if (!specRe.test(manifest)) {
    console.error(`update-agent-sdk: no ${PACKAGE} entry in ${MANIFEST}`);
    process.exit(2);
  }
  fs.writeFileSync(MANIFEST, manifest.replace(specRe, `"@anthropic-ai/claude-agent-sdk": "^${target}"`));
}

const checkOnly = process.argv.includes("--check");
const current = installedVersion();
const target = newestMatureVersion();

if (compareVersions(target, current) <= 0) {
  console.log(`${PACKAGE} is up to date: ${current} (bundled CLI: ${bundledCliVersion() ?? "not found"})`);
  process.exit(0);
}

if (checkOnly) {
  console.log(`${PACKAGE} is behind: installed ${current}, newest mature ${target}`);
  console.log("Run `pnpm update-agent-sdk` to bump.");
  process.exit(1);
}

console.log(`Bumping ${PACKAGE}: ${current} → ^${target}`);
rewriteManifest(target);
execFileSync("pnpm", ["install"], { cwd: REPO_ROOT, stdio: "inherit" });
console.log("Typechecking callback-box...");
execFileSync("pnpm", ["-C", "callback-box", "typecheck"], { cwd: REPO_ROOT, stdio: "inherit" });

console.log(`Done. Now at ${installedVersion()} (bundled CLI: ${bundledCliVersion() ?? "not found"}).`);
console.log("Next: pnpm -C callback-box test && node --import tsx callback-box/scripts/sdk-steering-probe.ts, then commit.");
