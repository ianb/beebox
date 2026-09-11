// The REAL implementations of the effects the worktree lifecycle engine
// (router-core.ts) is injected with: worktree/box resolution from the checkout
// layout, the hub config file, process spawning and group-killing, HTTP
// readiness probing, timers, the clock, and the backend source token. Plus the
// startup sweep that reclaims children a crashed router left behind.
//
// Split out of router.ts so that file holds the server and boot sequence only.
// Constructed by `main()`, never at module scope: importing this module starts
// nothing and allocates nothing.
//
// The worktree lifecycle model lives in ./router-lifecycle.ts; the engine that
// drives it lives in ./router-core.ts.

import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import getPorts from "get-port";
import { resolveBoxEntries, type ResolvedBoxEntry } from "./box-entry.js";
import { createPidStore, type PidRecord } from "./router-pidfile.js";
import type { TimerHandle } from "./router-lifecycle.js";
import { errMessage, errnoCode, type RouterEffects, type ResolvedWorktree } from "./router-effects.js";
import {
  BOXES_ROOT,
  HUB_CONFIG_DIR,
  IDLE_TIMEOUT_MS,
  MAIN_BOX_DEFAULTS,
  MAIN_ROOT,
  PID_DIR,
  WORKTREES_ROOT,
  log,
  sleep,
} from "./router-config.js";

export async function resolveWorktree(name: string): Promise<ResolvedWorktree | null> {
  if (name === "main") {
    return {
      name: "main",
      root: MAIN_ROOT,
      backendCwd: path.join(MAIN_ROOT, "beebox"),
      frontendCwd: path.join(MAIN_ROOT, "beebox", "src", "frontend"),
      boxes: (await readBoxes(path.join(MAIN_ROOT, "beebox", ".env"))) ?? MAIN_BOX_DEFAULTS,
    };
  }
  const root = path.join(WORKTREES_ROOT, name);
  try {
    await fs.access(root);
  } catch (_e) {
    // No such directory — an unknown worktree name, not an error.
    return null;
  }
  const envPath = path.join(root, "beebox", ".env");
  const boxes = await readBoxes(envPath);
  return {
    name,
    root,
    backendCwd: path.join(root, "beebox"),
    frontendCwd: path.join(root, "beebox", "src", "frontend"),
    boxes: boxes ?? [path.join(BOXES_ROOT, name, "test1")],
  };
}

async function readBoxes(envPath: string): Promise<string[] | null> {
  try {
    const text = await fs.readFile(envPath, "utf8");
    const line = text.split("\n").find((l) => l.startsWith("BOXES="));
    if (!line) return null;
    return line.slice("BOXES=".length).trim().split(/\s+/).filter(Boolean);
  } catch (_e) {
    // No .env in this checkout (or unreadable) — fall back to the defaults.
    return null;
  }
}

/**
 * Generate this worktree's `hub.json`, written fresh on every (re)start
 * (single-slot per worktree, like the pidfile) so a `BOXES=` edit in the
 * worktree's `.env` or a resolved-slug change always takes effect on the
 * next cold start. `port` is the worktree's own dynamically-assigned
 * `backendPort` — Vite's `vite.config.ts` proxies `/<box>/api/...` etc. to
 * `http://localhost:BACKEND_PORT`, and the hub's own routing composes with
 * that unchanged. `lazy: true` + `idleMs: IDLE_TIMEOUT_MS` give each BOX the
 * same lazy-start/idle-collect semantics this router gives each WORKTREE.
 */
/**
 * Delete hub configs whose checkout is gone. The config is written when a
 * worktree starts and nothing removed it when the worktree was culled, so they
 * accumulated — 21 stale files against 17 live checkouts when this was found.
 * Each one names a port that was allocated for a worktree that no longer
 * exists. `main` has no directory under the worktrees root and is never pruned.
 *
 * Best-effort by construction: a config that cannot be read or removed is left
 * alone rather than failing router startup over housekeeping.
 *
 * The two directories are parameters so this is testable against fixtures
 * instead of the developer's real state dir; {@link pruneRouterHubConfigs}
 * supplies the real ones.
 */
