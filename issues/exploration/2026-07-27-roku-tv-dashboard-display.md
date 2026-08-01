---
title: "Display callback-box on Roku TVs (custom channel / screensaver)"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder asked to research
---

Same want as the [Echo Show dashboard](2026-07-27-echo-show-dashboard-display.md):
get box content up on the **Roku TVs**, ideally an always-on glanceable
dashboard. Roku is a different beast, though — the Echo Show's "just open a URL"
path does **not** exist here.

## Boxholder assessment (2026-07-27): Roku-native is likely not worth it

After the research below, the boxholder's read is that the **Roku dev experience
is too hard to justify** — BrightScript + SceneGraph is a niche proprietary
language, no browser/webview, per-device sideloading, and a slow
edit-package-upload loop, all to render what's essentially a static frame. Don't
pursue a native Roku channel unless that calculus changes.

**The escape hatch:** the pain is *Roku-specific*, not "TV"-specific. Any
**browser-capable HDMI device** on the same TV avoids all of it and reuses the
[Echo Show](2026-07-27-echo-show-dashboard-display.md) path (dashboard URL +
kiosk) with zero Roku code — e.g. a Fire TV Stick (has the Silk browser), a
cheap Android TV box, or a Raspberry Pi in kiosk mode. If a TV dashboard is
wanted, that's the route; the Roku-native notes below are kept only for
reference.

## Research (2026-07-27)

### The decisive difference: Roku has no web browser

Unlike the Echo Show's Silk browser, **Roku ships no general web browser and no
webview** — you cannot point it at our React dashboard URL. Custom on-screen
content requires a **channel written in Roku's proprietary
[BrightScript + SceneGraph](https://developer.roku.com/dev/docs/hello-world)**
(`.brs` logic + `.xml` layout, packaged as a ZIP). That's a whole toolchain and
language nothing in the monorepo currently touches.

### Install path: Developer Mode sideload (no certification)

For personal use you don't need the public channel store. Enable **Developer
Mode** on the device and upload a channel ZIP to the Roku's IP (`rokudev` login);
the dev channel sits on the home screen until replaced/deleted
([sideload guide](https://www.ottengine.com/blog/how-to-sideload-roku-channel-developer-mode)).
Fine for our own TVs; per-device and manual, but no Amazon-style cert gauntlet.

### The good angle: a custom screensaver channel

Roku supports **custom screensavers**, buildable in SceneGraph since OS 7.2
([screensaver tutorial](https://blog.roku.com/developer/tutorial-screensavers),
[docs](https://developer.roku.com/dev/docs/screensavers)). A screensaver
activates when the TV goes idle — which is *exactly* the "always-on dashboard
when nobody's actively watching" behavior we want, and it sidesteps the Echo
Show's revert-to-home persistence problem entirely. Restrictions: **no
user-input components** and no ads/purchasing — but a read-only dashboard needs
neither. This is probably the best-fit surface on Roku.

### Clean architecture: box renders, thin channel displays

Because Roku can't run our web UI, the sane split is:

- **The box renders the dashboard to an image.** NOTE (2026-08-01): the SSR
  render capability this assumed (`cb render`, `src/ssr/`) has been removed —
  it emitted an empty body and nobody used it. Re-cost this step. The nearest
  replacement is `bin/browse`, which drives real headless Chromium and can
  screenshot, so image output is still reachable but by a heavier path.
- **A thin Roku channel/screensaver fetches that image** over HTTP (Tailscale or
  a public URL, with a device-scoped token) and displays it, refreshing on a
  timer. SceneGraph shows images trivially; almost no Roku-side logic.

This keeps all the real UI in one place (the box) and makes the Roku side a dumb
frame — and it means the **same "device-scoped read-only display feed" the Echo
Show issue calls for is the reusable core**, just delivered as an *image/data
feed* for Roku instead of an *HTML URL* for the Echo Show.

## The tension

The reusable, high-leverage piece is shared with the Echo Show item: a
**device-scoped, read-only dashboard feed** with simple per-device auth. The
Roku-specific cost is that you can't stop at "a URL" — you must build and
sideload a small **BrightScript/SceneGraph channel** (ideally a screensaver) in
a foreign toolchain. Worth it only if a TV dashboard is genuinely wanted; if so,
the screensaver + box-rendered-image approach is the least-code path and the
one to prototype first.

## Related

- [Echo Show dashboard display](2026-07-27-echo-show-dashboard-display.md) —
  sibling surface; shares the device-scoped display-feed core.
- Device-scoped auth reuses the mobile device-token model
  ([mobile device token no expiry](../code-quality/2026-07-19-mobile-device-token-no-expiry.md)).
