/**
 * The private network namespace a unit host runs the browser host in
 * (docs/plans/shared-browser.md, Track F; verified in
 * research/embedded-browser/linux-verification.md).
 *
 * agent-browser's dashboard, stream and Chrome debugging ports are loopback
 * TCP with no authentication for loopback callers, so on a shared host every
 * other box user could drive this box's browser. Inside its own network
 * namespace those ports are reachable only through the relay socket.
 *
 * The order is fixed by what failed on Ubuntu 24.04. pasta spawning the
 * command itself leaves it as uid 0 in pasta's namespace: agent-browser then
 * adds `--no-sandbox`, and the capability set cannot map back to the box uid.
 * So `unshare` creates the namespaces with the box uid mapped to itself and
 * waits on a FIFO; pasta, still outside, attaches to the child's network
 * namespace; the FIFO releases the child, which fixes DNS, waits out IPv6
 * duplicate-address detection, drops every capability, and execs the command.
 *
 * pasta's default port forwarding (`-T auto`) forwards namespace-loopback ports
 * to every host-loopback listener, which would hand the browser the hub and
 * other boxes' listeners; the four `none` flags and `--no-map-gw` are what keep
 * host loopback out. `namespace.test.ts` pins them.
 *
 * The argv builders are pure; `spawnInNamespace` is the orchestration and
 * runs only on a unit host (Linux, `/proc`).
 */

import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { invariant } from "../../../shared/invariant.js";

const execFileAsync = promisify(execFile);

/** A copy of `/usr/bin/unshare` the AppArmor profile lets create user namespaces. */
export const NAMESPACE_UNSHARE = "/opt/beebox-browser/bin/unshare";
/** The packaged pasta (`apt-get install passt`). */
export const NAMESPACE_PASTA = "/usr/bin/pasta";
/** The real resolver list; the host's `/etc/resolv.conf` points at a loopback stub. */
const RESOLV_CONF = "/run/systemd/resolve/resolv.conf";

const NET_NS_TIMEOUT_MS = 5000;
const NET_NS_POLL_MS = 20;

/**
 * The inner script. `$1` is the FIFO; the rest is the command. Positional
 * arguments, so nothing in the command is ever parsed by the shell.
 * The tentative-address wait gives up after 50 x 0.1 s and runs anyway: the
 * worst case is a first request failing with `ERR_NETWORK_CHANGED`.
 */
export const NAMESPACE_INNER_SCRIPT = [
  'fifo="$1"; shift',
  'read -r _ < "$fifo" || exit 1',
  `mount --bind ${RESOLV_CONF} /etc/resolv.conf || exit 1`,
  "i=0",
  'while [ -n "$(ip -o addr show tentative)" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done',
  'exec setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all -- "$@"',
].join("\n");

export interface NamespaceIdentity {
  readonly uid: number;
  readonly gid: number;
  /** The FIFO the child waits on until pasta has attached. */
  readonly fifo: string;
}

/** Step 1: the `unshare` argv that creates the namespaces and waits on the FIFO. */
export function namespaceArgv(command: readonly string[], { uid, gid, fifo }: NamespaceIdentity): string[] {
  return [
    NAMESPACE_UNSHARE,
    "--user",
    `--map-user=${String(uid)}`,
    `--map-group=${String(gid)}`,
    "--net",
    "--mount",
    "--keep-caps",
    "sh",
    "-c",
    NAMESPACE_INNER_SCRIPT,
    "sh",
    fifo,
    ...command,
  ];
}

/** Step 2: the pasta argv that gives the child's namespace outbound access and nothing back. */
export function pastaArgv(childPid: number): string[] {
  return [
    NAMESPACE_PASTA,
    "--config-net",
    "--no-map-gw",
    "-t",
    "none",
    "-u",
    "none",
    "-T",
    "none",
    "-U",
    "none",
    "--quiet",
    String(childPid),
  ];
}

/** The launcher or pasta is not installed; the host never runs without the namespace. */
export class BrowserNamespaceUnavailableError extends Error {
  override name = "BrowserNamespaceUnavailableError";
  constructor(readonly missing: string) {
    super(`The box browser needs a private network on this server, but ${missing} is missing (the deploy installs it).`);
  }
}

/** The child never left our network namespace, or pasta failed to attach. */
export class BrowserNamespaceSetupError extends Error {
  override name = "BrowserNamespaceSetupError";
  constructor(readonly what: { readonly step: "unshare-exited" | "no-namespace" | "no-pid"; readonly detail: string }) {
    super(`The box browser's private network could not be set up (${what.step}): ${what.detail}`);
  }
}

async function waitForOwnNetNamespace(pid: number, child: ChildProcess): Promise<void> {
  const ours = await fs.readlink("/proc/self/ns/net");
  const deadline = Date.now() + NET_NS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new BrowserNamespaceSetupError({ step: "unshare-exited", detail: String(child.exitCode ?? child.signalCode) });
    }
    try {
      if ((await fs.readlink(`/proc/${String(pid)}/ns/net`)) !== ours) return;
    } catch (e) {
      // ENOENT: the process is between fork and exec or has just exited; the
      // exit check above decides on the next round.
      console.warn(`Reading the network namespace of ${String(pid)} failed; retrying:`, e);
    }
    await new Promise((resolve) => setTimeout(resolve, NET_NS_POLL_MS));
  }
  throw new BrowserNamespaceSetupError({ step: "no-namespace", detail: `pid ${String(pid)} after ${String(NET_NS_TIMEOUT_MS)} ms` });
}

/**
 * Spawn `command` inside a private network namespace as the current uid with
 * no capabilities. `options` are the spawn options of the outer `unshare`
 * process (detached, stdio, env); the command inherits them through `exec`.
 */
export async function spawnInNamespace(command: readonly string[], options: SpawnOptions): Promise<ChildProcess> {
  for (const file of [NAMESPACE_UNSHARE, NAMESPACE_PASTA]) {
    if (!existsSync(file)) throw new BrowserNamespaceUnavailableError(file);
  }
  const fifoDir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-browser-ns-"));
  const fifo = path.join(fifoDir, "release");
  try {
    await execFileAsync("mkfifo", ["-m", "0600", fifo]);
    // Linux always has getuid; mapping a guessed uid would be worse than failing.
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    invariant(uid !== undefined && gid !== undefined, "spawnInNamespace runs only on Linux");
    const argv = namespaceArgv(command, { uid, gid, fifo });
    const child = spawn(argv[0] ?? NAMESPACE_UNSHARE, argv.slice(1), options);
    const pid = child.pid;
    if (pid === undefined) throw new BrowserNamespaceSetupError({ step: "no-pid", detail: NAMESPACE_UNSHARE });
    try {
      await waitForOwnNetNamespace(pid, child);
      const pasta = pastaArgv(pid);
      await execFileAsync(pasta[0] ?? NAMESPACE_PASTA, pasta.slice(1), { timeout: 10_000 });
      // Opening the FIFO for writing blocks until the child opens it to read,
      // which it does first thing; the line releases it.
      await fs.writeFile(fifo, "go\n");
    } catch (e) {
      child.kill("SIGKILL");
      throw e;
    }
    return child;
  } finally {
    await fs.rm(fifoDir, { recursive: true, force: true });
  }
}
