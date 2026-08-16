---
title: "Display callback-box on an Echo Show (Alexa skill vs. a wall dashboard)"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder asked to research
---

> **Outcome:** the boxholder chose path 1 (web page + muted-audio keepalive). The
> buildable feature is filed at
> [Always-on personalized dashboard view for the Echo Show](../features/2026-07-27-echo-show-display-dashboard-view.md);
> this item stays as the research/rationale behind that choice.

The boxholder wants box content up on an **Echo Show** screen — ideally a nice
always-on dashboard. Open question whether that needs an **Alexa app/skill** at
all, or whether it's better framed as a **display-optimized dashboard view** the
Echo Show's browser points at. Leaning toward the latter; the research below is
why.

## Research (2026-07-27)

Two substantive ways to get custom content onto an Echo Show, each with a real
catch:

### 1. Point the Echo Show browser at a dashboard URL (no app)

The Echo Show has a built-in **Silk browser**; you can open a URL and render any
web page — including a callback-box dashboard we already have
(`src/frontend/src/pages/DashboardPage`). This is by far the least effort.

**The catch — no persistence.** The Echo Show reverts to its home screen and
closes the browser after inactivity, so the dashboard doesn't *stay* up. This is
the single most-reported problem in the smart-display community
([How I turned my Echo Show into a Home Assistant control panel](https://www.howtogeek.com/how-i-turned-my-echo-show-into-a-home-assistant-control-panel/)).
The common workaround — **[Fully Kiosk Browser](https://community.hubitat.com/t/echo-show-15-works-as-dashboard-with-fully-kiosk-browser/111126)**
to lock a device to one URL — runs on Fire *tablets*, not the locked-down modern
Echo Show, so it doesn't straightforwardly apply. A lighter hybrid people use is
a tiny **"open my dashboard" Alexa skill** that just launches the URL in the Silk
browser on voice command
([MyPage Echo Show skill](https://community.hubitat.com/t/mypage-echo-show-skill-to-show-he-dashboard/103972)) —
which still doesn't solve the revert-to-home timeout.

**The other catch — auth on a shared, always-on device.** Our dashboard is
behind login; an Echo Show in a kitchen can't do an OAuth dance and shouldn't
hold a full owner session. This wants a **read-only, device-scoped display view**
(a long-lived display token in the URL, or a per-device pairing like the mobile
device tokens) reachable over Tailscale or a public URL. That view — a
wall-display-shaped, non-interactive dashboard with simplified auth — is the real
deliverable here, and it's **independent of Alexa entirely**. It'd also serve any
other always-on screen (a spare tablet, a Pi, a TV).

### 2. A real Alexa skill with APL (voice-launched, native rendering)

**[Alexa Presentation Language (APL)](https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/add-visuals-and-audio-to-your-skill.html)**
lets a custom skill render rich visual templates on Echo Show (JSON: an APL
*document* for layout + a *data source* for content). Voice invocation ("Alexa,
open my callback box") is the real upside, and there's an
[APL Authoring Tool](https://developer.amazon.com/en-US/alexa/alexa-skills-kit/get-deeper/response-api/multimodal)
and multimodal response builder.

**Costs / limits:**
- Building a skill = an Alexa skill definition + a hosted endpoint (Lambda or our
  own HTTPS endpoint the box exposes) + hand-authored APL. Non-trivial, a whole
  new integration surface to maintain.
- **APL is a constrained layout language**, not a browser — we'd re-implement a
  subset of the dashboard in APL rather than reuse our React UI.
- **Public use needs Amazon certification**; a private/dev skill avoids that but
  is fiddly to keep installed.
- **Still not persistent** — skill sessions time out and the device returns to
  home, same as the browser. A skill does not give you an always-on display.

## The tension

The boxholder's actual want — *"a nice dashboard" always up on the Echo Show* —
is a **kiosk/always-on-display** problem, and **neither path fully solves the
persistence timeout** that Amazon builds into the device. So:

- If the goal is **glanceable content on the screen**, the highest-leverage work
  is a **display-optimized, device-auth dashboard view** (path 1's real half),
  which pays off on every screen, not just Echo Show. The Echo-Show-specific
  persistence is a fight with Amazon's UX we may only partially win.
- A **skill (path 2)** is only worth it if **voice invocation** or native APL
  polish is specifically wanted, and even then it's a large new surface for a
  display that still won't stay pinned.

Recommendation to explore first: the wall-display dashboard view + device-scoped
read-only auth, decoupled from Alexa. Revisit an APL skill separately if
voice-launch turns out to matter.

## Research round 2 (2026-07-27): getting a *custom web page* to actually stick

Deeper dig, aimed at the boxholder's actual goal — *regularly and easily show a
personalized custom web page*. Good news: the persistence problem that made path
1 look weak is **solvable**, and the fix is something callback-box can own.

### The Silk timeout is real — but there's a known keepalive hack

Silk on the Echo Show returns to the home screen after inactivity (reports range
from ~45s to ~10–15 min), and **Amazon support confirms the timeout can't be
disabled**
([Amazon forum](https://amazonforum.my.site.com/s/question/0D54P00006zStneSAC/is-it-possible-to-keep-echo-show-from-automatically-closing-the-web-browser-silk-or-firefox),
[Tom's Guide](https://www.tomsguide.com/opinion/i-got-the-echo-show-15-and-its-great-except-for-this-one-flaw)).
Since Amazon also killed Fully-Kiosk sideloading, the surviving workaround is a
**muted background-audio loop embedded in the page** — Silk counts audio
playback as activity and keeps the tab open indefinitely. The self-hosted
dashboard project *Homepage* documents exactly this
([keep-silk-open discussion](https://github.com/gethomepage/homepage/discussions/2853)).

**This is the key unlock:** our own display page can include a tiny muted-audio
keepalive so it holds *itself* open on the Echo Show. Persistence stops being an
Amazon fight and becomes a ~10-line feature in the dashboard view we build. The
only remaining manual step is opening the URL once (and re-opening after a
reboot); a Silk bookmark / homepage makes that a couple taps.

So **path 1 is genuinely viable for "a custom web page"**: a device-scoped,
read-only, display-optimized dashboard page + a muted-audio keepalive, opened
once in Silk. And because the Echo Show is a **touchscreen**, that page is
actually *interactive* (tap to drill in) — unlike a TV kiosk, which is the
boxholder's stated frustration with the TV route.

### Fallback with zero browser fiddling: render-to-image → Photo Frame

If even "open the URL once" is too much, the Echo Show's native **Photo Frame /
ambient mode** shows an Amazon Photos album full-screen, clock/UI removed, and is
persistent by design
([Echo Show as a photo frame](https://www.techhive.com/article/831563/amazon-echo-show-photo-frame.html)).
Approach: render the dashboard to an image, push it to an Amazon Photos
album, let ambient mode cycle it. (NOTE 2026-08-01: this originally said
`cb render`, which has since been removed. `bin/browse` screenshots the real
running app and is the replacement — heavier, but it produces a true image.) Persistence is free and requires no browser —
but it's a **static image, not interactive**, refreshes slowly (album re-pull,
not real-time), and Amazon Photos has no clean upload API (automation is the
awkward part). Good "glance a few times a day" option; not a live page.

### Most-native, most-persistent, but not a web page: APL Widgets

Since Oct 2023, **Alexa APL Widgets** put a persistent, glanceable tile on the
Echo Show home screen (no timeout; Echo Show 15 has a standing Widget Panel),
with quick touch actions
([APL Widgets](https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/about-widgets-and-apl.html),
[how-to](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2023/10/alexa-apl-widgets-october-2023)).
Truly always-on and interactive — but it's **APL, not HTML**, so we'd rebuild a
constrained slice of the dashboard in APL and ship+maintain a skill. Highest
effort, least layout freedom, only worth it for deep native integration.

### Verdict for the stated goal

For *"regularly and easily display a custom web page,"* the winner is **path 1
with the muted-audio keepalive**: it literally shows our web page, it's touch-
interactive, and callback-box can make it robust by building (a) a device-token
read-only display view and (b) the keepalive into that view. The image→Photo-
Frame route is the fallback when "open the URL once" is unacceptable; APL Widgets
only if we want a native home-screen tile. All three still reduce to the same
core deliverable: a **device-scoped, read-only dashboard feed** — HTML for
paths 1/3, an image for path 2.

## Related

- [Roku TV dashboard display](2026-07-27-roku-tv-dashboard-display.md) — sibling
  surface; shares the device-scoped display-feed core (delivered as an HTML URL
  here, an image feed there).
- [GitHub Pages / story-eval site](../features/2026-07-20-public-site.md) —
  other external-surface display work.
- Device-scoped auth overlaps the mobile device-token model
  ([mobile device token no expiry](../code-quality/2026-07-19-mobile-device-token-no-expiry.md)) —
  a display token would reuse that thinking.
