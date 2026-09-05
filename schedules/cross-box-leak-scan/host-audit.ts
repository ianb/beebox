/**
 * The host half of the cross-box leak scan: beebox serves several boxes as
 * one OS user, so isolation between boxes is env-level, not OS-level. This
 * audits a HOME directory (default the local `os.homedir()`, or a given
 * `--home` for a test fixture or a remote service-user home) for the shapes
 * of host state that could leak one box's content to another.
 *
 * Deliberately dependency-free of beebox source (no `import` from
 * `beebox/src/**`), even though a couple of these checks duplicate small
 * beebox helpers (`encodeProjectDir`, `fileExists`) — this script has to run
 * unmodified against `/opt/beebox/beebox` over ssh as the `beebox` service
 * user (see `run.ts`), where importing this checkout's `beebox/` would be
 * either wrong (a different beebox version) or impossible (a worktree
 * doesn't ship beebox's compiled output). Each duplicate says so and cites
 * its source of truth.
 */

import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { loadBoxRoots, type BoxRoot } from "./box-manifest.js";

export type { BoxRoot } from "./box-manifest.js";
export { loadBoxRoots } from "./box-manifest.js";

export interface HostFinding {
  /** The path the finding is about (absolute). */
  path: string;
  /** What is wrong. */
  message: string;
}

/** One line per finding, `host  <path>  <message>`. */
export function formatFinding(finding: HostFinding): string {
  return `host  ${finding.path}  ${finding.message}`;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (_e) {
    return false;
  }
}

async function statOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.stat(target);
  } catch (_e) {
    return null;
  }
}

// ─── check: file/dir modes ─────────────────────────────────────────────

/**
 * Files that actually hold secret material and are written 0600 by their own
 * code — NOT box paths/slugs (`hub.json`, `boxes.json`), which are not
 * confidential and whose writers (`boxes-config.ts`, `hub-config-edit.ts`)
 * use the process default mode on purpose. `secrets.json` is 0600 per
 * `core/secrets/store.ts`'s `writeFileAtomic(..., { mode: 0o600 })`.
 */
function secretFileCandidates(homeDir: string): string[] {
  const files = [
    path.join(homeDir, ".bbx-session-secret"),
    path.join(homeDir, ".bbx-auth.json"),
    path.join(homeDir, ".config", "beebox", "secrets.json"),
    path.join(homeDir, ".local", "share", "beebox", "push-subscriptions.json"),
  ];
  const googleTokens = process.env["BBX_GOOGLE_TOKENS_FILE"];
  if (googleTokens !== undefined && googleTokens !== "") files.push(googleTokens);
  return files;
}

/** Directories that must be `0700` if they exist. Only `secrets-log/` is
 *  checked — `core/secrets/access-log.ts` creates it with
 *  `fs.mkdir(..., { mode: 0o700 })`; no other shared beebox directory is
 *  documented or observed to enforce a mode, so a general `.config/beebox`
 *  or `.local/share/beebox` check would just be inventing a policy. */
function secretDirCandidates(homeDir: string): string[] {
  return [path.join(homeDir, ".config", "beebox", "secrets-log")];
}

