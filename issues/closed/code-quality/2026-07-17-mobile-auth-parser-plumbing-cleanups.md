---
title: "Mobile auth parser/plumbing cleanups: duplicated token parser, unanchored redeem-URL match, no token expiry, param drift"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — beebox/docs/plans/ios-companion-review-2026-07-17.md
resolution: superseded
---

**Closed 2026-07-19 as superseded, not fully implemented.** Only the first bullet is
resolved: the duplicated `mobileTokenFromUrl` parser is gone — not hoisted, but deleted
outright, since the query-param carrier it parsed no longer exists. Done in
`../../../beebox/docs/implemented-plans/mobile-token-handshake.md`; the single resolver every mobile
gate now uses is `beebox/src/core/mobile/request-auth.ts`.

The token-expiry bullet moved to `../../code-quality/2026-07-19-mobile-device-token-no-expiry.md`.
The remaining three bullets — the unanchored `isPairingRedeemUrl` match, the `embed=1` vs
`nativeComposer=1` param drift, and `resolvedSession` mapping any non-2xx to `"new"` — are
re-filed as `2026-07-19-mobile-contract-small-cleanups.md` rather than left buried in a
closed file.

---

A grab-bag of internal-consistency issues around mobile auth plumbing, none urgent alone but worth
tracking together:

- **`mobileTokenFromUrl` duplicated verbatim 3×** — a security-relevant query-param parser copy-pasted
  across `beebox/src/hub/hub-server.ts`, `beebox/src/webapp/server-box-scope.ts`, and
  `beebox/src/webapp/server-root.ts`. Should be hoisted to one shared implementation so a future
  fix (e.g. tightening validation) doesn't need three edits kept in sync by hand.
- **`isPairingRedeemUrl` uses an unanchored `endsWith` match** (`beebox/src/webapp/routes/pairing.ts`)
  — `path.endsWith("/api/pairing/redeem")` matches `/anything/api/pairing/redeem`, not just the intended
  route. Low risk since the redeem endpoint is token-gated and effectively read-only, but still worth
  anchoring properly.
- **Device tokens have no expiry or rotation** — `MobileDevice` (`beebox/src/core/mobile/pairing.ts`)
  only tracks `revokedAt`, no `expiresAt`. Combined with the token-in-URL leak issue (filed separately),
  this means a leaked token is valid forever absent a manual revoke.
- **Legacy `embed=1` vs `nativeComposer=1` both reach the same `usesNativeShell` gate** — the web frontend
  (`ChatPage.tsx`, `router.tsx`) still parses both search params even though iOS only ever sends
  `nativeComposer=1`. Worth standardizing on one param name (Android, when it exists, would only need to
  learn the current one).
- **`resolvedSession` maps any non-2xx to `"new"`** — `ChatAPI.swift` (`resolvedSession()`) treats a
  transient server 5xx the same as "no session exists yet," silently forking a new session and resetting
  diarization speaker-letter numbering back to "A" instead of surfacing the error.
- **Benign field drifts** — the `/api/pairing/redeem` response includes `boxSlug`/`label`/`deviceId`/
  `deviceLabel` that iOS's `PairingRedeemResponse` decode ignores (reads only `token`); the emission
  receipt's `deduplicated` field on `sent` dispositions is likewise decoded and ignored by
  `ChatWebView.swift`. Not causing bugs today, but worth cleaning up if those shapes are touched again —
  and relevant context for anyone building the Android app against the same contract.
