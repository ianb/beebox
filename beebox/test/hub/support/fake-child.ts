// A fake hub child process for supervisor tests.

import type { ChildProc } from "../../../src/hub/supervisor/core.js";

/** A fake `ChildProc`: just enough surface for `Supervisor.launch()` to use
 *  (`pid`, `on("exit", ...)`, `catch()`) plus a way for the test to fire the
 *  "exit" event itself, standing in for the real process death that a real
 *  `killGroup()` would eventually cause. No real process is ever spawned. */
type ChildEventHandler = (...args: Array<number | string | null | { type: string }>) => void;
export type FakeChild = ChildProc & {
  fireMessage(message: { type: string }): void;
  fireExit(code: number | null, signal: NodeJS.Signals | null): void;
  /** What the child does on receiving "reload-now"; a test replaces it. */
  reloadNow: () => void;
};

export function makeFakeChild(pid: number): FakeChild {
  const exitHandlers: ChildEventHandler[] = [];
  const messageHandlers: ChildEventHandler[] = [];
  // Deliberately partial fake: the supervisor reads only pid, on(), catch() and send() of a ChildProc,
  // and the full execa ResultPromise type cannot be built without spawning a process. Built on
  // Promise.prototype like server.router.test.ts's fake child.
  const child: FakeChild = Object.assign(Object.create(Promise.prototype), {
    pid,
    on(event: string, bbx: ChildEventHandler) {
      if (event === "exit") exitHandlers.push(bbx);
      if (event === "message") messageHandlers.push(bbx);
    },
    catch() {},
    send(message: { type: string }, callback?: (error: Error | null) => void) {
      callback?.(null);
      if (message.type === "reload-now") child.reloadNow();
    },
    reloadNow() { setImmediate(() => { child.fireExit(75, null); }); },
    fireMessage(message: { type: string }) {
      for (const handler of messageHandlers) handler(message);
    },
    fireExit(code: number | null, signal: NodeJS.Signals | null) {
      for (const bbx of exitHandlers) bbx(code, signal);
    },
  });
  return child;
}
