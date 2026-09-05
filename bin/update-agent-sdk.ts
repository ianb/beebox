#!/usr/bin/env node --import tsx
/**
 * Agent updater (`pnpm update-agent-sdk`): bumps the EXACT pins of the two
 * agent families in beebox/package.json to the newest npm release at least two
 * days old, installs, and typechecks. `--check` only reports staleness (exit 1
 * when any family is behind) without touching anything.
 *
 * Families:
 *   - `@anthropic-ai/claude-agent-sdk` — bundles the Claude Code binary the box
 *     agents run (it ignores $PATH and any system `claude`), frozen at install
 *     time.
 *   - `@openai/codex` + `@openai/codex-sdk`, pinned together — the Codex binary
 *     the box's Codex chats run and the production server's `/usr/local/bin/codex`
 *     symlink resolves to. Nothing else updates Codex on the server: the pin is
 *     the only channel, so a stale pin is a stale server.
 *
 * Why this exists: a `^0.x.y` caret never crosses 0.x minors, so plain
 * `pnpm update` silently stopped updating when upstream moved 0.2 → 0.3 — we
 * shipped a two-month-old agent binary without noticing. This script crosses
 * minors deliberately; typecheck (here) plus the test suite and the steering
 * probe (run them after) are the gate. History:
 * issues/closed/code-quality/2026-05-09-claude-code-sdk-binary-currency.md.
 *
 * The pins must stay EXACT (no caret): both families are excluded from the
 * repo's global 7-day minimum-release-age so they can ride this faster 2-day
 * lane, and with the age gate excluded a caret would resolve straight to a
 * minutes-old release. The exact pin makes this script the only thing that
 * moves the version, and the 2-day gate lives here.
 *
 * After a bump, run:
 *   pnpm -C beebox test
 *   node --import tsx beebox/scripts/sdk-steering-probe.ts   (real API calls; SDK bumps)
 * then commit. Prod picks the new version up on the next main-merge deploy
 * (the lockfile change triggers a clean reinstall on the server).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(REPO_ROOT, "beebox", "package.json");

interface Family {
  label: string;
  /**
   * Every package pinned to one version, together. The age gate is measured
   * over ALL of them: a version is mature only when each package has
   * published it and each publish is old enough. Codex's CLI and SDK ship
   * separately, and gating on one would pin the other to a release it has
   * not made yet or made minutes ago.
   */
  npmNames: [string, ...string[]];
  /** The root `.npmrc` exclusion that hands this family's gating to this script. */
  exclusion: RegExp;
  /** Version of the family's agent binary as installed, or null if not found. */
  binaryVersion: () => string | null;
}

const FAMILIES: Family[] = [
  {
    label: "Agent SDK",
    npmNames: ["@anthropic-ai/claude-agent-sdk"],
    exclusion: /^minimum-release-age-exclude\[]=@anthropic-ai\/claude-agent-sdk\*\s*$/m,
    binaryVersion: bundledClaudeVersion,
  },
  {
    label: "Codex",
    npmNames: ["@openai/codex", "@openai/codex-sdk"],
    exclusion: /^minimum-release-age-exclude\[]=@openai\/codex\*\s*$/m,
    binaryVersion: codexVersion,
  },
];

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

/** `npm view <pkg> time --json`: an ISO timestamp per version, plus `created`/`modified`. */
const PublishTimes = z.record(z.string(), z.string());

/** Publish timestamps per stable version, from the npm registry. */
function publishTimes(npmName: string): Map<string, Date> {
  // cwd is the OS tmpdir, NOT the repo: the repo's .npmrc holds pnpm-only
  // keys (node-linker, minimum-release-age) that npm warns about on every
  // read. npm view needs no project context anyway.
  const raw = PublishTimes.parse(JSON.parse(run("npm", { args: ["view", npmName, "time", "--json"], cwd: os.tmpdir() })));
  const times = new Map<string, Date>();
  for (const [version, iso] of Object.entries(raw)) {
    if (version === "created" || version === "modified") continue;
    if (version.includes("-")) continue; // skip prereleases
    times.set(version, new Date(iso));
  }
  return times;
}

/**
 * Both families track a FASTER lane than the repo's global 7-day
 * minimum-release-age: Claude Code and Codex ship near-daily and we want their
 * fixes and agent-behavior changes within days, not a week behind. Two days is
 * enough for a bad release to be yanked. The root .npmrc excludes each family
 * from the global gate specifically so this script's gate governs instead —
 * verified below; without the exclusion, `pnpm install` would refuse anything
 * younger than the global gate anyway.
 */
const MINIMUM_RELEASE_AGE_MINUTES = 2 * 24 * 60;

