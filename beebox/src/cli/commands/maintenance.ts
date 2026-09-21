/** Keep deployment ownership alive across activation and service replacement. */
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { Command } from "commander";
import { z } from "zod";
import { defaultHubConfigPath, loadHubConfig } from "../../hub/hub-config.js";
import { errorMessage } from "../../lib/error-guards.js";
import {
  closeBoxMaintenance, boxMaintenanceStatus, boxWorkEnvironment, type BoxMaintenance,
} from "../../lib/box-maintenance.js";
import { captureMigrationSnapshot } from "../../core/migration-recovery.js";
import { invariant } from "../../lib/invariant.js";

/** Root deployment scripts retain privilege; gate files belong to the box user. */
async function boxIdentity(roots: string[]): Promise<() => void> {
  const owners = await Promise.all(roots.map((root) => stat(root)));
  const first = owners[0];
  invariant(first, "Maintenance requires at least one box");
  invariant(owners.every((owner) => owner.uid === first.uid && owner.gid === first.gid), "Fleet maintenance requires one box owner");
  const { geteuid, getegid, seteuid, setegid } = process;
  invariant(geteuid && getegid && seteuid && setegid, "Maintenance requires POSIX user identities");
  const uid = geteuid();
  const gid = getegid();
  if (uid !== 0) {
    invariant(uid === first.uid, "Maintenance must run as the box owner or root");
    return () => {};
  }
  setegid(first.gid);
  seteuid(first.uid);
  return () => { seteuid(uid); setegid(gid); };
}

export async function runMaintenance(roots: string[], invocation: { command: string; args: string[]; verifyHub?: string }): Promise<number> {
  const boxes = [...new Set(await Promise.all(roots.map((root) => realpath(root))))].toSorted();
  const originalUid = process.geteuid?.();
  const originalGid = process.getegid?.();
  const originalHome = process.env.HOME;
  const restoreIdentity = await boxIdentity(boxes);
  if (originalUid === 0) process.env.HOME = userInfo().homedir;
  const ownerUid = process.geteuid?.();
  const ownerGid = process.getegid?.();
  const held: { root: string; handle: BoxMaintenance }[] = [];
  const completed = new Set<string>();
  try {
    for (const root of boxes) held.push({ root, handle: await closeBoxMaintenance(root, { reason: "deployment" }) });
    for (const { handle } of held) await handle.drain();
    for (const { root, handle } of held) {
      const snapshot = await handle.run(() => captureMigrationSnapshot(root, "deployment"));
      console.log(`Deployment recovery snapshot: ${root} ${snapshot.ref}`);
    }
    for (const { handle } of held) await handle.beginChanges();
    const permits = Object.fromEntries(held.map(({ root, handle }) => [root, handle.run(boxWorkEnvironment).BBX_BOX_WORK]));
    // No await in this privileged span. Only the trusted external deployment
    // command gets root; locks, heartbeat callbacks and cleanup use box identity.
    const privileged = <T>(fn: () => T): T => {
      try {
        if (originalUid === 0) {
          process.seteuid?.(0);
          process.setegid?.(originalGid ?? 0);
        }
        return fn();
      } finally {
        if (originalUid === 0) {
          process.setegid?.(ownerGid ?? 0);
          process.seteuid?.(ownerUid ?? 0);
        }
      }
    };
    const child = privileged(() => spawn(invocation.command, invocation.args, {
      stdio: "inherit", detached: true,
      env: { ...process.env, HOME: originalHome, BBX_MAINTENANCE_PERMITS: JSON.stringify(permits) },
    }));
    const stop = (signal: NodeJS.Signals): void => {
      const pid = child.pid;
      if (pid !== undefined && child.exitCode === null) privileged(() => process.kill(-pid, signal));
    };
    const interrupt = (): void => { stop("SIGINT"); };
    const terminate = (): void => { stop("SIGTERM"); };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    let code: number;
    try {
      code = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode) => resolve(exitCode ?? 1));
      });
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
    const globalSuccess = code === 0;
    for (const { root, handle } of held) {
      try {
        const ready = (await boxMaintenanceStatus(root))?.phase === "ready";
        if (ready && (invocation.verifyHub ? await verifyHubBox(root, invocation.verifyHub) : globalSuccess)) {
          await handle.complete();
          completed.add(root);
        } else {
          console.error(`Box remains closed for recovery: ${root}`);
          code = 1;
        }
      } catch (error) {
        console.error(`Box verification failed for ${root}: ${errorMessage(error)}`);
        code = 1;
      }
    }
    return code;
  } finally {
    try {
      for (const { root, handle } of held.toReversed()) {
        if (completed.has(root)) continue;
        try {
          // Ready is a promise backed by a live owner, never a failed terminal state.
          if ((await boxMaintenanceStatus(root))?.phase === "ready") await handle.beginChanges();
        } finally { await handle.release(); }
      }
    }
    finally {
      restoreIdentity();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  }
}

export const maintenanceCommand = new Command("maintenance")
  .description("Hold box maintenance across a trusted deployment command")
  .requiredOption("--box <path>", "Box root (repeat for a fleet)", (value: string, previous: string[]) => [...previous, value], [])
  .option("--verify-hub <origin>", "Verify each ready box through the hub canary before reopening")
  .argument("<command...>")
  .action(async (commandArgs: string[], options: { box: string[]; verifyHub?: string }) => {
    const [command, ...args] = commandArgs;
    invariant(command, "Maintenance requires a command");
    process.exitCode = await runMaintenance(options.box, { command, args, ...(options.verifyHub ? { verifyHub: options.verifyHub } : {}) });
  });

/** Global deploy failure does not invalidate a separately verified ready box. */
async function verifyHubBox(root: string, origin: string): Promise<boolean> {
  try {
    const key = process.env.BBX_DIAG_API_KEY;
    invariant(key, "Per-box deployment verification requires BBX_DIAG_API_KEY");
    const config = await loadHubConfig(defaultHubConfigPath());
    let slug: string | undefined;
    for (const [name, entry] of Object.entries(config.boxes)) {
      if (await realpath(entry.path) === root) { slug = name; break; }
    }
    invariant(slug, `No hub entry for maintenance box ${root}`);
    const url = new URL("/healthz/canary", origin);
    url.searchParams.set("box", slug);
    const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(45000) });
    const result = z.object({ status: z.literal("ok"), slug: z.string() }).safeParse(await response.json());
    return response.ok && result.success && result.data.slug === slug;
  } catch (error) {
    console.error(`Box verification failed for ${root}: ${errorMessage(error)}`);
    return false;
  }
}
