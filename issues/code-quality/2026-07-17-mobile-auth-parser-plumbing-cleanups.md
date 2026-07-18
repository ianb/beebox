---
title: "Mobile auth parser/plumbing cleanups: duplicated token parser, unanchored redeem-URL match, no token expiry, param drift"
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
---

A grab-bag of internal-consistency issues around mobile auth plumbing, none urgent alone but worth
tracking together:

- **`mobileTokenFromUrl` duplicated verbatim 3×** — a security-relevant query-param parser copy-pasted
  across `callback-box/src/hub/hub-server.ts`, `callback-box/src/webapp/server-box-scope.ts`, and
  `callback-box/src/webapp/server-root.ts`. Should be hoisted to one shared implementation so a future
  fix (e.g. tightening validation) doesn't need three edits kept in sync by hand.
- **`isPairingRedeemUrl` uses an unanchored `endsWith` match** (`callback-box/src/webapp/routes/pairing.ts`)
  — `path.endsWith("/api/pairing/redeem")` matches `/anything/api/pairing/redeem`, not just the intended
  route. Low risk since the redeem endpoint is token-gated and effectively read-only, but still worth
  anchoring properly.
- **Device tokens have no expiry or rotation** — `MobileDevice` (`callback-box/src/core/mobile/pairing.ts`)
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
