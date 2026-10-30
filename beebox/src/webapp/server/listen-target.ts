/**
 * Where `bbx engine serve` listens: a TCP port, a Unix socket path it creates,
 * or a listening socket systemd passed it (`LISTEN_FDS`, the socket-activation
 * protocol: `sd_listen_fds(3)`).
 *
 * Under a `beebox-box@<slug>.socket` unit the socket already exists and is
 * already listening when the service starts; the engine adopts fd 3 and never
 * binds a path itself. `--socket <path>` without `LISTEN_FDS` (a dev machine,
 * a test) makes the engine create the socket. The two are told apart here, in
 * one place, so `app.ts` only ever sees a resolved target.
 */

import * as fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { errnoCode } from "../../shared/error-guards.js";

/** `SD_LISTEN_FDS_START`: the first passed descriptor. */
const SD_LISTEN_FDS_START = 3;

export type ListenTarget =
  | { kind: "tcp"; port: number; host: string }
  /** A Unix socket the engine creates at `path` (and removes a stale one first). */
  | { kind: "socket"; path: string }
  /** A listening socket inherited from systemd; `path` is for logging only. */
  | { kind: "inherited-fd"; fd: number; path: string };

type ListenTargetProblem =
  | { reason: "bad-count"; raw: string }
  | { reason: "too-many-fds"; count: number }
  | { reason: "fd-without-socket" };

/** The serve options and the passed descriptors disagree; `reason` says how. */
export class ListenTargetError extends Error {
  readonly reason: ListenTargetProblem["reason"];
  constructor(problem: ListenTargetProblem) {
    super(
      problem.reason === "bad-count"
        ? `LISTEN_FDS is not a count: ${problem.raw}`
        : problem.reason === "too-many-fds"
          ? `expected one passed socket, systemd passed ${problem.count}`
          : "a socket was passed (LISTEN_FDS) but --socket names no path",
    );
    this.name = "ListenTargetError";
    this.reason = problem.reason;
  }
}

/**
 * The descriptors systemd passed, per `sd_listen_fds(3)`: honored only when
 * `LISTEN_PID` names this process (a child that inherited the variables from
 * a parent that was the activated service must not adopt its parent's fd).
 * Like `sd_listen_fds(unset_environment=1)`, the variables are removed from
 * `env` so no subprocess the engine spawns sees them.
 */
export function takeSystemdListenFds(env: NodeJS.ProcessEnv, pid: number): number[] {
  const listenPid = env.LISTEN_PID;
  const listenFds = env.LISTEN_FDS;
  delete env.LISTEN_PID;
  delete env.LISTEN_FDS;
  delete env.LISTEN_FDNAMES;
  if (listenPid === undefined || listenFds === undefined) return [];
  if (listenPid !== String(pid)) return [];
  const count = Number(listenFds);
  if (!Number.isInteger(count) || count < 0) throw new ListenTargetError({ reason: "bad-count", raw: listenFds });
  return Array.from({ length: count }, (_unused, index) => SD_LISTEN_FDS_START + index);
}

/**
 * Decide the listen target from the serve options and the process env. A
 * passed descriptor always wins when a socket was asked for: the unit
 * declares the path in `--socket` only so logs and the endpoint file can name
 * it. A passed descriptor with no `--socket` is a misconfigured unit, not a
 * TCP server that happens to hold an extra fd.
 */
export function resolveListenTarget(options: {
  port: number;
  host: string;
  socket: string | undefined;
  env: NodeJS.ProcessEnv;
  pid: number;
}): ListenTarget {
  const fds = takeSystemdListenFds(options.env, options.pid);
  if (fds.length > 1) throw new ListenTargetError({ reason: "too-many-fds", count: fds.length });
  const [fd] = fds;
  if (options.socket === undefined) {
    if (fd !== undefined) throw new ListenTargetError({ reason: "fd-without-socket" });
    return { kind: "tcp", port: options.port, host: options.host };
  }
  if (fd !== undefined) return { kind: "inherited-fd", fd, path: options.socket };
  return { kind: "socket", path: options.socket };
}

/** The address a person or a log line names for this target. */
export function describeListenTarget(target: ListenTarget): string {
  switch (target.kind) {
    case "tcp":
      return `http://${target.host}:${target.port}`;
    case "socket":
      return `unix:${target.path}`;
    case "inherited-fd":
      return `unix:${target.path} (fd ${target.fd}, socket-activated)`;
  }
}

/**
 * Bind the server. Fastify's own `listen` handles TCP and a path; a passed
 * descriptor goes straight to Node's `server.listen({ fd })` after `ready()`,
 * because Fastify's `listen` would treat the missing path as `localhost` and
 * try to bind TCP beside the inherited socket.
 */
export async function listenOn(server: FastifyInstance, target: ListenTarget): Promise<void> {
  switch (target.kind) {
    case "tcp":
      await server.listen({ port: target.port, host: target.host });
      return;
    case "socket":
      await removeStaleSocket(target.path);
      await server.listen({ path: target.path });
      // The hub connects as a different user on a unit host; the socket unit
      // owns the mode there. Here the engine made the socket, so it sets the
      // same owner-and-group mode.
      await fs.chmod(target.path, 0o660);
      return;
    case "inherited-fd":
      await server.ready();
      await new Promise<void>((resolve, reject) => {
        server.server.once("error", reject);
        server.server.listen({ fd: target.fd }, () => {
          server.server.off("error", reject);
          resolve();
        });
      });
      return;
  }
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  try {
    await fs.unlink(socketPath);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
  }
}
