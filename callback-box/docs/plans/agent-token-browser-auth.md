# Let an agent-driven browser reach a local dev page

`bin/browse` cannot open any authenticated page of the local dev app, so any
issue whose verification says "check it in a real browser" is un-verifiable by
an agent. Issue:
`issues/bugs/2026-07-31-browse-cannot-authenticate-dev-pages.md`.

**Revised 2026-07-31 after a Codex review killed the first design.** That
version added an agent-bearer rung to the `cb hub` gate. Codex was right to
reject it, and the reasoning is worth keeping: the hub is the **public prod
front door**, and it deliberately does not accept the agent token today
(`hub-server.ts:461`, `:522`). Box agents reach their box on loopback, never
through the hub, so the hub never needed that rung. Adding it would turn a
long-lived 0600 file secret into a credential valid at the exposed front door —
and `bin/browse` then exports it into browser-origin request headers, making it
an ambient same-origin capability rather than a loopback-only one. No gate
change is worth that.

## The design: give the browse profile a real device, not a file secret

The system already has a credential type for exactly this caller — "a
browser-ish client that is not the owner's interactive session": a **mobile
device token**. It is the right fit and it changes no auth boundary:

- Every layer already accepts it — dev router (`router-auth-deps.ts:134`), hub
  (`hub-server.ts:151`), box (`server-box-scope.ts:95`).
- It is **revocable and enumerable**: entries live in the box's device store
  with a label and `lastUsedAt`; revocation takes effect within one cookie TTL
  because `renewMobileSessionCookie` re-reads the store (`mobile-cookie.ts:63`).
- The bearer→cookie exchange the router already performs
  (`bin/router-mobile-bootstrap.ts`) then works **as designed** instead of
  hard-failing. That matters beyond the navigation: a `cb_mobile` cookie also
  authenticates subresources and the tRPC **WebSocket** upgrade, which an
  `--headers` bearer may not cover. The first design had this as an unresolved
  risk; this design removes it.

So the agent token stays what its doc comment says it is — a loopback secret for
box subprocesses — and `bin/browse` stops trying to use it as a browser
credential.

### Changes

1. **A local CLI command to issue a device for an agent browser.**
   `createMobilePairingTicket` exists (`core/mobile/pairing.ts:228`) but is only
   reachable through a tRPC procedure that requires an already-authenticated
   user (`trpc/routers/pairing.ts:12`) — a chicken-and-egg an agent can't break.
   Add a `cb` command that mints a device locally (running as the box user, the
   same trust boundary that already grants read of every box file) and prints
   the device token.

   **Guardrails, non-negotiable:** it is gated behind `--agent-confirmed` like
   the mutating `cb auth` subcommands (`src/lib/agent-context.ts`) — that flag
   asserts *a human asked for this*, not *the agent decided it was fine*. It
   labels the device `agent-browser (<worktree>)` so it is obvious in the device
   list, and it refuses to reuse an existing one. Issuing a credential is a
   boxholder decision; this command only makes the decision *expressible*.

2. **`bin/browse` reads the device token, not the agent token.** Same
   origin-scoping it already does (`browse/src/worktree.ts:69`). Absent token
   stays a non-error: browse proceeds unauthenticated and lands on login, as
   today. The agent-token lookup is removed, not kept as a fallback — a fallback
   would silently resurrect the rejected design.

3. **Narrow `mobileBootstrapTarget`'s trigger.** It fires on any GET to a
   non-`/api` box path carrying *any* `Authorization` header
   (`bin/router-mobile-bootstrap.ts:28-45`) — it is not restricted to document
   navigations despite being justified by "a navigation gets the Vite HTML
   shell". Gate it on an actual navigation (`Sec-Fetch-Mode: navigate`, or
   `Accept: text/html`) so a non-document GET that happens to carry a bearer
   isn't sent through a pairing exchange it never needed.

   **Do not make a failed bootstrap degrade to "proceed".** The first plan
   proposed that; Codex's counter is correct — a token revoked between the gate
   decision and the exchange would serve a cookie-less page whose later API and
   WS calls fail, which is worse than an honest error. Keep it a hard failure;
   improve the message so it names the cause instead of a bare
   `Mobile session bootstrap failed.`

### Explicitly unchanged

- No new rung in the hub gate, the router gate, or the box wall.
- `/api/boxes` (`hub-server.ts:155`) and the Google-services callback
  (`hub-server.ts:393`) reach auth independently of the proxy gate; both stay
  session/mobile-only. Nothing here touches them.
- `~/.cb-auth.json`, passwords, and owner sessions are untouched.

### Pre-existing exposure this does NOT fix (noted, not addressed)

The dev router already lets **any** valid box credential — including the agent
bearer — reach worktree Vite dev assets: `@vite`, `@fs`, `@id`,
`@react-refresh`, `node_modules`, `src` (`bin/router-auth.ts:157`,
`router-auth-deps.ts:168`). `@fs` in particular is as broad as Vite's own
`fs.allow`. That is true today, independent of this plan. Worth its own issue;
out of scope here.

## Testing

`bin/router*.ts` changes do not reach the live shared router without a
main-merge plus a `pnpm dev` restart, and this session must not restart the
boxholder's router. Verify against an **isolated router** (`CALLBACK_STATE_DIR`
+ `ROUTER_PORT`), which touches nothing the live one owns.

- Unit: `bin/router-mobile-bootstrap.ts` has direct tests — add cases for the
  narrowed navigation trigger (a non-navigation GET with a bearer returns null).
  Add a doctest for the new CLI command: it refuses without `--agent-confirmed`,
  and the token it issues verifies via `verifyMobileRequest`.
- End-to-end on the isolated router: `bin/browse open /browse/store` renders the
  page, `read_network_requests` shows the tRPC WebSocket connected (not 401), and
  the back-button behavior from
  `issues/bugs/2026-07-22-browse-back-button-url-not-updated.md` can finally be
  checked in a real browser.

## Open question for the boxholder

Step 1 issues a credential. Per the standing rule that an agent never
provisions credentials to unblock itself, this plan should not be implemented
until you say the `--agent-confirmed` CLI command is the shape you want — the
alternative being that you mint the device yourself through the existing UI and
drop the token where `bin/browse` looks.
