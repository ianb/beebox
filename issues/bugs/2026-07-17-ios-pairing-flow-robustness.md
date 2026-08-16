---
title: "iOS pairing-flow robustness: duplicate redeem, no external-URL confirm, in-memory ticket races idle-stop"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
priority: backlog
---

Several related weaknesses in the `callbackbox://pair` deep-link flow, all still open as of the
2026-07-17 review:

**Duplicate deep-link handling races a single-use token.** Both `CallbackBoxApp.onOpenURL` and
`CallbackBoxAppDelegate.application(open:)` (which routes through `PairingURLInbox`) are wired to fire
on the same incoming `callbackbox://pair` URL, and both call `PairedBoxStore.pair(from:)`
(`ios-app/CallbackBox/Storage/PairedBoxStore.swift`). A single QR scan or deep link can trigger two
concurrent redeem POSTs to `/api/pairing/redeem` against one single-use pairing token; the loser 401s.
It currently works "by luck" of the losing branch's `addOrSelectBox` not being reached — fragile.

**No confirmation before auto-redeeming an external baseURL, and no https requirement.**
`PairedBoxStore.pair` accepts any `callbackbox://pair?baseURL=<x>&pairingToken=<y>` — including one
opened from outside the app (a link in a message, a malicious webpage) — and immediately POSTs to
`<x>/api/pairing/redeem`, stores whatever token comes back, and loads `<x>` inside the app's authed-looking
chrome. There's no user-visible "Add this box?" confirmation and no scheme check (plain `http` is
accepted). This is a clean phishing surface: attacker-controlled content renders inside what looks like
the trusted app shell.

**Pending pairing tickets are in-memory only and can race the hub's idle-stop.** Tickets minted by
`createMobilePairingTicket` (`callback-box/src/core/mobile/pairing.ts`) live only in an in-process
`pendingPairings` Map with a 10-minute TTL. If the hub lazily idle-stops the box (commonly ~5 minutes)
while a QR code or link is still sitting unredeemed, the box process restarts, the Map is wiped, and
the eventual redeem 401s on a ticket that was still technically within its TTL — a real, reachable race
given how commonly a user might scan a QR code and then get distracted for a few minutes.

**Redeem/pair failures are silent.** Any non-2xx from `/api/pairing/redeem` is mapped by iOS to
`URLError(.userAuthenticationRequired)`, and `PairedBoxStore.pair` swallows it, simply returning
`false`. None of the above failure modes (duplicate-redeem loser, phishing-confirm gap, idle-stop race)
surface anything to the user beyond pairing silently not working — no toast, no error state.

Fix direction (bundled since they touch the same flow): consolidate to a single deep-link entry point;
add an explicit confirmation step for externally-sourced pairing URLs with an https requirement; either
persist pending tickets somewhere that survives a box restart or shrink the TTL well under the idle-stop
window and communicate it in the UI; and surface redeem/pair failures to the user instead of a silent
`false`.
