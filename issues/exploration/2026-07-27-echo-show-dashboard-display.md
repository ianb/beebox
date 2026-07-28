---
title: "Display callback-box on an Echo Show (Alexa skill vs. a wall dashboard)"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder asked to research
---

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

## Related

- [GitHub Pages / story-eval site](../features/2026-07-20-github-pages-site.md) —
  other external-surface display work.
- Device-scoped auth overlaps the mobile device-token model
  ([mobile device token no expiry](../code-quality/2026-07-19-mobile-device-token-no-expiry.md)) —
  a display token would reuse that thinking.
