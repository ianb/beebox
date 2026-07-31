---
title: "bin/browse's agent-token auth is broken two ways — page navigations 401"
area: bin
filed-by: agent
discovered-in: worktree-lightbox-horizontal-pan (needed an authenticated page to repro a lightbox bug)
---

`bin/browse` claims to authenticate dev navigations with the box's agent
loopback token (see the long comment in `bin/browse` above `browse_box_root`).
It doesn't work. Two independent defects:

## 1. It looks for the token in the wrong place

`bin/browse` reads:

```
browse_box_root="${HOME}/src/box-worktrees/${worktree}/${browse_box}"
browse_agent_token_file="${browse_box_root}/.callback-box/agent-token"
```

That is the box's **package** root. `getOrCreateAgentToken`
(`callback-box/src/core/agent/token.ts`) is called with the box's
**operational** root, which for a v2 box is `<package>/content` — and that is
also the root `bin/router-auth-deps.ts` hands to `verifyAgentBearer`
(`resolveTargetBoxRoot` returns `entry.contentDir`). Confirmed on a real box:

```
~/src/box-worktrees/browse-back-url/test1/content/.callback-box/agent-token   # exists
~/src/box-worktrees/browse-back-url/test1/.callback-box/agent-token           # does not
```

So the token is silently never found and `BROWSE_AGENT_TOKEN` is never set.
The failure is invisible — the script treats a missing file as "not an error"
and proceeds unauthenticated, so you just land on the login page.

## 2. Even with the right token, a page navigation still 401s

Put the correct token where `bin/browse` looks and the request now carries
`Authorization: Bearer <agent-token>`. The router's box gate accepts it
(`resolveMobileForBox` → `verifyAgentBearer`), but `mobileBootstrapTarget`
(`bin/router-mobile-bootstrap.ts`) fires on **any** allowed `GET` to a box page
path that carries an `Authorization` header, and
`bootstrapMobileSessionCookie` POSTs that header to
`/<box>/api/pairing/session` — an endpoint for a durable **device pairing**
bearer, not the agent token. The exchange fails and the router returns:

```
401  Mobile session bootstrap failed.
```

So the agent token authenticates the request and then the mobile-bootstrap
hook throws it away. Reproduced against `/lightbox-horizontal-pan/test1/browse/...`.

## Workaround used

Mint an owner `cb_session` cookie with `signSession` from
`callback-box/src/webapp/auth.ts` and set it via
`bin/browse eval "document.cookie = 'cb_session=…; path=/'"`. Works, but it's
not something `bin/browse` should need a human (or an agent) to know.

## Fix sketch

- Point `browse_agent_token_file` at the box's content root (and fall back to
  the package root for a legacy shapeVersion-1 box) — or better, resolve it
  through `bin/box-entry.ts` rather than string-building the path.
- Make `mobileBootstrapTarget` skip requests whose bearer is the box agent
  token (the router already knows the target box root at that point), so the
  agent bearer flows straight through to the proxy.
- Consider making a missing token noisy rather than silent — the whole failure
  mode above presents as "the dev app wants me to log in."
