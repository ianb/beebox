/**
 * The deployment controller: keep every box closed across the activation
 * command and the service restart it performs, then reopen the boxes the hub
 * verifies. Runs as root on the server (`deploy/deploy.sh`), or as the box
 * owner in development and tests.
 *
 * The boxes are grouped by owner and each group is closed by a holder
 * (`hold.ts`) spawned as that owner: root never writes a gate file, and a box
 * user never runs the activation. The controller collects the holders'
 * permits into `BBX_MAINTENANCE_PERMITS` for the activation command, runs it
 * with its own privilege, verifies each box (phase `ready`, and the hub canary
 * when `verifyHub` is set), and tells each holder which of its boxes to
 * complete. A host with no box at all just runs the command.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { z } from "zod";
import { defaultHubConfigPath, loadHubConfig } from "../../../hub/config.js";
import { boxMaintenanceStatus } from "../../../lib/box-maintenance/admission.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { invariant } from "../../../shared/invariant.js";
import { holderReportSchema, holderVerdictSchema } from "./hold.js";

/** The holder's stdout closed before it reported its permits. */
class HolderExitedEarlyError extends Error {
  constructor(roots: readonly string[]) {
    super(`holder for ${roots.join(", ")} exited before closing its boxes`);
    this.name = "HolderExitedEarlyError";
  }
}

export interface MaintenanceInvocation {
  command: string;
  args: string[];
  /** Hub origin for the per-box canary; absent, the command's exit code verifies every box. */
  verifyHub?: string;
  /** The hub's config file for the canary's slug lookup; default `~/.config/beebox/hub.json` of this process's user. */
  hubConfig?: string;
  /** How to start a holder: the running CLI by default (`node <execArgv> <argv[1]>`); a test names the source entry. */
  cli?: readonly string[];
}

interface OwnerGroup { uid: number; gid: number; roots: string[] }

async function groupByOwner(roots: readonly string[]): Promise<OwnerGroup[]> {
  const groups = new Map<string, OwnerGroup>();
  for (const root of roots) {
    const { uid, gid } = await stat(root);
    const key = `${uid}:${gid}`;
    const group = groups.get(key) ?? { uid, gid, roots: [] };
    group.roots.push(root);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The home directory of `uid`, from the passwd database; the controller's own when unknown. */
function homeOf(uid: number): string | undefined {
  try {
    const entry = execFileSync("getent", ["passwd", String(uid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return entry.split(":")[5] || process.env.HOME;
  } catch (_e) {
    return process.env.HOME;
  }
}

interface Holder { child: ChildProcess; roots: string[]; permits: Promise<Record<string, string>>; exit: Promise<number> }

function startHolder(group: OwnerGroup, opts: { cli: readonly string[]; asRoot: boolean }): Holder {
  const [command, ...prefix] = opts.cli;
  invariant(command, "Maintenance needs a CLI to start a holder with");
  const identity = opts.asRoot && group.uid !== 0 ? { uid: group.uid, gid: group.gid, env: { ...process.env, HOME: homeOf(group.uid) } } : {};
  const child = spawn(command, [...prefix, "engine", "maintenance", "hold", ...group.roots], {
    stdio: ["pipe", "pipe", "inherit"], ...identity,
  });
  const exit = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  invariant(child.stdout, "holder stdout is piped");
  const lines = createInterface({ input: child.stdout });
  const permits = new Promise<Record<string, string>>((resolve, reject) => {
    lines.once("line", (line) => { try { resolve(holderReportSchema.parse(JSON.parse(line)).permits); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); } });
    lines.once("close", () => reject(new HolderExitedEarlyError(group.roots)));
  });
  // A rejection nobody awaits yet must not crash the controller; the awaiting below reports it.
  permits.catch(() => {});
  return { child, roots: group.roots, permits, exit };
}

function runCommand(invocation: MaintenanceInvocation, env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(invocation.command, invocation.args, { stdio: "inherit", detached: true, env });
  const stop = (signal: NodeJS.Signals): void => {
    const pid = child.pid;
    if (pid !== undefined && child.exitCode === null) process.kill(-pid, signal);
  };
  const interrupt = (): void => { stop("SIGINT"); };
  const terminate = (): void => { stop("SIGTERM"); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode ?? 1));
  }).finally(() => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  });
}

export async function runMaintenance(roots: string[], invocation: MaintenanceInvocation): Promise<number> {
  const boxes = [...new Set(await Promise.all(roots.map((root) => realpath(root))))].toSorted();
  if (boxes.length === 0) return runCommand(invocation, process.env);
  const euid = process.geteuid?.();
  invariant(euid !== undefined, "Maintenance requires POSIX user identities");
  const groups = await groupByOwner(boxes);
  invariant(euid === 0 || groups.every((group) => group.uid === euid), "Maintenance must run as the box owner or root");
  const cli = invocation.cli ?? [process.execPath, ...process.execArgv, process.argv[1] ?? ""];
  const holders = groups.map((group) => startHolder(group, { cli, asRoot: euid === 0 }));
  let code = 1;
  try {
    const permits: Record<string, string> = {};
    for (const holder of holders) Object.assign(permits, await holder.permits);
    code = await runCommand(invocation, { ...process.env, BBX_MAINTENANCE_PERMITS: JSON.stringify(permits) });
    const verified: string[] = [];
    for (const root of boxes) {
      try {
        const ready = (await boxMaintenanceStatus(root))?.phase === "ready";
        if (ready && (invocation.verifyHub ? await verifyHubBox(root, { origin: invocation.verifyHub, hubConfig: invocation.hubConfig }) : code === 0)) verified.push(root);
        else { console.error(`Box not verified; it reopens with unfinished maintenance: ${root}`); code = 1; }
      } catch (error) {
        console.error(`Box verification failed for ${root}: ${errorMessage(error)}`);
        code = 1;
      }
    }
    for (const holder of holders) {
      holder.child.stdin?.end(`${JSON.stringify(holderVerdictSchema.parse({ complete: verified.filter((root) => holder.roots.includes(root)) }))}\n`);
    }
  } catch (error) {
    console.error(`Maintenance did not reach activation: ${errorMessage(error)}`);
    code = 1;
  } finally {
    for (const holder of holders) {
      if (!holder.child.stdin?.writableEnded) holder.child.stdin?.end();
      try { if ((await holder.exit) !== 0) code = 1; } catch (error) { console.error(`Holder failed: ${errorMessage(error)}`); code = 1; }
    }
  }
  return code;
}

/** Global deploy failure does not invalidate a separately verified ready box. */
async function verifyHubBox(root: string, hub: { origin: string; hubConfig: string | undefined }): Promise<boolean> {
  try {
    const key = process.env.BBX_DIAG_API_KEY;
    invariant(key, "Per-box deployment verification requires BBX_DIAG_API_KEY");
    const config = await loadHubConfig(hub.hubConfig ?? defaultHubConfigPath());
    let slug: string | undefined;
    for (const [name, entry] of Object.entries(config.boxes)) {
      if (await realpath(entry.path) === root) { slug = name; break; }
    }
    invariant(slug, `No hub entry for maintenance box ${root}`);
    const url = new URL("/healthz/canary", hub.origin);
    url.searchParams.set("box", slug);
    const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(45000) });
    const result = z.object({ status: z.literal("ok"), slug: z.string() }).safeParse(await response.json());
    return response.ok && result.success && result.data.slug === slug;
  } catch (error) {
    console.error(`Box verification failed for ${root}: ${errorMessage(error)}`);
    return false;
  }
}
