---
title: "Let an agent-driven browser reach a local dev page"
status: implemented
workstream: unknown
issues: []
---
# Let an agent-driven browser reach a local dev page

> **Historical implementation plan — not an operational runbook.** This
> document records the problem, design process, and implementation findings as
> they existed while browser authentication was being built. Do not follow its
> testing recipes or troubleshooting narrative to operate the current browser
> infrastructure. Use the repository's `browse` skill and the current
> `bin/browse` wrapper instead; their behavior and guidance are authoritative.

Before this work was implemented, `bin/browse` could not open any authenticated
page of the local dev app, so any issue whose verification said "check it in a
real browser" was unverifiable by an agent. Issue:
`issues/closed/bugs/2026-07-31-browse-cannot-authenticate-dev-pages.md`.

## Design: an opt-in API key, following `CB_DIAG_API_KEY`

The box already has a credential of exactly this kind — a durable,
non-interactive, operator-set shared secret: `CB_DIAG_API_KEY`
(`src/webapp/auth.ts:68`, whitelist at `:98`). It is absent by default and
`verifyDiagBearerKey` returns false when unset, so it costs nothing where it
isn't configured. Add a second key of the same shape for browser access.

**`CB_BROWSE_API_KEY`.** When set, a request bearing it is box-scoped auth at
the dev router, the hub, and the box. When unset — the default, and the prod
default — every gate behaves exactly as it does today.

### Why not the two designs that came before it

- **The agent loopback token** (`core/agent/token.ts`) is a 0600 file secret for
  box subprocesses calling their own box over loopback. Teaching the hub to
  accept it would make a file secret valid at the **public prod front door**,
  and `bin/browse` then exports it into browser request headers. A Codex review
  killed this; it was right. The token keeps its documented scope, and
  `bin/browse` stops trying to use it.
- **Minting a mobile device token** was over-built: it reuses machinery designed
  for an interactive pairing flow (tickets, device store, revocation, TTL
  cookies) to solve "a script needs a credential", and it required a new CLI
  command that issues credentials. An env var is the same capability with none
  of the ceremony.

The security property that matters is not which credential type we pick — it is
**opt-in and absent by default**. `CB_BROWSE_API_KEY` has that; promoting an
always-present file secret does not.

## Implemented 2026-07-31 — what building it changed

Three things the plan got wrong, all found by running it end to end against an
isolated router (`CALLBACK_STATE_DIR=/tmp/cbr9 ROUTER_PORT=3299`):

1. **`/api/boxes` had to be included after all.** The plan said it could stay
   session/mobile-only. It can't: the SPA resolves the box in the URL against
   that list, so with an empty list every page renders **"Box not found"** while
   every other request authenticates fine. Handled in `respondHubBoxes`; the
   key is machine-level, so it lists all boxes.
2. **The router process needs the key itself**, not just the children it spawns.
   Its gate runs in-process, so `main()` now loads the main checkout's `.env`
   into `process.env`. This is what makes the key machine-level rather than
   per-worktree.
3. **Cookie-ONLY, not cookie-plus-bearer.** Sending both still tripped
   `mobileBootstrapTarget`, which hard-401s the navigation with
   `Mobile session bootstrap failed.` — the defect the cookie was supposed to
   route around. Dropping the `Authorization` header sidesteps it, as designed.

Also: the WorktreeCreate hook copies the main `.env` **minus `BOXES=`**. Copying
it whole would have pointed every worktree at `~/src/boxes/*` — the real boxes —
instead of its isolated clone.

Verified: unauthenticated and wrong-key requests 401 at the router; the key
authenticates page, API, Vite dev assets, and the tRPC **WebSocket upgrade**
(101 with the cookie, refused without); `bin/browse` renders browse and steps
back/forward through file history one entry at a time.

Not verified: `useBrowseListLiveRefresh` did not fire on a file added to the
open directory (a reload showed it). Not attributable to this work or to the
BrowsePage change — filed separately.

## The one real choice: header or cookie

The credential has to reach more than the initial navigation. The page then
loads subresources and opens the tRPC **WebSocket**, and a browser will not
attach an `Authorization` header to a WebSocket handshake.

- **Header** (`agent-browser open --headers`, what `bin/browse` does today)
  covers the document and XHR but probably not the WS upgrade, which would
  leave live updates dead — and live refresh is one of the things browse work
  needs verified.
