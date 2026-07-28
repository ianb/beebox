---
title: "Always-on personalized dashboard view for the Echo Show (device auth + Silk keepalive)"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder chose this after Echo Show research
needs: [design]
---

The buildable feature that came out of the
[Echo Show display research](../exploration/2026-07-27-echo-show-dashboard-display.md):
a personalized dashboard web page that shows *"the things I care about,"* stays
up on an Echo Show via the muted-audio Silk keepalive, and is touch-interactive.
The page-trick is the easy part; the boxholder correctly split the real work into
three pieces, and **the dashboard itself is the greater issue.**

## 1. The dashboard (the greater issue — needs design)

A personalized, display-optimized dashboard of what the boxholder cares about.
`src/frontend/src/pages/DashboardPage.tsx` + `components/dashboard/` exist as a
starting point, but the open questions are the substance:

- **What's on it, and how is it personalized?** Which cards/landmarks/questions/
  status/upcoming items — and is the selection configured (a box config card? a
  saved layout?) or derived? This is where most of the design work is.
- **Display-optimized layout** — glanceable, larger type, wall-distance
  readable, degrades to the Echo Show's aspect ratios (Show 5/8/10/15 differ).
- **Read-only + touch drill-in** — the Echo Show is a touchscreen, so tapping a
  tile can open detail; but it's a display, not the full app (no composer, no
  destructive actions from the ambient view).
- **Refresh** — live-ish (SSE/poll) vs. periodic; a wall panel doesn't need
  per-keystroke reactivity.

This piece deserves its own design pass; it's not just "the existing dashboard
at a URL."

## 2. Auth for a shared, always-on device

A kitchen Echo Show can't do OAuth and must not hold a full owner session. Needs
a **device-scoped, read-only, long-lived display token** — reuse the mobile
device-token / pairing model already in `src/core/mobile/` (`request-auth.ts`,
`mobile-session.ts`, `pairing.ts`) and `src/webapp/routes/pairing.ts` /
`server-box-scope.ts`, but scoped down to *read-only display* rather than full
mobile capability. The token rides in the URL (so Silk can be pointed at it once
and bookmarked) or a paired-device cookie. Reachable over Tailscale or a public
box URL.

Related: [mobile device token no expiry](../code-quality/2026-07-19-mobile-device-token-no-expiry.md)
— a display token wants a deliberate lifetime policy from the start.

## 3. Silk-gated audio keepalive

The persistence fix (see the research item): a muted `<audio>` loop keeps Silk
from timing out to the home screen. **Gate it on the Silk user agent** so only
the Echo Show gets it — a normal desktop/mobile browser opening the same
dashboard must NOT start playing silent audio. Detect Silk server-side from the
`User-Agent` (Silk's UA contains `Silk`) and only inject the keepalive element/
script for those clients; everything else gets the plain page. No existing Silk
detection in the codebase yet (there's UA-adjacent handling in
`webapp/routes/chat-helpers.ts` `classifyChannel` and the admin
NotificationsSection, but nothing for Silk). Small, self-contained, and the last
mile — do it after 1 and 2.

## Shape

All three reduce to the same core the research identified: a **device-scoped,
read-only dashboard feed**. Paths for other screens (Fire TV / HDMI kiosk) reuse
1 + 2 and skip the Silk-specific keepalive. Build order: auth (2) → dashboard
view (1, the big one) → Silk keepalive (3).
