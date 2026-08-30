/**
 * A child process that takes a request-scoped file lock and then holds it
 * forever, so a test can SIGKILL it mid-hold and observe real crash recovery
 * (a guard directory left behind by a process that never released it).
 *
 * Usage: `node --import tsx test/helpers/file-lock-child.ts <lockPath>`
 * Prints `acquired` on stdout once the lock is held; never exits on its own.
 */
import { acquireLock, requestScopedLock } from "../../src/lib/file-lock.js";
import { invariant } from "../../src/lib/invariant.js";

const lockPath = process.argv[2];
invariant(lockPath !== undefined, "file-lock-child requires a lock path argument");

await acquireLock(requestScopedLock(lockPath), { purpose: "file-lock-doctest-child" });
process.stdout.write("acquired\n");

// Hold the lock until we're killed. An empty interval keeps the event loop
// alive (and lets proper-lockfile's refresh timer keep running, exactly as a
// real holder's would).
setInterval(() => {}, 1000);
