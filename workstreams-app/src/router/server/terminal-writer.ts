// Writing to the router's terminal without blocking its main thread.
//
// Node writes to a TTY synchronously, so a terminal that has stopped reading
// (a full buffer, a paused or slow tab) stops the whole router on one log line.
// A sampled 3 s stall had the main thread in `write` to the terminal
// (issues/bugs/2026-10-30-dev-router-stalls-writing-to-its-terminal.md). Here a
// worker thread does the writes, so only the worker waits. The durable log is
// the record, so past a bound the terminal loses lines and is told how many.

import { Worker } from "node:worker_threads";
import { errMessage } from "../effects.js";

/** Lines the terminal may fall behind by before new ones are dropped. */
const MAX_PENDING_LINES = 1000;

// Plain JavaScript in a string: a worker's file would need its own loader under
// tsx, and tsx may run this as CommonJS or as a module, hence `getBuiltinModule`.
// It writes to fd 1 directly, because a worker's `process.stdout` is piped
// through the main thread.
const WORKER_SOURCE = `
const { parentPort } = process.getBuiltinModule("node:worker_threads");
const fs = process.getBuiltinModule("node:fs");
const pause = new Int32Array(new SharedArrayBuffer(4));
parentPort.on("message", (text) => {
  let rest = Buffer.from(text);
  while (rest.length > 0) {
    try {
      rest = rest.subarray(fs.writeSync(1, rest));
    } catch (e) {
      if (e.code !== "EAGAIN") break;
      Atomics.wait(pause, 0, 0, 50);
    }
  }
  parentPort.postMessage(null);
});
`;

let worker: Worker | null = null;
let pending = 0;
let dropped = 0;

/** Start the writer. Called once from `main()`; until then, lines go to the console. */
export function startTerminalWriter(): void {
  const started = new Worker(WORKER_SOURCE, { eval: true });
  started.unref();
  started.on("message", () => {
    pending -= 1;
  });
  started.on("error", (err: Error) => {
    console.error(`[router] terminal writer failed: ${errMessage(err)}`);
    worker = null;
  });
  worker = started;
  pending = 0;
  dropped = 0;
}

/** Send `text` to the terminal without waiting for it. False when no writer is running. */
export function writeToTerminal(text: string): boolean {
  if (worker === null) return false;
  if (pending >= MAX_PENDING_LINES) {
    dropped += 1;
    return true;
  }
  const notice = dropped === 0 ? "" : `[router] the terminal fell behind; ${String(dropped)} lines are only in router.log\n`;
  dropped = 0;
  pending += 1;
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- a worker thread, which has no origin; the rule is for Window.postMessage
  worker.postMessage(`${notice}${text}`);
  return true;
}
