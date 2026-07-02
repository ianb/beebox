/**
 * `sleep(ms)` — resolve after `ms` milliseconds. Thin re-export of Node's
 * promisified timer so the four former hand-rolled
 * `new Promise((r) => setTimeout(r, ms))` copies share one implementation.
 */
export { setTimeout as sleep } from "node:timers/promises";
