// # `bbx engine serve` on a Unix socket, created or inherited
//
// Two real server processes against a disposable box. The first receives a
// listening Unix socket as fd 3 the way systemd's socket activation hands one
// over (`LISTEN_FDS=1`; the child names itself in `LISTEN_PID`, which systemd
// sets at exec), and must answer `/api/build-info` through that socket without
// binding anything of its own. The second gets `--socket` with no passed
// descriptor and creates the socket itself. Both publish the socket in the
// endpoint file and, with no `BBX_PUBLIC_URL`, no URL.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, eventually } from "@ianbicking/tap-check/check";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rename, stat } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { serveEndpointPath } from "../../../src/core/serve-endpoint.js";
import { isRecord } from "../../../src/shared/is-record.js";
import { invariant } from "../../../src/shared/invariant.js";

const CHILD = join(import.meta.dirname, "../../helpers/socket-serve-child.ts");

/**
 * The env a child server gets: this process's, minus the test runner's own
 * preloads (`NODE_OPTIONS`, tap's process bookkeeping), which would wrap the
 * child's exit and keep it alive past its own `process.exit`.
 */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "NODE_OPTIONS" || key.startsWith("TAP_") || key.startsWith("_TAPJS")) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * The listening descriptor behind a `net.Server`. Node keeps it on the
 * internal handle; a test standing in for systemd needs the number to put the
 * socket at the child's fd 3 the way `stdio` passes numbered descriptors.
 */
function listeningFd(server: net.Server): number {
  const handle: unknown = Reflect.get(server, "_handle");
  invariant(isRecord(handle) && typeof handle["fd"] === "number", "a listening net.Server carries its fd on _handle");
  return handle["fd"];
}

function getJson(socketPath: string, reqPath: string): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: reqPath, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** The server's first 200 on the socket, within a budget sized for a loaded test host. */
function waitReady(socketPath: string): Promise<{ status: number | undefined; body: string }> {
  return eventually(async () => {
    const answer = await getJson(socketPath, "/api/build-info");
    return answer.status === 200 ? answer : false;
  }, { label: `server answers on ${socketPath}`, timeoutMs: 120_000, intervalMs: 100 });
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

/** A short socket directory: a path under `tmpdir()` can exceed the 104-byte Unix socket limit on macOS. */
async function shortSocketDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bbx-sock-"));
}

void test("a socket passed as fd 3 (LISTEN_FDS) is adopted", async (t) => {
  const box = await makeTmpBox({ git: true });
  const socketPath = join(await shortSocketDir(), "box.sock");
  // The parent plays systemd: it binds the listening socket and hands its
  // descriptor to the child as fd 3, then closes its own copy so the child
  // alone accepts. Closing a listening Unix socket unlinks the path it was
  // bound at, so the socket is bound under a staging name and renamed to the
  // path clients use; the inode, and the child's listening descriptor, stay.
  const staging = `${socketPath}.bind`;
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(staging, resolve));
  await rename(staging, socketPath);
  const child = spawn(process.execPath, ["--import", "tsx", CHILD, box.root, socketPath], {
    cwd: join(import.meta.dirname, "../.."),
    stdio: ["ignore", "pipe", "pipe", listeningFd(listener)],
    env: childEnv({ LISTEN_FDS: "1", BBX_PUBLIC_URL: "", PUBLIC_URL: "" }),
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  t.teardown(async () => {
    await stopChild(child);
    await box.cleanup();
  });

  const ready = await waitReady(socketPath);
  // A dev checkout has no deploy record, so the hash is null; the shape is the point.
  t.check(JSON.parse(ready.body), { buildHash: null, open: false });

  // The endpoint file (written right after the bind) names the socket and, with no public URL, no URL at all.
  const endpoint = await eventually(() => readFile(serveEndpointPath(box.root), "utf8"), { label: "the endpoint file" });
  t.check(JSON.parse(endpoint), { pid: child.pid, socket: socketPath });
  // The startup line names the inherited descriptor, not a bound address.
  const banner = `Server running at unix:${socketPath} (fd 3, socket-activated)`;
  await eventually(() => output.includes(banner), { label: "the startup banner reaches the parent" });
  // Adopted, not re-bound: the box route answers through the hub's path shape.
  t.check((await getJson(socketPath, "/fixture/api/build-info")).status, any(Number));
});

void test("--socket with no passed descriptor creates the socket", async (t) => {
  const box = await makeTmpBox({ git: true });
  const socketPath = join(await shortSocketDir(), "box.sock");
  const child = spawn(process.execPath, ["--import", "tsx", CHILD, box.root, socketPath], {
    cwd: join(import.meta.dirname, "../.."),
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv({ BBX_PUBLIC_URL: "http://hub.example.test/", PUBLIC_URL: "" }),
  });
  child.stdout?.resume();
  child.stderr?.resume();
  t.teardown(async () => {
    await stopChild(child);
    await box.cleanup();
  });

  t.check((await waitReady(socketPath)).status, 200);
  // Owner and group only: the hub shares the group on a unit host.
  t.check((await stat(socketPath)).mode & 0o777, 0o660);
  // With a public URL the box's subprocesses are pointed at the hub's front door.
  const endpoint = await eventually(() => readFile(serveEndpointPath(box.root), "utf8"), { label: "the endpoint file" });
  t.check(JSON.parse(endpoint), {
    pid: child.pid,
    publicUrl: "http://hub.example.test/fixture",
    socket: socketPath,
  });
});
