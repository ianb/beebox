---
title: "Mobile contract small cleanups: unanchored redeem-URL match, embed=1 param drift, resolvedSession swallows 5xx"
workstream: mobile-token-handshake
area: beebox
filed-by: agent
discovered-in: worktree-mobile-token-handshake — carried over from the closed parser-plumbing issue
resolution: implemented
---

Resolved 2026-08-07 in `worktree-mobile-contract-cleanups`, commit 294ac811. All three bullets
fixed: `isPairingRedeemUrl` now anchors the box-prefixed match with
`/^\/[^/]+\/api\/pairing\/redeem$/`; the web frontend retired `embed=1` in favor of
`nativeComposer=1` only; and iOS `ChatAPI.resolvedSession()` now throws on non-2xx instead of
silently falling back to `"new"`. Docs (`docs/mobile-contract.md`) and tests updated to match.

Sibling to [iOS small cleanups](../../code-quality/2026-07-17-ios-small-cleanups.md) — that one is native-side
housekeeping, this one is the cross-platform contract surface; worth triaging together.

The three bullets that survived
`../closed/code-quality/2026-07-17-mobile-auth-parser-plumbing-cleanups.md` when its
duplicated-parser half was resolved. Independent of each other; none urgent.

- **`isPairingRedeemUrl` uses an unanchored match.** `beebox/src/webapp/routes/pairing.ts:11-13`:
  `path === "/api/pairing/redeem" || path?.endsWith("/api/pairing/redeem") === true`. The
  `endsWith` arm matches `/anything/api/pairing/redeem`, not just the box-prefixed route it
  intends. Low risk — the endpoint is token-gated and effectively read-only, and it is a
  deliberate unauthenticated bypass in both `server-box-scope.ts` and `hub-server.ts`, which is
  exactly why the matcher should be precise. Anchor it to `^/[^/]+/api/pairing/redeem$` plus
  the bare form. Note `test/webapp/pairing-routes.test.ts` currently asserts the loose
  behavior ("accepts box-prefixed routes"), so that test moves with the fix.

- **`embed=1` and `nativeComposer=1` both reach the same gate.** The web frontend
  (`pages/ChatPage.tsx`, `router.tsx`) still parses both even though iOS only ever sends
  `nativeComposer=1` (`ios-app/BeeBox/Models/PairedBox.swift` · `chatURL`). Standardize on
  one so a future Android client has one thing to learn. `docs/mobile-contract.md` §8 lists
  `nativeComposer=1` as the mirrored constant, so `embed=1` is the one to retire — but grep for
  live callers first; several doctests use `?embed=1`.

- **`resolvedSession` maps any non-2xx to `"new"`.** `ios-app/BeeBox/Services/ChatAPI.swift`
  · `resolvedSession()` treats a transient 5xx the same as "no session exists yet," silently
  forking a new session and resetting diarization speaker-letter numbering back to "A". A
  server hiccup should surface, not quietly restart the conversation. `docs/mobile-contract.md`
  §7 row H2 already marks this SILENT.
