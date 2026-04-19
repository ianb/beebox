/**
 * Claude chat spawner — typed interface for launching a Claude Code subprocess
 * in stream-json chat mode.
 *
 * Real implementation shells out to `cb-claude` with the usual flags.
 * Fake implementation returns PassThrough streams and exposes a test-facing
 * API so tests can script the stream-json protocol without spawning a
 * subprocess.
 *
 * The interface intentionally stays narrow: spawn options in, a ChildProcess-
 * like handle out. The chat session owns stdin writes, stdout line parsing,
 * and message handling.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import type { Readable, Writable } from "node:stream";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface ClaudeChatSpawnOptions {
  /** Working directory for the subprocess. */
  cwd: string;
  /** Fully-resolved system prompt — passed via --append-system-prompt. */
  systemPrompt: string;
  /** If set, passed via --resume to continue an existing conversation. */
  sessionIdToResume?: string | undefined;
  /** If set, passed via --mcp-config as the path to a JSON config file. */
  mcpConfigPath?: string | undefined;
  /** Full env var map for the subprocess (caller builds it). Keys with undefined values are dropped. */
  env: Record<string, string | undefined>;
}

export interface ClaudeChatProcess {
  pid?: number | undefined;
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "close", listener: (code: number | null) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
}

export interface ClaudeChatSpawner {
  spawn(opts: ClaudeChatSpawnOptions): ClaudeChatProcess;
}

// ─── Real implementation ─────────────────────────────────────────────────────

const __dirname = import.meta.dirname;
const binDir = path.resolve(__dirname, "../../bin");
const cbClaudePath = path.join(binDir, "cb-claude");

export function createClaudeChatSpawner(): ClaudeChatSpawner {
  return {
    spawn(opts: ClaudeChatSpawnOptions): ClaudeChatProcess {
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--append-system-prompt",
        opts.systemPrompt,
      ];
      if (opts.sessionIdToResume !== undefined) {
        args.push("--resume", opts.sessionIdToResume);
      }
      if (opts.mcpConfigPath !== undefined) {
        args.push("--mcp-config", opts.mcpConfigPath);
      }
      return nodeSpawn(cbClaudePath, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

/**
 * A fake ClaudeChatProcess driven from test code. Exposes a `script()` API
 * for pushing stream-json lines onto the stdout stream as if claude emitted
 * them, plus inspectable fields (`spawnOptions`, `sent`) for assertions.
 */
export interface FakeClaudeChatProcess extends ClaudeChatProcess {
  pid: number;
  /** What `spawn` was called with. Useful for asserting --resume etc. */
  spawnOptions: ClaudeChatSpawnOptions;
  /** Lines received on stdin (as JSON-decoded objects). Caller-ordered. */
  sent: unknown[];
  /** Emit a stream-json line to stdout. The object is JSON-stringified + newline-terminated. */
  emitMessage(msg: Record<string, unknown>): void;
  /** Emit the init system message with a session_id, then resolve. */
  emitSessionInit(sessionId: string): void;
  /** Emit a plain assistant text message. */
  emitAssistantText(text: string): void;
  /** Emit the end-of-turn `result` message. */
  emitResult(opts?: { isError?: boolean; result?: string }): void;
  /** Close the subprocess with the given exit code (default 0). */
  close(code?: number): void;
}

export interface FakeClaudeChatSpawner extends ClaudeChatSpawner {
  /** Every process this spawner has produced, in order. */
  processes: FakeClaudeChatProcess[];
  /** The most recently spawned process, or null if none. */
  lastProcess(): FakeClaudeChatProcess | null;
}

export function createFakeClaudeChatSpawner(): FakeClaudeChatSpawner {
  const processes: FakeClaudeChatProcess[] = [];
  const spawner: FakeClaudeChatSpawner = {
    processes,
    lastProcess() {
      return processes[processes.length - 1] ?? null;
    },
    spawn(opts: ClaudeChatSpawnOptions): FakeClaudeChatProcess {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      const emitter = new EventEmitter();
      const sent: unknown[] = [];

      stdin.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        for (const line of text.split("\n")) {
          if (line.length === 0) continue;
          try {
            sent.push(JSON.parse(line));
          } catch {
            sent.push(line);
          }
        }
      });

      let killed = false;

      const proc: FakeClaudeChatProcess = {
        pid: 99999 + processes.length,
        stdin,
        stdout,
        stderr,
        spawnOptions: opts,
        sent,
        kill(_signal?: NodeJS.Signals | number): boolean {
          if (killed) return false;
          killed = true;
          stdout.end();
          stderr.end();
          process.nextTick(() => {
            emitter.emit("close", null);
          });
          return true;
        },
        on(event, listener) {
          emitter.on(event, listener as (...args: unknown[]) => void);
          return proc;
        },
        emitMessage(msg: Record<string, unknown>) {
          stdout.write(JSON.stringify(msg) + "\n");
        },
        emitSessionInit(sessionId: string) {
          proc.emitMessage({ type: "system", subtype: "init", session_id: sessionId });
        },
        emitAssistantText(text: string) {
          proc.emitMessage({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text }] },
          });
        },
        emitResult(resultOpts?: { isError?: boolean; result?: string }) {
          proc.emitMessage({
            type: "result",
            is_error: resultOpts?.isError ?? false,
            result: resultOpts?.result ?? "",
          });
        },
        close(code: number = 0) {
          stdout.end();
          stderr.end();
          process.nextTick(() => {
            emitter.emit("close", code);
          });
        },
      };

      processes.push(proc);
      return proc;
    },
  };
  return spawner;
}
