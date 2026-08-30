/**
 * Spawn a child process, collect its combined stdout+stderr, and resolve when
 * it closes. The shared shape behind the CLI-subprocess spawns that don't need
 * exec-with-timeout's machinery (`bbx wakeup`/`bbx finalize` from the reactor,
 * the webapp wakeup command, the `bbx upgrade` step runner). Callers keep their
 * own error/return conventions on top: this only owns spawn → buffer → close.
 *
 * Streaming: pass `onChunk` to receive each stdout/stderr chunk as text in
 * arrival order (the reactor/webapp stream to a log); the full text is always
 * also returned in `output` regardless.
 *
 * Failure to spawn (e.g. ENOENT) rejects the promise; a process that runs and
 * exits nonzero resolves with that exit code — callers decide what a nonzero
 * code means.
 */

import { spawn } from "node:child_process";

export interface CollectedChildResult {
  /** Exit code; a process killed by signal (null code) is normalized to 1. */
  code: number;
  /** Combined stdout+stderr, in arrival order. */
  output: string;
}

export function runCollectedChild(options: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onChunk?: (text: string) => void;
}): Promise<CollectedChildResult> {
  const { command, args, cwd, env, onChunk } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      ...(env === undefined ? {} : { env }),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const collect = (data: Buffer): void => {
      const text = data.toString();
      output += text;
      onChunk?.(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}
