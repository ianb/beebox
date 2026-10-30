/** Catch up configured backups while a direct local or Docker box is serving. */
import { spawn } from "node:child_process";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { errnoCode } from "../../shared/error-guards.js";

const BACKUP_POLL_MS = 15 * 60 * 1000;
const CHILD_SHUTDOWN_MS = 5_000;
let activeRunners = 0;
let activeCommands = 0;
let serverRunner: LocalBackupRunner | null = null;

export interface LocalBackupRunner {
  stop(): Promise<void>;
}

/** Whether this server process currently owns a local catch-up runner. */
export function localBackupRunnerActive(): boolean {
  return activeRunners > 0;
}

/** A due check or capture must finish before the serving process idles out. */
export function localBackupCommandActive(): boolean {
  return activeCommands > 0;
}

/** Start the runner for supported server installs. */
export function startLocalBackupRunnerForServer({ boxRoots, unitHost, installKind }: {
  boxRoots: string[];
  unitHost: boolean;
  installKind: string | undefined;
}): void {
  if (unitHost || installKind === "mac-app") return;
  serverRunner = startLocalBackupRunner({ boxRoots });
}

/** Stop the server-owned runner during graceful shutdown. */
export async function stopLocalBackupRunnerForServer(): Promise<void> {
  await serverRunner?.stop();
  serverRunner = null;
}

/**
 * Start an unref'ed poll. The CLI owns due checks, quiet waiting, maintenance
 * admission, and Restic execution; this module only launches the command.
 */
export function startLocalBackupRunner(options: {
  boxRoots: string[];
  intervalMs?: number;
  runScheduled?: (boxRoot: string, signal: AbortSignal) => Promise<void>;
}): LocalBackupRunner | null {
  const { boxRoots } = options;
  const intervalMs = options.intervalMs ?? BACKUP_POLL_MS;
  const runScheduled = options.runScheduled ?? runScheduledBackup;
  if (boxRoots.length === 0) return null;
  const controller = new AbortController();
  let stopped = false;
  const activeRuns = new Set<Promise<void>>();
  activeRunners += 1;

  const poll = async (): Promise<void> => {
    for (const boxRoot of boxRoots) {
      if (controller.signal.aborted) return;
      activeCommands += 1;
      const run = Promise.resolve().then(() => runScheduled(boxRoot, controller.signal)).catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(`Scheduled backup runner failed for ${boxRoot}:`, error);
      });
      activeRuns.add(run);
      try { await run; }
      finally { activeRuns.delete(run); activeCommands -= 1; }
    }
  };

  let timeout: NodeJS.Timeout | undefined;
  const scheduleNext = (): void => {
    if (stopped) return;
    timeout = setTimeout(() => { void poll().finally(scheduleNext); }, intervalMs);
    timeout.unref();
  };
  // The first pass catches up after restart. Its timer does not prevent idle
  // exit when no backup subprocess is running.
  void poll().finally(scheduleNext);

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (timeout) clearTimeout(timeout);
      controller.abort();
      await Promise.all([...activeRuns]);
      activeRunners -= 1;
    },
  };
}

async function runScheduledBackup(boxRoot: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const cliPath = path.join(PACKAGE_ROOT, "dist", "cli.mjs");
  const child = spawn(process.execPath, ["--disable-warning=DEP0040", "--enable-source-maps", cliPath, "engine", "backup", "run", boxRoot, "--scheduled"], {
    cwd: boxRoot,
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
  });
  let exited = false;
  let killTimer: NodeJS.Timeout | undefined;
  const terminate = (): void => {
    if (child.pid === undefined || exited) return;
    try { process.kill(-child.pid, "SIGTERM"); }
    catch (error) { if (errnoCode(error) !== "ESRCH") console.error("Could not stop scheduled backup process group:", error); }
    killTimer = setTimeout(() => {
      if (child.pid !== undefined && !exited) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (errnoCode(error) !== "ESRCH") console.error("Could not kill scheduled backup process group:", error); }
      }
    }, CHILD_SHUTDOWN_MS);
    killTimer.unref();
  };
  signal.addEventListener("abort", terminate, { once: true });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (!signal.aborted && code !== 0) console.error(`Scheduled backup command exited with status ${code ?? "unknown"} for ${boxRoot}.`);
  } finally {
    exited = true;
    if (killTimer) clearTimeout(killTimer);
    signal.removeEventListener("abort", terminate);
  }
}
