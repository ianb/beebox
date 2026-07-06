/**
 * Exhaustiveness and internal-invariant helpers.
 *
 * These are agent-facing conventions for the "seemingly-impossible state"
 * cases the codebase's error policy calls out: interior code that trusts its
 * types and should crash loudly — not degrade silently — when an invariant is
 * broken. They are NOT for user-facing or boundary validation (disk/LLM/HTTP
 * input); those return typed failures or Result values instead.
 *
 * - `assertNever` — the exhaustiveness terminator for a `switch`/if-chain over
 *   a closed union. Placing it in the `default:`/final `else` makes the code
 *   fail to compile the moment a new union member is added.
 * - `invariant` — a should-never-happen assertion that ALWAYS throws, in every
 *   environment. Its `asserts cond` signature is a promise to the type system
 *   that control does not continue when `cond` is falsy; a version that could
 *   return on failure would be unsound, so this one never does.
 * - `checkInvariant` — the deliberate prod-degradation counterpart: it does NOT
 *   narrow types, logs loudly, and returns the condition so the caller can
 *   branch and degrade explicitly. Use it only where limping past a broken
 *   invariant is genuinely preferable to crashing.
 */

/**
 * Assert that a value is `never` — i.e. that a union has been handled
 * exhaustively. Reaching this at runtime means a union member was added
 * without a matching case; it throws with the offending value stringified.
 *
 *   switch (msg.type) {
 *     case "user": return handleUser(msg);
 *     case "assistant": return handleAssistant(msg);
 *     default: return assertNever(msg);
 *   }
 */
export function assertNever(x: never): never {
  const msg = `Unhandled union member: ${stringify(x)}`;
  throw new InvariantError(msg);
}

/**
 * Assert an internal invariant. ALWAYS throws when `cond` is falsy, in every
 * environment (dev, test, prod) — the `asserts cond` narrowing must never lie.
 * For a should-never-happen state where the surrounding code may legitimately
 * degrade in prod, use {@link checkInvariant} instead.
 *
 *   invariant(run !== null, "run must be started before draining");
 *   // run is now narrowed to non-null
 */
export function invariant(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new InvariantError(msg);
}

/**
 * Non-asserting invariant check for the deliberate prod-degradation path.
 * Logs loudly via `console.error` when `cond` is falsy and returns the
 * condition as a boolean so the caller can branch. Does NOT narrow types —
 * the type system never believes a check that didn't hard-fail.
 *
 *   if (!checkInvariant(index <= manifest, "index ahead of manifest")) {
 *     // recover / rebuild rather than trust the stale value
 *   }
 */
export function checkInvariant(cond: unknown, msg: string): boolean {
  if (!cond) console.error(`Invariant violated: ${msg}`);
  return Boolean(cond);
}

/** A broken internal invariant — an impossible state was reached. */
export class InvariantError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvariantError";
  }
}

function stringify(x: unknown): string {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch (_e) {
    return String(x);
  }
}