- **Cookie** is attached by the browser to *every* request to the origin,
  including the WS upgrade. It also means no `Authorization` header on the
  navigation, so `mobileBootstrapTarget` never fires and the
  `Mobile session bootstrap failed.` defect stops being reachable without
  touching that code at all.

**Recommend the cookie**, with the key accepted from either place (a header is
still the right form for a plain `curl` probe).

Cookie caveat — and the plan was WRONG about this until 2026-07-31. It claimed
the cookie is set `SameSite=Strict`, `HttpOnly`, path-scoped. It is not, and it
cannot be: nothing ever sends `Set-Cookie`. `bin/browse` sends a `Cookie`
*request header* through agent-browser's origin-scoped `--headers`, so the value
never enters the browser's cookie jar and carries no attributes at all.

What that actually means: the credential rides every request agent-browser makes
to this origin, whoever caused it. A hostile page loaded in the same
agent-browser profile could trigger state-changing requests to localhost with
the key attached. Accepted, not solved, and the reasons are: this browser is a
throwaway per-worktree profile that an agent points at the local dev app, the
key is absent unless an operator sets it, and the target is a dev machine. If
this credential ever grows beyond that — a shared browser, a reachable host —
it needs real CSRF handling first.

`bin/browse` installs the cookie once per Chrome profile: the login page is
served to everyone, so it navigates there, sets the cookie, then proceeds. No
new endpoint, no exchange step.

## Changes

1. `verifyBrowseBearerKey` beside `verifyDiagBearerKey` in `src/webapp/auth.ts`,
   reading `CB_BROWSE_API_KEY` and accepting the key from the bearer header or
   the `cb_browse_key` cookie. Unset env ⇒ false, always.
2. Accept it in the three gates, next to the existing box-credential checks:
   box (`server-box-scope.ts:95`), hub (`hub-server.ts:151`, used by both the
   HTTP catch-all and the WS upgrade), dev router
   (`router-auth-deps.ts:134`). Unlike the diag key this is not
   procedure-whitelisted — it is full box-scoped access, which is the point.
3. `bin/browse` reads `CB_BROWSE_API_KEY` from the environment and installs the
   cookie on first use. Its agent-token lookup is deleted, not kept as a
   fallback — a fallback would quietly resurrect the rejected design.

### Explicitly unchanged

- `~/.cb-auth.json`, passwords, owner sessions, the device store.
- `/api/boxes` (`hub-server.ts:155`) and the Google-services callback
  (`hub-server.ts:393`) reach auth independently of the proxy gate and stay
  session/mobile-only.
- `bin/router-mobile-bootstrap.ts`. Its trigger really is too broad — it fires
  on any GET to a non-`/api` box path carrying any `Authorization` header, not
  just document navigations — but the cookie design routes around it entirely.
  Narrowing it is a separate cleanup, filed rather than bundled.

### Pre-existing exposure this does NOT fix (noted, not addressed)

The dev router already lets any valid box credential reach worktree Vite dev
assets — `@vite`, `@fs`, `@id`, `@react-refresh`, `node_modules`, `src`
(`bin/router-auth.ts:157`, `router-auth-deps.ts:168`). `@fs` is as broad as
Vite's own `fs.allow`. True today, independent of this plan; worth its own
issue.

## Testing

`bin/router*.ts` changes do not reach the live shared router without a
main-merge plus a `pnpm dev` restart, and this session must not restart the
boxholder's router. Verify against an **isolated router** (`CALLBACK_STATE_DIR`
+ `ROUTER_PORT`), which touches nothing the live one owns.

- Unit: unset env is refused at every gate (the fail-closed case is the one that
  must never regress); a wrong key is refused; the key is accepted from both
  header and cookie. The existing gate tests (`bin/router-auth.test.ts`, the hub
  doctests) already have the table shape to extend.
- End-to-end on the isolated router: `bin/browse open /browse/store` renders,
  the tRPC WebSocket connects rather than 401ing, and the back-button behavior
  from `issues/bugs/2026-07-22-browse-back-button-url-not-updated.md` can
  finally be checked in a real browser.

## Where the key comes from

The boxholder sets `CB_BROWSE_API_KEY` in their local dev environment. Nothing
generates or writes it automatically — an agent provisioning its own credential
is exactly the failure mode this design is avoiding.
