---
title: "Mobile contract small cleanups: unanchored redeem-URL match, embed=1 param drift, resolvedSession swallows 5xx"
area: callback-box
filed-by: agent
discovered-in: worktree-mobile-token-handshake — carried over from the closed parser-plumbing issue
---

Sibling to [iOS small cleanups](2026-07-17-ios-small-cleanups.md) — that one is native-side
housekeeping, this one is the cross-platform contract surface; worth triaging together.

The three bullets that survived
`../closed/code-quality/2026-07-17-mobile-auth-parser-plumbing-cleanups.md` when its
duplicated-parser half was resolved. Independent of each other; none urgent.

- **`isPairingRedeemUrl` uses an unanchored match.** `callback-box/src/webapp/routes/pairing.ts:11-13`:
  `path === "/api/pairing/redeem" || path?.endsWith("/api/pairing/redeem") === true`. The
  `endsWith` arm matches `/anything/api/pairing/redeem`, not just the box-prefixed route it
  intends. Low risk — the endpoint is token-gated and effectively read-only, and it is a
  deliberate unauthenticated bypass in both `server-box-scope.ts` and `hub-server.ts`, which is
  exactly why the matcher should be precise. Anchor it to `^/[^/]+/api/pairing/redeem$` plus
  the bare form. Note `test/webapp/pairing-routes.test.ts` currently asserts the loose
  behavior ("accepts box-prefixed routes"), so that test moves with the fix.

- **`embed=1` and `nativeComposer=1` both reach the same gate.** The web frontend
  (`pages/ChatPage.tsx`, `router.tsx`) still parses both even though iOS only ever sends
  `nativeComposer=1` (`ios-app/CallbackBox/Models/PairedBox.swift` · `chatURL`). Standardize on
  one so a future Android client has one thing to learn. `docs/mobile-contract.md` §8 lists
  `nativeComposer=1` as the mirrored constant, so `embed=1` is the one to retire — but grep for
  live callers first; several doctests use `?embed=1`.

- **`resolvedSession` maps any non-2xx to `"new"`.** `ios-app/CallbackBox/Services/ChatAPI.swift`
  · `resolvedSession()` treats a transient 5xx the same as "no session exists yet," silently
  forking a new session and resetting diarization speaker-letter numbering back to "A". A
  server hiccup should surface, not quietly restart the conversation. `docs/mobile-contract.md`
  §7 row H2 already marks this SILENT.
