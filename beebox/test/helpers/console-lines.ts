/**
 * Capture what code under test prints on a console method, as the lines a
 * person would read.
 *
 * A test that provokes a failure on purpose expects its log line: the line is
 * part of the contract, so the test checks it rather than letting it reach the
 * run's stderr. `t.capture` restores the method when the test ends. An `Error`
 * argument reads as `Name: message`, without the stack, so the expected value
 * holds no file paths. Each call returns the lines printed since the previous
 * call (tap empties the record when it is read).
 */

import type { Test } from "tap";
import { format } from "node:util";

type ConsoleMethod = "log" | "info" | "warn" | "error";

export function consoleLines(t: Test, method: ConsoleMethod): () => string[] {
  const calls = t.capture(console, method);
  return () => calls.args().map((args: unknown[]) => format(...args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : arg))));
}
