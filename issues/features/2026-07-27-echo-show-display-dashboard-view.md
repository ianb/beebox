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

**Not** the existing app-coded `src/frontend/src/pages/DashboardPage.tsx` /
`components/dashboard/` — that's explicitly the wrong model. The dashboard is
**a new card type with a custom card-attached view**, and the **box agent
actively manages the display at a fairly intimate level.** The personalization
comes from the *agent curating the card*, not from app code or a config screen.

Concretely (design to be worked out):

- **A new box-local card type** (e.g. a `dashboard` card, schema under the box's
  `config/schemas/`), whose body/fields describe what to show and how — the
  agent writes and continuously updates it.
- **A custom view attached to that card** — a view-widget (the
  `callback-box/view-widgets` specifier; views are `?view=…` on the card's
  `browse/<path>`, per our card-attached-view model) that renders the card as the
  display surface. This is the "custom web page" the Echo Show points at.
- **Agent-managed at an intimate level** — the agent decides what belongs on the
  dashboard right now (priorities, what's stale, what to surface), and keeps the
  card current on wakeups / as things change. The design question is how much the
  card encodes *content* vs. *layout intent*, and how the agent is prompted to
  tend it — this is closer to the "arrange context, don't automate judgment"
  posture than to a fixed template.

Still true regardless of the above:
- **Display-optimized rendering** — glanceable, larger type, wall-distance
  readable, degrades across Echo Show aspect ratios (Show 5/8/10/15 differ).
- **Read-only + touch drill-in** — the Show is a touchscreen, so a tile can open
  detail, but it's a display, not the full app (no composer, no destructive
  actions from the ambient view).
- **Refresh** — live-ish (SSE/poll) vs. periodic; a wall panel doesn't need
  per-keystroke reactivity.

This is the substantial, design-first piece: a card type + its view + the
agent-tending model, not "the existing dashboard at a URL."

## 2. Auth for a shared, always-on device (the hard part)

A kitchen Echo Show can't do OAuth and must not hold a full owner session. This
is the genuinely hard piece. Both viable options ultimately rest on the *same*
trust primitive — **an unguessable secret grants read access** — so the real
choice is **where the private data lives** and **whether the page is live**.

### Option A — external published page (box never exposed)

Reuse the publish-pages pipeline (`src/publish/` — `cb pub`, `manifest.ts`,
`submission.ts`, `pub-worker-meta.ts`, `leak-scan.ts`, `setup.ts`;
`docs/plans/publish-pages.md`). The box **renders the dashboard and publishes a
static artifact**; the Echo Show fetches that. The box's fail-closed auth is
never touched.

- **Cost:** you deliberately put **private personalized data on an external host**
  (behind URL secrecy). `leak-scan` guards that boundary for *public* content,
  but a personal dashboard is *intended*-private, so it can't protect you here.
- It's a **snapshot** — no live data, **no touch drill-in** — and wiring the
  publish pipeline to a frequently-refreshed private page is the "hard to
  implement" part.
- **Wins only if** the hard requirement is "the box must never be reachable from
  the display at all."

### Option B — live page, read-only device token (recommended, scoped hard)

Extend the mobile device-token / pairing model in `src/core/mobile/`
(`request-auth.ts`, `mobile-session.ts`, `pairing.ts`) + `routes/pairing.ts` /
`server-box-scope.ts`. **Not a novel hole:** paired phones already authenticate
with a box-scoped device token (`cb_mobile`) instead of OAuth. A display token is
a **strictly narrower sibling** — read-only, unlocks *only* the one dashboard-card
view, revocable, per-device, rate-limited. Blast radius of a leak = "someone sees
the dashboard," not "controls the box" — arguably the least-privileged credential
in the system. Token rides in the URL so Silk can bookmark it once; stays **live
and touch-interactive**.

**Lean: B, scoped hard.** Keeps data on the box (where revocation/access controls
already live), less capability than a credential we already trust on phones, and
preserves the live+touch properties that make the Echo Show better than a TV.
"Scary" shrinks once you write down what the token can actually do.

### Wrinkle either way: Cloudflare Access

The prod box currently sits behind a Cloudflare Access wall
([cloudflare-access-walling-prod-box](../closed/bugs/2026-07-21-cloudflare-access-walling-prod-box.md)).
**B** needs the token route to pass *through* Access (or an Access bypass for that
one path); **A** sidesteps Access by living on the pub host. Pin this down before
building.

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
