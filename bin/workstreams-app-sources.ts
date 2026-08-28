// What counts as an app source change, and the two ways the supervisor learns
// about one: an fs watcher, and a periodic fingerprint that covers whatever the
// watcher missed. Split out of workstreams-app-supervisor.ts as a pure move.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { watch as watchFs, type FSWatcher } from "node:fs";
import path from "node:path";
import {
  clearTimer,
  errorMessage,
  type WorkstreamsAppEffects,
  type WorkstreamsAppTimer,
  type WorkstreamsAppWatch,
} from "./workstreams-app-contract.js";

const WATCH_IGNORED_DIRS = new Set([
  ".cache",
  ".git",
  ".tap",
  "dist",
  "node_modules",
  "test",
]);

export function shouldRestartWorkstreamsBackend(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/").replace(/^\.\//, "");
  const first = normalized.split("/")[0] ?? normalized;
  if (WATCH_IGNORED_DIRS.has(first)) return false;
  return !(normalized === "src/frontend" || normalized.startsWith("src/frontend/"));
}

async function fingerprintFiles(root: string, relative?: string): Promise<string[]> {
  const from = relative ?? "";
  const dir = path.join(root, from);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (from === "" && error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && WATCH_IGNORED_DIRS.has(entry.name)) continue;
    const child = path.join(from, entry.name);
    if (!shouldRestartWorkstreamsBackend(child)) continue;
    if (entry.isDirectory()) files.push(...await fingerprintFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function fingerprintWorkstreamsApp(appRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const files = (await fingerprintFiles(appRoot)).toSorted();
  if (files.length === 0) hash.update("missing-or-empty");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(appRoot, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function createRealWatcher(
  appRoot: string,
  { onChange, onError }: { onChange: (relativePath: string | null) => void; onError: (error: Error) => void },
): FSWatcher {
  const watcher = watchFs(appRoot, { recursive: true }, (_event, filename) => {
    onChange(filename === null ? null : filename.toString());
  });
  watcher.on("error", onError);
  return watcher;
}

export interface SourceWatch {
  /** Start watching, and arm the periodic fingerprint reconciliation. */
  install(): void;
  /** One fingerprint pass: request a restart when the sources moved. */
  reconcile(): Promise<void>;
  close(): void;
}

export function createSourceWatch(options: {
  effects: WorkstreamsAppEffects;
  appRoot: string;
  log: (message: string) => void;
  reconcileMs: number;
  requestRestart: (reason: string) => void;
}): SourceWatch {
  let watcher: WorkstreamsAppWatch | null = null;
  let reconcileTimer: WorkstreamsAppTimer | null = null;
  let lastFingerprint: string | null = null;

  async function reconcile(): Promise<void> {
    try {
      const next = await options.effects.fingerprint(options.appRoot);
      if (lastFingerprint !== null && next !== lastFingerprint) {
        options.requestRestart("source fingerprint changed");
      }
      lastFingerprint = next;
    } catch (error) {
      options.log(`[workstreams-app] source fingerprint failed: ${errorMessage(error)}`);
    }
  }

  return {
    install(): void {
      if (watcher) return;
      try {
        watcher = options.effects.watch(options.appRoot, {
          onChange: (relativePath) => {
            if (relativePath === null || shouldRestartWorkstreamsBackend(relativePath)) {
              options.requestRestart(relativePath ? `source changed: ${relativePath}` : "source changed");
            }
          },
          onError: (error) =>
            options.log(`[workstreams-app] source watcher failed; periodic reconciliation remains active: ${error.message}`),
        });
      } catch (error) {
        options.log(`[workstreams-app] source watcher unavailable; periodic reconciliation remains active: ${errorMessage(error)}`);
      }
      reconcileTimer = options.effects.setInterval(options.reconcileMs, () => void reconcile());
    },
    reconcile,
    close(): void {
      watcher?.close();
      watcher = null;
      reconcileTimer = clearTimer(reconcileTimer);
    },
  };
}
