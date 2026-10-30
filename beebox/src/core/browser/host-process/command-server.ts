/**
 * The command socket, host side (docs/plans/shared-browser.md, "Command
 * socket"): runs the agent's `bbx browser` commands with the same binary and
 * the same fixed environment as the dashboard.
 *
 * Running the CLI here, inside the browser host, means a command that finds
 * the daemon idled out starts the new daemon (and Chrome) inside the box's
 * private namespace. The engine already checked the arguments; they are
 * checked again here, so nothing that reaches this socket can pick another
 * profile or browser. The socket is 0600 in a 0700 directory, like the relay.
 *
 * One request per connection: `{ args }` as JSON, ended by the client's
 * half-close (or a newline); one JSON line back, then the connection closes.
 *
 * A command that would launch the browser starts the box session first
 * (`ensureBoxSession`), so every launch gets the box viewport. The checks run
 * one at a time, so two commands at once cannot both launch.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import net from "node:net";
import { z } from "zod";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { COMMAND_TIMEOUT_MS, TIMED_OUT_EXIT_CODE, type ExecReply } from "../command-socket.js";
import { checkExecArgs, EXEC_BODY, execSubcommand } from "../exec-args.js";
import { ensureBoxSession, SESSION_PROBLEM_PREFIX } from "../session.js";
import { agentBrowserBinary } from "./agent-browser.js";

/** Each of stdout and stderr is kept up to this many bytes. */
const OUTPUT_CAP_BYTES = 2 * 1024 * 1024;
/** 64 arguments of 8 KB each, with room for JSON escaping. */
const REQUEST_CAP_BYTES = 1024 * 1024;
/** The exit code for a request the host refused before running anything (a usage error). */
const REFUSED_EXIT_CODE = 2;
/** Subcommands that do not launch the browser, so the session is not started for them. */
const NO_LAUNCH_SUBCOMMANDS: ReadonlySet<string> = new Set(["session", "close", "quit", "exit"]);

export interface CommandServer {
  close(): Promise<void>;
}

export interface CommandServerInput {
  readonly socketPath: string;
  /** agent-browser's whole environment (`dashboardEnv`). */
  readonly env: Record<string, string>;
  /** The browser root, agent-browser's working directory. */
  readonly cwd: string;
}

/** Collects one output stream up to the cap and remembers whether it dropped any. */
class CappedOutput {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private truncated = false;

  add(chunk: Buffer): void {
    const room = OUTPUT_CAP_BYTES - this.bytes;
    if (chunk.length > room) this.truncated = true;
    if (room <= 0) return;
    const kept = chunk.subarray(0, room);
    this.chunks.push(kept);
    this.bytes += kept.length;
  }

  text(name: string): string {
    const text = Buffer.concat(this.chunks).toString("utf8");
    return this.truncated ? `${text}\n[bbx browser: ${name} truncated at 2 MB]\n` : text;
  }
}

function refused(stderr: string): ExecReply {
  return { exitCode: REFUSED_EXIT_CODE, stdout: "", stderr: `${stderr}\n` };
}

/** The request's arguments, or the reply that refuses it. */
function parseRequest(text: string): { ok: true; args: string[] } | { ok: false; reply: ExecReply } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    return { ok: false, reply: refused("bbx browser: the command socket's request is not JSON") };
  }
  const body = EXEC_BODY.safeParse(json);
  if (!body.success) return { ok: false, reply: refused(`bbx browser: ${z.prettifyError(body.error)}`) };
  const check = checkExecArgs(body.data.args);
  if (!check.ok) return { ok: false, reply: refused(check.message) };
  return { ok: true, args: body.data.args };
}