export async function pruneOrphanHubConfigs(params: {
  configDir: string;
  worktreesRoot: string;
}): Promise<string[]> {
  const { configDir, worktreesRoot } = params;
  let entries: string[];
  try {
    entries = await fs.readdir(configDir);
  } catch (_e) {
    return []; // No configs yet — nothing to prune.
  }
  const pruned: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.slice(0, -".json".length);
    if (name === "main") continue;
    try {
      await fs.stat(path.join(worktreesRoot, name));
    } catch (_e) {
      try {
        await fs.rm(path.join(configDir, entry));
        pruned.push(name);
      } catch (_rmErr) {
        // Leave it; a config we cannot delete is not worth a startup failure.
      }
    }
  }
  return pruned;
}

/** {@link pruneOrphanHubConfigs} against this router's real directories. */
export async function pruneRouterHubConfigs(): Promise<string[]> {
  return pruneOrphanHubConfigs({ configDir: HUB_CONFIG_DIR, worktreesRoot: WORKTREES_ROOT });
}

async function writeWorktreeHubConfig(params: {
  name: string;
  backendPort: number;
  resolvedBoxes: ResolvedBoxEntry[];
}): Promise<string> {
  const { name, backendPort, resolvedBoxes } = params;
  await fs.mkdir(HUB_CONFIG_DIR, { recursive: true });
  const configPath = path.join(HUB_CONFIG_DIR, `${name}.json`);
  const boxes: Record<string, { path: string }> = {};
  for (const { slug, contentDir } of resolvedBoxes) boxes[slug] = { path: contentDir };
  await fs.writeFile(
    configPath,
    JSON.stringify({ port: backendPort, host: "127.0.0.1", lazy: true, idleMs: IDLE_TIMEOUT_MS, boxes }, null, 2),
  );
  return configPath;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errnoCode(e) === "EPERM";
  }
}

export async function sweepStaleChildren(): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(PID_DIR);
  } catch (_e) {
    // No pid directory yet — nothing a previous router could have left behind.
    return;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const fullPath = path.join(PID_DIR, file);
    let data: Partial<PidRecord>;
    try {
      data = JSON.parse(await fs.readFile(fullPath, "utf8"));
    } catch (_e) {
      // A truncated record from a router that died mid-write — drop it.
      await fs.unlink(fullPath).catch(() => {});
      continue;
    }
    for (const pid of [data.vitePid, data.fastifyPid]) {
      if (typeof pid !== "number") continue;
      if (!pidAlive(pid)) continue;
      log(`sweep: killing leftover pid ${pid} from ${file}`);
      try {
        process.kill(-pid, "SIGTERM");
      } catch (_e) {
        // No process GROUP for that pid (already reaped, or never detached) —
        // fall back to the bare pid.
        try {
          process.kill(pid, "SIGTERM");
        } catch (_bareKillError) {
          /* gone */
        }
      }
    }
    if (typeof data.socketDir === "string") {
      try {
        const dashPidStr = await fs.readFile(path.join(data.socketDir, "dashboard.pid"), "utf8");
        const dashPid = Number.parseInt(dashPidStr.trim(), 10);
        if (Number.isFinite(dashPid) && pidAlive(dashPid)) {
          log(`sweep: killing leftover dashboard pid ${dashPid} from ${file}`);
          try {
            process.kill(dashPid, "SIGTERM");
          } catch (_e) {
            /* gone */
          }
        }
      } catch (_e) {
        /* no dashboard pidfile, fine */
      }
    }
    await fs.unlink(fullPath).catch(() => {});
  }
}

// --- Process supervision effects --------------------------------------
//
// The worktree lifecycle model lives in ./router-lifecycle.ts; the engine that
// drives it lives in ./router-core.ts. THIS section holds the REAL effect
// implementations the engine is injected with — the actual spawning, killing,
// HTTP probes, timers, and clock.

function killGroup(pid: number | undefined, signal?: NodeJS.Signals): void {
  if (!pid) return;
  const sig = signal ?? "SIGTERM";
  try {
    process.kill(-pid, sig);
  } catch (_e) {
    // No process GROUP for that pid (already reaped, or never detached) — fall
    // back to the bare pid.
    try {
      process.kill(pid, sig);
    } catch (_bareKillError) {
      /* gone */
    }
  }
}

