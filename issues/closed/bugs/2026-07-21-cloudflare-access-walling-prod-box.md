---
title: "Cloudflare Access is walling off the production box (mis-scoped from pub-setup)"
area: callback-box
filed-by: agent
resolution: fixed
discovered-in: main session — boxholder saw a broken admin page + console errors on the deployed box
---

**Closed (fixed) 2026-07-31.** Boxholder deleted the mis-scoped Access application
(and a stray `box.<domain>` localhost-proxy tunnel it was tied to). Verified live:
`curl` against the prod box now returns the box's **own** `302 → /auth/login`
(correct fail-closed box auth) with **no** `cloudflareaccess.com` redirect, no
`www-authenticate: Cloudflare-Access`, and no `CF_AppSession` — so tRPC / manifest
/ WebSocket sub-requests are no longer intercepted. (Cloudflare still *proxies* the
host — `cf-ray` present — which is fine and separate; the boxholder's broader
"Tailscale-only" goal, i.e. grey-clouding the DNS record, is a distinct follow-up,
not part of this bug.)

The deployed box (`box.example.com` — the real family server) is behind a
**Cloudflare Access application it should not be behind**. Every request without
a valid Access cookie 302-redirects to the Zero Trust login, which breaks the
app: the SPA document loads (the user has an Access session for navigation) but
its sub-requests do not.

## Symptoms

- Admin page shows "Unable to transform response from server" on multiple
  sections.
- Console: tRPC batch requests report `404`, `push.vapidPublicKey` `404`,
  `manifest.webmanifest` blocked by CORS, WebSocket upgrade fails.

## Root cause (curl-confirmed)

The browser "404" is misleading. `curl` against the tRPC endpoint returns:

```
HTTP/2 302
location: https://<team>.cloudflareaccess.com/cdn-cgi/access/login/box.example.com?...
www-authenticate: Cloudflare-Access ...
set-cookie: CF_AppSession=...
```

So an **Access application (aud `47a9385c…`) is protecting the box hostname**.
Unauthenticated requests get an HTML redirect to the Access login; the tRPC
client chokes on the HTML ("Unable to transform response"), the manifest fetch
CORS-fails on the cross-origin redirect, and the WebSocket can't upgrade through
a 302. The "404s" the browser prints are how it surfaces the intercepted
requests. All one cause: Access in front of the box.

## Why it's there

The Access app was created during the 2026-07-19 `cb pub setup` work, which was
meant to protect **`pub-worker.<...>.workers.dev`** (path `a/*`) — see
[pub Access setup via API](../../features/2026-07-19-pub-access-setup-via-api-not-dashboard.md).
The reorganized Cloudflare dashboard made that flow error-prone (documented
there), and the application domain ended up scoped to the box hostname instead of
the worker.

## Fix (Cloudflare dashboard — needs Access:Edit, not the Workers+R2 publish token)

Zero Trust → **Access controls → Applications** → the app whose aud is
`47a9385c…` protecting the box hostname → **delete it**, or **change its domain**
to the pub worker (`pub-worker.<...>.workers.dev`, path `a/*`).

## The larger decision this surfaces

Putting Cloudflare Access *deliberately* in front of the box is a real option —
it's defense-in-depth, and it overlaps the
[Tailscale expose-and-protect](../features/2026-07-20-tailscale-expose-and-protect.md)
goal. But the box is **not built to run behind Access today**: the tRPC/XHR,
`manifest.webmanifest`, and the tRPC WebSocket all need to authenticate through
the Access session, and right now they don't (they get 302'd). So Access-in-front
is a *project* (make every request path carry/honor the Access JWT, including the
WS upgrade and the crossorigin manifest), not a config toggle. Until that's
built, Access must only cover the pub worker, never the box hostname. If we do
want it later, design it alongside the Tailscale work — both are "how is the box
reachable and protected."

## Prevention

`cb pub setup`'s Access step is a manual dashboard walkthrough precisely because
we haven't automated it; this incident is the cost of that. Reinforces the case
in the pub-access issue for provisioning the Access app via the API with the
hostname passed explicitly, so a human can't point it at the wrong domain.