/** Run agent-browser once; `onSpawn` receives the child so a dropped connection can kill it. */
function runCommand(input: CommandServerInput & { readonly args: readonly string[] }, onSpawn: (kill: () => void) => void): Promise<ExecReply> {
  return new Promise((resolve) => {
    let binary: string;
    try {
      binary = agentBrowserBinary();
    } catch (e) {
      resolve({ exitCode: 1, stdout: "", stderr: `${errorMessage(e)}\n` });
      return;
    }
    const child = spawn(binary, [...input.args], { env: input.env, cwd: input.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = new CappedOutput();
    const stderr = new CappedOutput();
    child.stdout.on("data", (chunk: Buffer) => stdout.add(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.add(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, COMMAND_TIMEOUT_MS);
    onSpawn(() => child.kill("SIGKILL"));
    child.once("error", (e) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: "", stderr: `bbx browser: agent-browser did not start: ${e.message}\n` });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const note = `bbx browser: agent-browser did not finish within ${String(COMMAND_TIMEOUT_MS / 1000)} s and was stopped\n`;
        resolve({ exitCode: TIMED_OUT_EXIT_CODE, stdout: stdout.text("stdout"), stderr: `${stderr.text("stderr")}${note}` });
        return;
      }
      resolve({ exitCode: code ?? 1, stdout: stdout.text("stdout"), stderr: stderr.text("stderr") });
    });
  });
}

/** Runs `ensureBoxSession` before each launching command, one check at a time. */
function sessionStarter(input: CommandServerInput): (args: readonly string[]) => Promise<string | null> {
  let previous: Promise<unknown> = Promise.resolve();
  const run = (args: readonly string[]): Promise<ExecReply> =>
    runCommand({ ...input, args }, () => {
      // Not killed with the connection: a half-started session would be left for the next command to find.
    });
  return (args) => {
    const subcommand = execSubcommand(args);
    if (subcommand === null || NO_LAUNCH_SUBCOMMANDS.has(subcommand)) return Promise.resolve(null);
    const result = previous.then(() => ensureBoxSession(run));
    previous = result.catch(() => null);
    return result;
  };
}

function handleConnection(input: CommandServerInput, open: Set<net.Socket>): (conn: net.Socket) => void {
  const startSession = sessionStarter(input);
  return (conn) => {
    open.add(conn);
    let kill: (() => void) | undefined;
    let answered = false;
    let gone = false;
    conn.on("close", () => {
      gone = true;
      open.delete(conn);
      // The caller gave up (the engine's own timeout, or it exited): stop the command.
      if (!answered) kill?.();
    });
    conn.on("error", (e) => {
      if (errnoCode(e) !== "ECONNRESET" && errnoCode(e) !== "EPIPE") console.warn("Command socket client error:", e);
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let started = false;
    const answer = (reply: ExecReply): void => {
      answered = true;
      conn.end(`${JSON.stringify(reply)}\n`);
    };
    const start = (): void => {
      if (started) return;
      started = true;
      const request = parseRequest(Buffer.concat(chunks).toString("utf8"));
      if (!request.ok) {
        answer(request.reply);
        return;
      }
      void startSession(request.args).then(async (problem) => {
        if (gone) return;
        // The command still runs: it launches the browser without the box viewport, and says so.
        const reply = await runCommand({ ...input, args: request.args }, (k) => (kill = k));
        answer(problem === null ? reply : { ...reply, stderr: `${SESSION_PROBLEM_PREFIX}${problem}\n${reply.stderr}` });
      });
    };
    conn.on("data", (chunk: Buffer) => {
      if (started) return;
      bytes += chunk.length;
      if (bytes > REQUEST_CAP_BYTES) {
        started = true;
        answer(refused("bbx browser: the request is over 1 MB"));
        return;
      }
      chunks.push(chunk);
      if (chunk.includes(0x0a)) start();
    });
    conn.on("end", start);
  };
}

/** Listen on `socketPath` (replacing a stale file) and run each request's command. */
export async function startCommandServer(input: CommandServerInput): Promise<CommandServer> {
  // A host that was killed leaves its socket file; listening on it fails with EADDRINUSE.
  await fs.rm(input.socketPath, { force: true });
  const open = new Set<net.Socket>();
  // Half-open: the client ends its side to mark the request complete, then reads the reply.
  const server = net.createServer({ allowHalfOpen: true }, handleConnection(input, open));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await fs.chmod(input.socketPath, 0o600);
  server.on("error", (e) => console.error("Command socket error:", e));
  return {
    close: async () => {
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      for (const conn of open) conn.destroy();
      await closed;
      await fs.rm(input.socketPath, { force: true });
    },
  };
}
