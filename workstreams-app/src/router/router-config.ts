// The router process's resolved configuration — ports, checkout and state
// directory layout, timeouts, feature flags — plus the handful of primitives
// every other router module needs (the shared logger, `sleep`, and the
// worktree-prefix URL helpers).
//
// Split out of router.ts so router-real-effects.ts, router-proxy.ts,
// router-pages.ts, and router-dispatch.ts can each depend on the configuration
// without depending on each other or on router.ts (which would be a cycle).
// Reading this module has no side effects beyond resolving paths.

import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

export const ROUTER_PORT = Number(process.env.ROUTER_PORT) || 3210;
// This module lives at <repo>/workstreams-app/src/router/. Keep the repository
// anchor explicit because launch paths, the favicon, and agent-browser all
// depend on it rather than on the process cwd.
export const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..", "..");
// Where /main/ is served from. Defaults to the canonical checkout so that a
// router started from a worktree (e.g. while iterating on router.ts itself)
// still serves real-main at /main/, not the worktree's stale snapshot of main.
// Override with BBX_MAIN_ROOT for non-standard layouts. Git's common directory
// names the stable main checkout even when this router code is running from a
// linked worktree; deriving it also survives a product rename that does not
// immediately rename the boxholder's physical checkout directory.
export function resolveMainRoot(input: {
  repoRoot: string;
  override?: string | undefined;
  commonDir?: string | undefined;
}): string {
  const { repoRoot, override, commonDir } = input;
  if (override) return override;
  if (commonDir) return path.dirname(path.resolve(repoRoot, commonDir));
  return repoRoot;
}

function gitCommonDir(repoRoot: string): string | undefined {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    void error;
    return undefined;
  }
}

export const MAIN_ROOT = resolveMainRoot({
  repoRoot: REPO_ROOT,
  override: process.env.BBX_MAIN_ROOT,
  commonDir: gitCommonDir(REPO_ROOT),
});
export function resolveWorktreesRoot(mainRoot: string): string {
  const mainName = path.basename(mainRoot);
  const familyName = mainName.endsWith("-box") ? mainName.slice(0, -4) : mainName;
  return path.join(path.dirname(mainRoot), `${familyName}-worktrees`);
}
export const WORKTREES_ROOT = resolveWorktreesRoot(MAIN_ROOT);
export const BOXES_ROOT = path.join(os.homedir(), "src", "box-worktrees");
// Overridable so a second router can run isolated (tests, dev on the router
// itself) without fighting the live one over pid files and port state.
export const STATE_DIR = process.env.BBX_STATE_DIR || path.join(os.homedir(), ".cache", "beebox");
export const LOG_DIR = path.join(STATE_DIR, "logs");
export const PID_DIR = path.join(STATE_DIR, "pids");
export const BROWSE_DIR = path.join(STATE_DIR, "browse");
export const ROUTER_PID_FILE = path.join(STATE_DIR, "router.pid");
// The local trust boundary (plan Track B): a SECOND listener on a Unix-domain
// socket. Requests arriving on it are `trustedLocal` (unauthenticated) because a
// browser cannot originate a UDS connection — a real capability boundary, not a
// spoofable header. Local CLI (bin/workstreams) talks to the router through this;
// everything on the TCP listener (which Tailscale Serve fronts) must authenticate.
export const ROUTER_SOCK = path.join(STATE_DIR, "router.sock");

// Verbose worktree-lifecycle logging (e.g. WS-upgrade refusals to idle-stopped
// worktrees — designed behavior, not anomalies, so silent by default).
export const ROUTER_DEBUG = process.env.BBX_ROUTER_DEBUG === "1";

export const AGENT_BROWSER_BIN = path.join(REPO_ROOT, "node_modules", "agent-browser", "bin", "agent-browser.js");

// The /dev/ space: a place the *dev-repo agent* (Claude Code, not a box) builds
// things for you to view in the browser — HTML visualizations, rendered
// Markdown reports, data displays. Served from the tracked dev/ directory
// (committed, unlike the gitignored scratch/), so these views are kept.
// Exported (rather than the old `void DEV_ROOT` landmark) so the name has a
// real consumer if one ever wants it; the /dev/ serving itself resolves the
// directory per worktree in router-docs.ts.
export const DEV_ROOT = path.join(REPO_ROOT, "dev");

export const IDLE_TIMEOUT_MS = Number(process.env.ROUTER_IDLE_MS) || 5 * 60 * 1000;
export const KILL_GRACE_MS = 2000;

// Boxholder directive (2026-07-04): each worktree's backend is now a
// per-worktree `bbx hub` (lazy: true, idleMs matching IDLE_TIMEOUT_MS above)
// instead of one `server-main.ts` Fastify process serving every box in the
// worktree's BOXES list. This gives each BOX its own process, lazily
// started and idle-collected — the same semantics this router already gives
// whole worktrees — composing cleanly with the router's own lazy/idle
// worktree layer: the router still lazy-starts/idle-stops the WORKTREE
// (vite + hub), and the hub now separately lazy-starts/idle-stops each BOX
// within it. One release of insurance while this beds in: BBX_DEV_NO_HUB=1
// reverts to spawning server-main.ts directly, the old one-process-many-
// boxes shape (Track G's prior escape hatch). Delete this flag once the
// hub path has proven itself — tracked in docs/implemented-plans/boxes-as-packages-v2.md.
export const DEV_NO_HUB = process.env.BBX_DEV_NO_HUB === "1";
export const HUB_CONFIG_DIR = path.join(STATE_DIR, "hub-configs");

export const MAIN_BOX_DEFAULTS = [
  path.join(os.homedir(), "src", "boxes", "test1"),
];

// Per-worktree, just like the box apps: /<name>/dev/ serves <name>'s checkout —
// its tracked dev/ directory (artifacts) and a markdown doc browser over its own
// .md files. Served straight from disk, so it never cold-starts the worktree.
export function worktreeRoot(name: string): string {
  return name === "main" ? MAIN_ROOT : path.join(WORKTREES_ROOT, name);
}

/** Every router module logs through this one line format. */
export function log(msg: string): void {
  console.log(`[router ${new Date().toISOString()}] ${msg}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** The first path segment of a request URL — the worktree prefix — or null. */
export function parseWorktreeName(reqPath: string): string | null {
  const m = reqPath.match(/^\/([^#/?]+)(?:[#/?]|$)/);
  return m ? m[1]! : null;
}