/** Group/other bits set on a mode that should be private to the owner. */
function isGroupOrOtherReadable(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

export async function checkModes(homeDir: string): Promise<HostFinding[]> {
  const findings: HostFinding[] = [];
  for (const file of secretFileCandidates(homeDir)) {
    const stat = await statOrNull(file);
    if (stat === null || !stat.isFile()) continue;
    const mode = stat.mode & 0o777;
    if (isGroupOrOtherReadable(mode)) {
      findings.push({ path: file, message: `mode ${mode.toString(8)}, expected 0600 (group/other readable)` });
    }
  }
  for (const dir of secretDirCandidates(homeDir)) {
    const stat = await statOrNull(dir);
    if (stat === null || !stat.isDirectory()) continue;
    const mode = stat.mode & 0o777;
    if (isGroupOrOtherReadable(mode)) {
      findings.push({ path: dir, message: `mode ${mode.toString(8)}, expected 0700 (group/other accessible)` });
    }
  }
  return findings;
}

// ─── check: shared logs ────────────────────────────────────────────────

/** The live log plus any rotated siblings `cli/commands/scheduler.ts` (or an
 *  operator) leaves behind, e.g. `scheduler-stderr.legacy-cb-20260902.log` —
 *  each one, non-empty, is its own finding: a rotation doesn't stop the file
 *  from being every box's stderr in one place. */
const SCHEDULER_STDERR_RE = /^scheduler-stderr.*\.log$/;

export async function checkSharedLogs(homeDir: string): Promise<HostFinding[]> {
  const stateDir = path.join(homeDir, ".local", "share", "beebox");
  const findings: HostFinding[] = [];
  for (const name of await listEntryNames(stateDir)) {
    if (!SCHEDULER_STDERR_RE.test(name)) continue;
    const logPath = path.join(stateDir, name);
    const stat = await statOrNull(logPath);
    if (stat === null || !stat.isFile() || stat.size === 0) continue;
    findings.push({
      path: logPath,
      message: "aggregates stderr from every box's scheduled runs; may carry one box's content readable to any box process",
    });
  }
  return findings;
}

// ─── check: per-cwd keying ──────────────────────────────────────────────

/**
 * Duplicates `encodeProjectDir` from
 * `beebox/src/core/chat/session/transcript-paths.ts:34` on purpose — see this
 * file's header. Keep in sync by hand; a doctest for the real function is
 * the source of truth, this is a read-only audit of its output on disk.
 */
function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^\dA-Za-z]/g, "-");
}

async function listDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (_e) {
    return [];
  }
}

/**
 * Which box roots a given encoded-project-dir name could belong to: an exact
 * match of `encode(root)`, or a prefix match `encode(root) + "-"` (a
 * landmark-bound chat's cwd is a subdirectory of the box root, so its encoded
 * name extends the box's own encoded prefix).
 */
function boxesForEncodedName(name: string, boxes: BoxRoot[]): BoxRoot[] {
  return boxes.filter((box) => {
    const encoded = encodeProjectDir(box.root);
    return name === encoded || name.startsWith(`${encoded}-`);
  });
}

async function checkProjectsRoot(dir: string, boxes: BoxRoot[]): Promise<HostFinding[]> {
  const findings: HostFinding[] = [];
  for (const name of await listDirNames(dir)) {
    const owners = boxesForEncodedName(name, boxes);
    if (owners.length > 1) {
      const slugs = owners.map((b) => b.slug).join(", ");
      findings.push({
        path: path.join(dir, name),
        message: `encoded project dir matches more than one box root (${slugs}) — a nested or prefix-colliding box root`,
      });
    }
  }
  return findings;
}

export async function checkPerCwdKeying(homeDir: string, boxes: BoxRoot[]): Promise<HostFinding[]> {
  const dirs = new Set<string>([
    path.join(homeDir, ".claude", "projects"),
    path.join(os.tmpdir(), `claude-${String(process.getuid?.() ?? "uid")}`),
    `/tmp/claude-${String(process.getuid?.() ?? "uid")}`,
  ]);
  const findings: HostFinding[] = [];
  for (const dir of dirs) findings.push(...(await checkProjectsRoot(dir, boxes)));
  return findings;
}

// ─── check: nested boxes ────────────────────────────────────────────────

/** Whether `a` is a strict path-prefix of `b` (separator-aware — `/box` must
 *  never match `/box-evil`). */
function isStrictPathPrefix(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return ra !== rb && rb.startsWith(ra + path.sep);
}

export function checkNestedBoxes(boxes: BoxRoot[]): HostFinding[] {
  const findings: HostFinding[] = [];
  for (const outer of boxes) {
    for (const inner of boxes) {
      if (outer === inner) continue;
      if (isStrictPathPrefix(outer.root, inner.root)) {
        findings.push({
          path: inner.root,
          message: `nested inside box '${outer.slug}' (${outer.root}) — a path-prefix collision, not just a sibling`,
        });
      }
    }
  }
  return findings;
}

// ─── check: unknown shared files ────────────────────────────────────────

