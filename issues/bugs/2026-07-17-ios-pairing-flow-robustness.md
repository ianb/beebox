---
title: "iOS pairing-flow robustness: duplicate redeem, no external-URL confirm, in-memory ticket races idle-stop"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — beebox/docs/plans/ios-companion-review-2026-07-17.md
priority: backlog
---

**2026-10-17 note (partly resolved):** iOS pairing now goes through the shared `apple-shared` package: one redeem per ticket, and failures are shown to the person. Still open: external-link confirmation on iOS, and the in-memory ticket racing idle-stop. See [the plan](../../beebox/docs/plans/mac-app-shell.md).

Several related weaknesses in the `beebox://pair` deep-link flow, all still open as of the
2026-07-17 review:

**Duplicate deep-link handling races a single-use token.** Both `BeeBoxApp.onOpenURL` and
`BeeBoxAppDelegate.application(open:)` (which routes through `PairingURLInbox`) are wired to fire
on the same incoming `beebox://pair` URL, and both call `PairedBoxStore.pair(from:)`
(`ios-app/BeeBox/Storage/PairedBoxStore.swift`). A single QR scan or deep link can trigger two
concurrent redeem POSTs to `/api/pairing/redeem` against one single-use pairing token; the loser 401s.
It currently works "by luck" of the losing branch's `addOrSelectBox` not being reached — fragile.

**No confirmation before auto-redeeming an external baseURL, and no https requirement.**
`PairedBoxStore.pair` accepts any `beebox://pair?baseURL=<x>&pairingToken=<y>` — including one
opened from outside the app (a link in a message, a malicious webpage) — and immediately POSTs to
`<x>/api/pairing/redeem`, stores whatever token comes back, and loads `<x>` inside the app's authed-looking
chrome. There's no user-visible "Add this box?" confirmation and no scheme check (plain `http` is
accepted). This is a clean phishing surface: attacker-controlled content renders inside what looks like
the trusted app shell.

**Pending pairing tickets are in-memory only and can race the hub's idle-stop.** Tickets minted by
`createMobilePairingTicket` (`beebox/src/core/mobile/pairing.ts`) live only in an in-process
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

## Audit 2026-10-22

The scheme half of the second weakness is fixed. `PairingTransport` (`apple-shared/Sources/BeeBoxShared/PairingTransport.swift:19-22`) refuses plain `http` to any host that is not loopback, `.local`, or a private, link-local, or Tailscale address, before redeem (`005299baf`). No "Add this box?" confirmation exists for an externally opened link. Pending tickets are still in the process-local `pendingPairings` map (`beebox/src/core/mobile/pairing.ts:66`), so the idle-stop race remains.

Re-reviewed 2026-10-30: two items remain open: no confirmation before redeeming an externally opened pairing link, and pending tickets held in memory (10-minute TTL) while the hub idle-stops after 5 minutes. Duplicate redeem, silent failures, and the plain-http case are fixed.

Out of date in the body above: Retitle to the two open items (external-link confirmation; in-memory ticket vs idle-stop) and collapse the original four-part body into a short 'resolved' list, since duplicate redeem, silent failure, and http are fixed per the 2026-10-17 note and 2026-10-22 audit.
