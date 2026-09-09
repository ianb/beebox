// The REAL RouterAuthDeps the dev router injects into the pure authorization
// core (workstreams-app/src/router/router-auth.ts). Track B, chunk 2a of
// beebox/docs/plans/expose-dev-router.md.
//
// Every resolver runs beebox's CURRENT code against the TARGET box — the
// finding-4 fix: the front door authenticates with main's auth even when it
// proxies an old worktree whose own checkout may lack (or predate) this wall.
// `bin/` importing `beebox/src` is precedented (bin/doctor.ts,
// workstreams-app/src/router/router-auth.ts). This module holds only the resolvers; the listener/gate
// wiring lives in workstreams-app/src/router/router.ts.
//
// Gen-revocation is honored because every session read goes through
// `resolveRequestIdentity` (auth.ts), whose cookie path runs the gen-aware
// `classifyLocalRecord`: a stale/revoked cookie resolves to `source: null`
// (→ we return null → deny). The router process never sets `BBX_HUB_SECRET`, so
// `isHubMode()` is false and the resolver always takes that cookie path.

import type {
  RouterAuthDeps,
  RouterHeaders,
  BoxTarget,
  OwnerIdentity,
  BoxAccessIdentity,
} from "./router-auth.js";
import type { ResolvedBoxEntry } from "./box-entry.js";
import { resolveRequestIdentity, getOwnerEmail } from "../../../beebox/src/webapp/auth.js";
import { canAccessBox } from "../../../beebox/src/webapp/box-access.js";
import { resolveMobileRequestAuth } from "../../../beebox/src/core/mobile/request-auth.js";
import { verifyAgentBearer } from "../../../beebox/src/core/agent/token.js";
import { verifyBrowseKey } from "../../../beebox/src/core/browse-key.js";

/**
 * The router's own worktree/box resolution, injected so the auth deps route by
 * the EXACT same slug→box map the proxy does (plan 2.4, single source of truth).
 * `resolveWorktree` is workstreams-app/src/router/router.ts's own resolver; `resolveBoxEntries` is
 * box-entry.ts's. Passing them (rather than re-importing) keeps one map and
 * lets the deps be unit-tested with fakes.
 */
export interface RouterAuthDepsConfig {
  resolveWorktree(name: string): Promise<{ boxes: string[] } | null>;
  resolveBoxEntries(entries: string[]): Promise<ResolvedBoxEntry[]>;
}

/** Node gives repeated headers as arrays; only a single value can be a credential. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// A worktree-root request (`/<w>/`, `/<w>/api/*`, and any `/<w>/<seg>` whose
// `<seg>` is not a box — e.g. Vite's `/<w>/@vite/client`, `/<w>/src/...`) is
// gated on a SESSION, never a single box's mobile token (carry-forward (a): the
// box picker is per-USER, not per-box). We encode that "this target is the
// worktree root, not a box" by returning a sentinel from `resolveTargetBoxRoot`
// that the mobile/session resolvers recognize. The prefix can never collide
// with a real box root, which is always an absolute filesystem path.
const PICKER_PREFIX = "\0worktree-root:";
function pickerSentinel(worktree: string): string {
  return `${PICKER_PREFIX}${worktree}`;
}
function pickerWorktreeOf(targetBoxRoot: string): string | null {
  return targetBoxRoot.startsWith(PICKER_PREFIX) ? targetBoxRoot.slice(PICKER_PREFIX.length) : null;
}

/**
 * Gen-aware session identity from a request's raw headers, via the exported,
 * gen-aware `resolveRequestIdentity` (auth.ts). A minimal `{ headers: { cookie } }`
 * shim is all the non-hub cookie path reads; `openAccess: false` keeps it
 * fail-closed (the router never opens access). Returns the authenticated email,
 * or null for no/invalid/revoked/unavailable session.
 */