/**
 * `~/.config/beebox/` — writer per entry: `hub.json`/`boxes.json` ←
 * `hub/hub-config-edit.ts`/`core/box/boxes-config.ts`; `hub-state.json` ← the
 * hub's own runtime state; `scheduler.json` ← legacy pre-`boxes.json`
 * manifest, read by `boxes-config.ts`; `secrets.json` ← `core/secrets/store.ts`;
 * `secrets-log/` ← `core/secrets/access-log.ts` (a directory); `tailscale-
 * exposure.json` ← the tailscale exposure-state cache.
 *
 * NOT here: `backups/` (`secrets.json.<timestamp>` snapshots seen on a real
 * machine; grepped `beebox/src` for "backups" and found no writer — an
 * unrelated local-variable name in `core/commands/question-transition.ts`
 * was the only hit). Left unlisted rather than allowlisted on a guess; a
 * human should confirm retired-feature-leftover vs. a writer this sweep missed.
 */
const CONFIG_ALLOWLIST = new Set([
  "hub.json",
  "hub-state.json",
  "boxes.json",
  "scheduler.json",
  "secrets.json",
  "secrets-log",
  "tailscale-exposure.json",
]);

/**
 * `~/.local/share/beebox/` — writer per entry: `origin-id` ← this machine's
 * origin id (`lib/state-dir.ts`'s neighborhood); `push-subscriptions.json` ←
 * `core/push-subscriptions.ts`; `engine-availability.json` ←
 * `core/agent/engine-availability-store.ts`; `scheduler-stderr*.log` ←
 * `cli/commands/scheduler.ts`'s `STDERR_LOG`, matched by
 * {@link SCHEDULER_STDERR_RE} so a rotated sibling isn't reported twice (once
 * here, once by `checkSharedLogs`).
 *
 * NOT here: `scheduler.jsonl`/`scheduler.log`. `core/schedule/scheduler.ts`
 * only writes a PER-BOX `.beebox/scheduler.jsonl`, never a state-dir-level
 * file of that name — a state-dir `scheduler.jsonl`/`scheduler.log` seen on a
 * real machine were last modified 2026-02-24, before `scheduler-stderr.log`
 * existed under its current name: reads as a retired architecture's leftover,
 * not something current code writes. Left unlisted rather than guessed at; a
 * human should confirm these are safe to delete.
 */
const STATE_ALLOWLIST = new Set(["origin-id", "push-subscriptions.json", "engine-availability.json"]);

async function listEntryNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.map((e) => e.name);
  } catch (_e) {
    return [];
  }
}

export async function checkUnknownSharedFiles(homeDir: string): Promise<HostFinding[]> {
  const findings: HostFinding[] = [];
  const configDir = path.join(homeDir, ".config", "beebox");
  for (const name of await listEntryNames(configDir)) {
    if (!CONFIG_ALLOWLIST.has(name)) {
      findings.push({ path: path.join(configDir, name), message: "undocumented shared file" });
    }
  }
  const stateDir = path.join(homeDir, ".local", "share", "beebox");
  for (const name of await listEntryNames(stateDir)) {
    if (STATE_ALLOWLIST.has(name) || SCHEDULER_STDERR_RE.test(name)) continue;
    findings.push({ path: path.join(stateDir, name), message: "undocumented shared file" });
  }
  return findings;
}

// ─── entry point ─────────────────────────────────────────────────────────

export async function auditHost(homeDir: string): Promise<HostFinding[]> {
  const { boxes, findings: manifestFindings } = await loadBoxRoots(homeDir);
  return [
    ...manifestFindings,
    ...(await checkModes(homeDir)),
    ...(await checkSharedLogs(homeDir)),
    ...(await checkPerCwdKeying(homeDir, boxes)),
    ...checkNestedBoxes(boxes),
    ...(await checkUnknownSharedFiles(homeDir)),
  ];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const homeFlagIndex = args.indexOf("--home");
  const homeDir = homeFlagIndex === -1 ? os.homedir() : args[homeFlagIndex + 1];
  if (homeDir === undefined) {
    process.stderr.write("host-audit: --home requires a directory argument\n");
    process.exit(2);
  }
  if (!(await exists(homeDir))) {
    process.stderr.write(`host-audit: --home directory does not exist: ${homeDir}\n`);
    process.exit(2);
  }
  const findings = await auditHost(homeDir);
  for (const finding of findings) console.log(formatFinding(finding));
}

// Only run as a script — the test file imports the functions above directly.
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, "host-audit.ts");
if (isMain) {
  await main();
}
