---
title: "proxy-image: header comment claims unauthenticated, but the route registers inside the box auth wall"
area: callback-box
filed-by: agent
discovered-in: worktree-security-report — endpoint inventory for the security report
---

`src/webapp/routes/proxy-image.ts` has a header comment saying the route
is unauthenticated because a frozen page's sandboxed `<iframe>` (opaque
origin) cannot carry the session cookie. But the route is registered via
`registerApiRoutes` inside `registerBoxRoutes`, so it mounts at
`/<slug>/api/proxy-image` — squarely inside `addBoxAuthHook`'s scope.
`isApiUrl()` matches `/api/`, so it is not exempted as a static asset,
and nothing in the wall's bypass list names it.

As written, a cookie-less sandboxed-iframe request should get a **401**
from the wall, contradicting the comment's premise — which means either
(a) frozen-page image loading through the proxy is silently broken, or
(b) some path not visible in the code (hub layer? request flow) lets it
through, in which case the comment describes a real unauthenticated
surface that the wall analysis missed.

Verify live (load a frozen page with a proxied external image while
logged out), then fix whichever side is wrong: the comment, or the
feature. Found during the endpoint sweep; not confirmed exploitable or
broken either way.