function requireExclusion(family: Family): void {
  const npmrc = fs.readFileSync(path.join(REPO_ROOT, ".npmrc"), "utf-8");
  if (!family.exclusion.test(npmrc)) {
    console.error(`update-agent-sdk: root .npmrc is missing the minimum-release-age-exclude entry for ${family.npmNames.join(" + ")} — the global gate would block the fast lane. Restore it.`);
    process.exit(2);
  }
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

/**
 * Newest mature (release-age-cleared) version of the family on the registry:
 * published by every package in the family, each publish older than the gate.
 */
function newestMatureVersion(family: Family): string {
  requireExclusion(family);
  const cutoff = Date.now() - MINIMUM_RELEASE_AGE_MINUTES * 60_000;
  const [primary, ...others] = family.npmNames;
  const first = publishTimes(primary);
  const rest = others.map((npmName) => publishTimes(npmName));
  let best: string | null = null;
  for (const [version, published] of first) {
    if (published.getTime() > cutoff) continue;
    const matureEverywhere = rest.every((times) => {
      const other = times.get(version);
      return other !== undefined && other.getTime() <= cutoff;
    });
    if (!matureEverywhere) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  if (best === null) {
    console.error(`update-agent-sdk: no ${family.npmNames.join(" + ")} release clears minimumReleaseAge in every package`);
    process.exit(2);
  }
  return best;
}

/**
 * The exact version beebox/package.json pins. The manifest, not
 * `node_modules`: with hoisting, the root workspace's own (unmanaged) copy of
 * the SDK is what lands in `node_modules`, so reading the installed package
 * reported "behind" on a current repo and every bump ended by printing the
 * root's version (`issues/code-quality/2026-09-01-agent-sdk-split-pin-root-copy.md`).
 */
function pinnedVersion(npmName: string): string {
  const manifest = z.object({ dependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(fs.readFileSync(MANIFEST, "utf-8")));
  const pin = manifest.dependencies[npmName];
  if (pin === undefined || !/^\d+\.\d+\.\d+$/.test(pin)) {
    console.error(`update-agent-sdk: ${MANIFEST} has no exact pin for ${npmName} (found ${pin ?? "nothing"})`);
    process.exit(2);
  }
  return pin;
}

/** Version of the platform's bundled Claude Code binary, or null if not found. */
function bundledClaudeVersion(): string | null {
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

/** Version the installed `codex` CLI reports, or null if it cannot run. */
function codexVersion(): string | null {
  const binary = path.join(REPO_ROOT, "node_modules", ".bin", "codex");
  if (!fs.existsSync(binary)) return null;
  try {
    return execFileSync(binary, ["--version"], { encoding: "utf-8" }).trim();
  } catch (_e) {
    return null;
  }
}

function rewriteManifest(family: Family, target: string): void {
  let manifest = fs.readFileSync(MANIFEST, "utf-8");
  for (const name of family.npmNames) {
    // Textual edit, so the manifest's formatting survives. Exact pin, no caret
    // — see the header: with the family excluded from the global age gate, a
    // range would resolve to brand-new releases.
    const key = `"${name}": "`;
    const start = manifest.indexOf(key);
    const end = start === -1 ? -1 : manifest.indexOf('"', start + key.length);
    if (start === -1 || end === -1) {
      console.error(`update-agent-sdk: no ${name} entry in ${MANIFEST}`);
      process.exit(2);
    }
    manifest = manifest.slice(0, start + key.length) + target + manifest.slice(end);
  }
  fs.writeFileSync(MANIFEST, manifest);
}

const checkOnly = process.argv.includes("--check");
const behind: { family: Family; current: string; target: string }[] = [];

for (const family of FAMILIES) {
  const [primary] = family.npmNames;
  const current = pinnedVersion(primary);
  // Every package in the family must sit on the same pin; a drift is a hand
  // edit this script never made, and bumping over it would hide it.
  for (const name of family.npmNames) {
    const pin = pinnedVersion(name);
    if (pin !== current) {
      console.error(`update-agent-sdk: ${family.label} pins disagree: ${primary} ${current}, ${name} ${pin}. Align them by hand first.`);
      process.exit(2);
    }
  }
  const target = newestMatureVersion(family);
  if (compareVersions(target, current) <= 0) {
    console.log(`${family.label} (${family.npmNames.join(", ")}) is up to date: ${current} (binary: ${family.binaryVersion() ?? "not found"})`);
    continue;
  }
  console.log(`${family.label} (${family.npmNames.join(", ")}) is behind: pinned ${current}, newest mature ${target}`);
  behind.push({ family, current, target });
}

if (behind.length === 0) process.exit(0);

if (checkOnly) {
  console.log("Run `pnpm update-agent-sdk` to bump.");
  process.exit(1);
}

for (const { family, current, target } of behind) {
  console.log(`Bumping ${family.label} (${family.npmNames.join(", ")}): ${current} → ${target}`);
  rewriteManifest(family, target);
}
execFileSync("pnpm", ["install"], { cwd: REPO_ROOT, stdio: "inherit" });
console.log("Typechecking beebox...");
execFileSync("pnpm", ["-C", "beebox", "typecheck"], { cwd: REPO_ROOT, stdio: "inherit" });

for (const { family } of behind) {
  console.log(`${family.label} now at ${pinnedVersion(family.npmNames[0])} (binary: ${family.binaryVersion() ?? "not found"}).`);
}
console.log("Next: pnpm -C beebox test (and the steering probe for an SDK bump), then commit.");