// HTTP-level readiness probe. TCP listening is not enough — a process can
// accept connections before its request handlers are wired up.
class HttpReadinessTimeoutError extends Error {
  constructor({ label, reqPath, timeoutMs }: { label: string; reqPath: string; timeoutMs: number }) {
    super(`${label} did not respond to HTTP GET ${reqPath} within ${timeoutMs}ms`);
    this.name = "HttpReadinessTimeoutError";
  }
}

async function waitForHttp(
  port: number,
  { reqPath, timeoutMs, label }: { reqPath: string; timeoutMs: number; label: string },
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: reqPath, method: "GET", timeout: 1000 },
        (res) => {
          res.resume();
          resolve(true);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (ok) return;
    await sleep(150);
  }
  throw new HttpReadinessTimeoutError({ label, reqPath, timeoutMs });
}

/**
 * A token for the backend source a checkout would run: the newest mtime seen
 * while walking `beebox/src`, plus the entry count.
 *
 * Why not the git commit, which was the first idea: the hub is spawned as
 * `node --import tsx ./src/cli/index.ts hub` and therefore executes the
 * TypeScript on disk. `HEAD` misses an uncommitted edit entirely and moves for
 * commits touching nothing the hub loads. Filesystem state is what the hub
 * actually reads, so filesystem state is what the token is made of.
 *
 * `src/frontend` is excluded: Vite owns that half and hot-reloads it, so a
 * frontend edit is not a stale backend. Directory mtimes count too, which is
 * what makes a pure deletion visible, and `beebox/package.json` is folded
 * in so a dependency change with no `src/` edit is not invisible.
 *
 * `null` on any failure — a checkout with no `beebox/` is a legitimate
 * shape here, and a token that cannot be computed must disable the comparison
 * rather than fabricate a mismatch.
 */
async function backendSourceToken(root: string): Promise<string | null> {
  const srcRoot = path.join(root, "beebox", "src");
  let newest = 0;
  let entries = 0;
  async function walk(dir: string): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    const stat = await fs.stat(dir);
    newest = Math.max(newest, stat.mtimeMs);
    for (const item of items) {
      if (item.name === "node_modules" || item.name === "frontend") continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
        continue;
      }
      entries += 1;
      const st = await fs.stat(full);
      newest = Math.max(newest, st.mtimeMs);
    }
  }
  try {
    await walk(srcRoot);
    // The hub's dependencies are as much a part of what it loaded as its own
    // source: a package bump that lands with no `src/` change would otherwise
    // leave a stale generation looking current.
    const pkg = await fs.stat(path.join(root, "beebox", "package.json"));
    newest = Math.max(newest, pkg.mtimeMs);
    entries += 1;
  } catch (_e) {
    // No beebox/src in this checkout, or an unreadable tree — a token
    // that cannot be computed must disable the comparison, not fake a mismatch.
    return null;
  }
  return `${Math.round(newest)}:${entries}`;
}

/**
 * Build the real effects the router core runs on. Constructed in `main()` (not
 * at module scope) so importing this file is side-effect-free — no timers, no
 * pidfile-store map, no port allocation happen until the router is actually run.
 */
export function createRealEffects(): RouterEffects {
  const pidStore = createPidStore(PID_DIR);
  return {
    spawn: (command, { args, options }) => execa(command, args, options),
    killGroup,
    pidAlive,
    waitForHttp,
    setTimer: (ms, fn): TimerHandle => {
      const t = setTimeout(() => {
        try {
          fn();
        } catch (err) {
          // A throwing escalation/idle callback must never crash the router.
          console.error(`[router] timer callback threw: ${errMessage(err)}`);
        }
      }, ms);
      // Escalation and idle timers must not keep the process alive on their own.
      t.unref();
      return { cancel: () => clearTimeout(t) };
    },
    clearTimer: (handle) => handle.cancel(),
    now: () => Date.now(),
    sleep,
    pidStore,
    writeHubConfig: writeWorktreeHubConfig,
    getPort: () => getPorts(),
    resolveWorktree,
    resolveBoxEntries,
    sourceToken: backendSourceToken,
  };
}
