#!/usr/bin/env node --import tsx
/**
 * Agent SDK updater (`pnpm update-agent-sdk`): bumps the EXACT pin of
 * `@anthropic-ai/claude-agent-sdk` in callback-box/package.json to the newest
 * npm release at least two days old, installs, and typechecks. `--check` only
 * reports staleness (exit 1 when behind) without touching anything.
 *
 * Why this exists: the SDK bundles the Claude Code binary the box agents run
 * (it ignores $PATH and any system `claude`), frozen at install time. And a
 * `^0.x.y` caret never crosses 0.x minors, so plain `pnpm update` silently
 * stopped updating when upstream moved 0.2 → 0.3 — we shipped a two-month-old
 * agent binary without noticing. This script crosses minors deliberately;
 * typecheck (here) plus the test suite and the steering probe (run them after)
 * are the gate. History: issues/closed/code-quality/2026-05-09-claude-code-sdk-binary-currency.md.
 *
 * The pin must stay EXACT (no caret): the SDK family is excluded from the
 * repo's global 7-day minimum-release-age so it can ride this faster 2-day
 * lane, and with the age gate excluded a caret would resolve straight to a
 * minutes-old release. The exact pin makes this script the only thing that
 * moves the version, and the 2-day gate lives here.
 *
 * After a bump, run:
 *   pnpm -C callback-box test
 *   node --import tsx callback-box/scripts/sdk-steering-probe.ts   (real API calls)
 * then commit. Prod picks the new version up on the next main-merge deploy
 * (the lockfile change triggers a clean reinstall on the server).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PACKAGE = "@anthropic-ai/claude-agent-sdk";
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(REPO_ROOT, "callback-box", "package.json");

function run(cmd: string, { args, cwd }: { args: string[]; cwd: string }): string {
  // When this script runs under `pnpm update-agent-sdk`, pnpm injects
  // npm_config_* vars that npm doesn't recognize and warns about on every
  // invocation. Strip them — subprocesses here should see clean tool config.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("npm_config_")) continue;
    env[key] = value;
  }
  return execFileSync(cmd, args, { encoding: "utf-8", cwd, env });
}

/** Publish timestamps per version, from the npm registry. */
function publishTimes(): Map<string, Date> {
  // cwd is the OS tmpdir, NOT the repo: the repo's .npmrc holds pnpm-only
  // keys (node-linker, minimum-release-age) that npm warns about on every
  // read. npm view needs no project context anyway.
  const raw = JSON.parse(run("npm", { args: ["view", PACKAGE, "time", "--json"], cwd: os.tmpdir() })) as Record<string, string>;
  const times = new Map<string, Date>();
  for (const [version, iso] of Object.entries(raw)) {
    if (version === "created" || version === "modified") continue;
    if (version.includes("-")) continue; // skip prereleases
    times.set(version, new Date(iso));
  }
  return times;
}

/**
 * The SDK family tracks a FASTER lane than the repo's global 7-day
 * minimum-release-age: Claude Code ships near-daily and we want its fixes and
 * agent-behavior changes within days, not a week behind. Two days is enough
 * for a bad release to be yanked. The root .npmrc excludes
 * `@anthropic-ai/claude-agent-sdk*` from the global gate specifically so this
 * script's gate governs instead — verified below; without the exclusion,
 * `pnpm install` would refuse anything younger than the global gate anyway.
 */
const SDK_MINIMUM_RELEASE_AGE_MINUTES = 2 * 24 * 60;

function minimumReleaseAgeMinutes(): number {
  const npmrc = fs.readFileSync(path.join(REPO_ROOT, ".npmrc"), "utf-8");
  if (!/^minimum-release-age-exclude\[\]=@anthropic-ai\/claude-agent-sdk\*\s*$/m.test(npmrc)) {
    console.error("update-agent-sdk: root .npmrc is missing `minimum-release-age-exclude[]=@anthropic-ai/claude-agent-sdk*` — the global gate would block the fast lane. Restore it.");
    process.exit(2);
  }
  return SDK_MINIMUM_RELEASE_AGE_MINUTES;
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
  // Exact pin, no caret — see the header: with the SDK family excluded from
  // the global age gate, a range would resolve to brand-new releases.
  fs.writeFileSync(MANIFEST, manifest.replace(specRe, `"@anthropic-ai/claude-agent-sdk": "${target}"`));
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