function sessionEmail(headers: RouterHeaders): string | null {
  const identity = resolveRequestIdentity({ headers: { cookie: single(headers.cookie) } }, { openAccess: false });
  if (identity.source === "cookie" && identity.email) return identity.email;
  return null;
}

export function createRouterAuthDeps(config: RouterAuthDepsConfig): RouterAuthDeps {
  async function boxEntriesFor(worktree: string): Promise<ResolvedBoxEntry[] | null> {
    const resolved = await config.resolveWorktree(worktree);
    if (!resolved) return null;
    return config.resolveBoxEntries(resolved.boxes);
  }

  return {
    async resolveOwnerSession(headers: RouterHeaders): Promise<OwnerIdentity | null> {
      const email = sessionEmail(headers);
      if (!email) return null;
      const ownerEmail = getOwnerEmail();
      return ownerEmail && email === ownerEmail ? { email } : null;
    },

    async resolveTargetBoxRoot({ targetWorktree, targetBox }: BoxTarget): Promise<string | null> {
      const entries = await boxEntriesFor(targetWorktree);
      if (entries === null) return null; // unknown worktree ⇒ fail closed
      // Root-worktree requests (`/<w>/`, `/<w>/api/*`) have no slug ⇒ the picker.
      if (targetBox === null) return pickerSentinel(targetWorktree);
      const matches = entries.filter((e) => e.slug === targetBox);
      // Ambiguous slug (two boxes, one slug) ⇒ fail closed: never auth against
      // one box while the proxy might route the slug to another (plan 2.4).
      if (matches.length > 1) return null;
      // No box by this slug ⇒ it's a worktree-root SPA asset (Vite serves the
      // shell at `/<w>/`, so `/<w>/@vite/client` etc. are not box paths). Gate
      // it as the worktree root (session), not a box — and NOT a hard deny,
      // which would 401 the logged-in owner's own dev SPA assets.
      if (matches.length === 0) return pickerSentinel(targetWorktree);
      return matches[0]!.contentDir;
    },

    async resolveBoxAccessSession(headers: RouterHeaders, targetBoxRoot: string): Promise<BoxAccessIdentity | null> {
      const email = sessionEmail(headers);
      if (!email) return null;
      const ownerEmail = getOwnerEmail();
      const worktree = pickerWorktreeOf(targetBoxRoot);
      if (worktree !== null) {
        // Worktree-root/picker: owner, or a member of ANY box in the worktree.
        if (ownerEmail && email === ownerEmail) return { email };
        const entries = await boxEntriesFor(worktree);
        if (entries === null) return null;
        for (const entry of entries) {
          if (await canAccessBox({ boxRoot: entry.contentDir, email, ownerEmail })) return { email };
        }
        return null;
      }
      if (await canAccessBox({ boxRoot: targetBoxRoot, email, ownerEmail })) return { email };
      return null;
    },

    async resolveMobileForBox(headers: RouterHeaders, targetBoxRoot: string): Promise<boolean> {
      // A per-box mobile token (or agent bearer) never satisfies the cross-box
      // picker/worktree-root — those require a session (carry-forward (a)).
      if (pickerWorktreeOf(targetBoxRoot) !== null) return false;
      // The agent bearer is per-box, so it's folded in here (where the target
      // box root is known) rather than in the box-root-less `isAgentBearer` rung.
      if (verifyAgentBearer(targetBoxRoot, single(headers.authorization))) return true;
      // The local-dev browser key (core/browse-key.ts), for an agent driving a
      // real Chromium. Constant false unless the operator set BBX_BROWSE_API_KEY.
      if (verifyBrowseKey(headers)) return true;
      return (await resolveMobileRequestAuth(targetBoxRoot, headers)) !== null;
    },

    // The pure gate's first box rung takes only headers, so it can't know the
    // target box (the agent token is per-box). Agent-bearer verification is
    // folded into `resolveMobileForBox` above, where the box root is in hand;
    // this rung stays a no-op so the ladder falls through to it. (B.1's fake
    // injects a real one purely to exercise the rung in the truth table.)
    isAgentBearer(): boolean {
      return false;
    },

    async resolveWorktreeAsset(headers: RouterHeaders, targetWorktree: string): Promise<boolean> {
      // Non-sensitive Vite dev assets (`@vite`/`src`/`node_modules`/…): reachable
      // by ANY valid box credential in the worktree, so an iOS webview holding
      // only a per-box mobile token can load the dev SPA shell. The picker/API
      // stay session-only — this class is deliberately separate (plan B.2b).
      const entries = await boxEntriesFor(targetWorktree);
      if (entries === null) return false; // unknown worktree ⇒ fail closed
      // A session (owner, or a member of ANY box here) satisfies — the owner's
      // own dev SPA. Cheap ACL reads; short-circuits on the first hit.
      const email = sessionEmail(headers);
      if (email) {
        const ownerEmail = getOwnerEmail();
        if (ownerEmail && email === ownerEmail) return true;
        for (const entry of entries) {
          if (await canAccessBox({ boxRoot: entry.contentDir, email, ownerEmail })) return true;
        }
      }
      // Otherwise a per-box mobile token (or agent bearer) for ANY box here. Cost
      // is O(boxes): the cookie path is pure HMAC per box; the bearer path reads
      // one box's device store per iteration until a match. Short-circuits.
      // The browse key is worktree-wide by nature: it authenticates a browser,
      // and a browser cannot render the app without Vite's dev modules. It is
      // checked outside the per-box loop because it is not per-box.
      if (verifyBrowseKey(headers)) return true;
      const authorization = single(headers.authorization);
      for (const entry of entries) {
        if (verifyAgentBearer(entry.contentDir, authorization)) return true;
        if ((await resolveMobileRequestAuth(entry.contentDir, headers)) !== null) return true;
      }
      return false;
    },

    hasBrowseKey(headers: RouterHeaders): boolean {
      // The `dev-read` rung, and the ONLY credential that rung adds beyond the
      // owner session. Kept as its own dep rather than reusing
      // `resolveWorktreeAsset` so the dev surfaces do not silently inherit that
      // resolver's wider set (per-box mobile tokens, per-box agent bearers).
      // Constant false unless the operator set BBX_BROWSE_API_KEY.
      return verifyBrowseKey(headers);
    },

    isCsrfSafe(headers: RouterHeaders): boolean {
      // Same-origin assertion for a MUTATING control request. `Sec-Fetch-Site`
      // is the primary signal (a real browser always sends it): `same-origin`
      // is our own form POST; `none` is a top-level navigation (the user typed
      // the URL / used a bookmark) — both safe. `cross-site`/`same-site` unsafe.
      const site = single(headers["sec-fetch-site"]);
      if (site !== undefined) return site === "same-origin" || site === "none";
      // No `Sec-Fetch-Site` (older/non-browser client): fall back to `Origin`.
      // A present Origin must match this request's own Host to be safe.
      const origin = single(headers["origin"]);
      // No `Sec-Fetch-Site` AND no `Origin` ⇒ NO provenance at all: fail closed
      // (expose-dev-router B.2c / finding 3.2). Previously this returned `true`,
      // which let an old/stripped client carrying the owner cookie reach a
      // mutating TCP control route. Nothing legitimate needs the permissive
      // fallback on TCP: local tooling arrives on the UDS (trustedLocal, which
      // bypasses CSRF entirely), and every real browser sends `Sec-Fetch-Site`.
      // A same-origin link/typed-URL to the control routes is reached WITH
      // `Sec-Fetch-Site: same-origin`/`none` (handled above), so this only
      // rejects provenance-less requests, which are exactly the CSRF-shaped ones.
      if (origin === undefined) return false;
      const host = single(headers["host"]);
      if (host === undefined) return false;
      try {
        return new URL(origin).host === host;
      } catch (_e) {
        return false; // unparseable Origin ⇒ treat as unsafe
      }
    },
  };
}
