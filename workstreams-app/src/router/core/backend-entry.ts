// Checkout-relative paths the router spawns into a checkout's `beebox/`.
//
// One router serves every checkout side by side (main, and every worktree,
// old and new), so a single hard-coded path breaks whichever generation's
// layout doesn't match it. This module resolves each path per checkout, at
// spawn time, trying the CURRENT layout first and a pre-rename path second.
//
// The only entry with a second candidate today is `hubEntry`: the
// 2026-09-27 layout moves renamed `src/cli/index.ts` to
// `src/cli/entry/run.ts` (commit 3b5d64ca0). `noHubEntry` and `tsxPreload`
// did not move in that pass; they carry single-element lists so every
// checkout-relative path the router spawns is declared in one place.
//
// The second candidate in any list exists ONLY for checkouts (worktree
// branches) that predate that commit. Delete it, and the fallback plumbing
// below, once no `worktree-*` branch predates it — see
// issues/deferred/2026-09-27-retire-router-pre-rename-backend-paths.md for
// the exact check and an expiry date backed by a test in
// workstreams-app/test/router/core/backend-entry.test.ts.
import path from "node:path";

export const BACKEND_ENTRY_CANDIDATES = {
  /** `node ... <hubEntry> engine hub --config ...` */
  hubEntry: ["./src/cli/entry/run.ts", "./src/cli/index.ts"],
  /** `node ... <noHubEntry> <box>=<dir> ...` (BBX_DEV_NO_HUB=1) */
  noHubEntry: ["./src/webapp/server-main.ts"],
  /** `node --import=<tsxPreload> --import tsx ...` */
  tsxPreload: ["./tsx-preload.mjs"],
} as const satisfies Record<string, readonly string[]>;

export type BackendEntryKey = keyof typeof BACKEND_ENTRY_CANDIDATES;

/** Neither the current nor any pre-rename candidate exists in the checkout. */
export class BackendEntryMissingError extends Error {
  readonly checkoutBackendCwd: string;
  readonly key: BackendEntryKey;
  readonly candidates: readonly string[];

  constructor(params: { checkoutBackendCwd: string; key: BackendEntryKey; candidates: readonly string[] }) {
    super(`${params.checkoutBackendCwd}: no ${params.key} found; tried ${params.candidates.join(" and ")}`);
    this.name = "BackendEntryMissingError";
    this.checkoutBackendCwd = params.checkoutBackendCwd;
    this.key = params.key;
    this.candidates = params.candidates;
  }
}

/**
 * Resolve one checkout-relative entry path, trying `BACKEND_ENTRY_CANDIDATES[key]`
 * in order against `pathExists` (an injected effect so this stays testable
 * without touching the filesystem). Callers invoke this once per generation
 * spawn (not inside the readiness-poll loop), so a fallback warns exactly
 * once per spawn attempt, naming the checkout and the old path, via `warn` —
 * real callers pass `console.warn` so the fallback's use stays visible in
 * router output. Throws `BackendEntryMissingError`, naming every candidate
 * and the checkout, when none exist: no silent fallback beyond the two known
 * generations.
 */
export async function resolveBackendEntryPath(params: {
  pathExists: (absolutePath: string) => Promise<boolean>;
  warn: (msg: string) => void;
  checkoutBackendCwd: string;
  key: BackendEntryKey;
}): Promise<string> {
  const { pathExists, warn, checkoutBackendCwd, key } = params;
  const candidates = BACKEND_ENTRY_CANDIDATES[key];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    if (await pathExists(path.join(checkoutBackendCwd, candidate))) {
      if (i > 0) {
        warn(
          `[router] ${checkoutBackendCwd}: ${key} not found at ${candidates[0]}; ` +
            `falling back to pre-rename path ${candidate} ` +
            "(see issues/deferred/2026-09-27-retire-router-pre-rename-backend-paths.md)",
        );
      }
      return candidate;
    }
  }
  throw new BackendEntryMissingError({ checkoutBackendCwd, key, candidates });
}
