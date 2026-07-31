# Let an agent-driven browser reach a local dev page

`bin/browse` cannot open any authenticated page of the local dev app, so any
issue whose verification says "check it in a real browser" is un-verifiable by
an agent. Issue:
`issues/bugs/2026-07-31-browse-cannot-authenticate-dev-pages.md`.

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

Cookie caveat, handled explicitly: a bare long-lived auth cookie is
CSRF-attachable, so it is set `SameSite=Strict`, `HttpOnly`, and scoped by path
to the box. It is dev-only and absent by default, which bounds the blast radius,
but "dev-only" is not a reason to set it sloppily.

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
