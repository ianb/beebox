---
title: "Mobile device token: replace `?mobileToken=` with a box-scoped session cookie"
status: implemented
workstream: unknown
issues: []
---
# Mobile device token: replace `?mobileToken=` with a box-scoped session cookie

The durable mobile device token currently travels in a URL query parameter on both the
iOS webview's initial `/chat` navigation and the web frontend's tRPC WebSocket URL. Because
`MobileDevice` has no expiry, a token captured from an access log, `Referer`, or WebKit
history is replayable until a human manually revokes the device. This plan removes the
token from URLs entirely: the durable token becomes header-only, and a short-lived,
box-scoped signed cookie (`cb_mobile`) carries navigations and WebSocket upgrades.

## Stated preferences this plan trades against

- **`docs/engineering-principles.md` #3 (validate at boundaries)** — the cookie is untrusted
  input; it gets HMAC verification plus a parsed, schema-checked payload, mirroring
  `verifySession`.
- **#4 (resilient AND never silent)** — a failed cookie mint must not leave a silently dead
  webview; the design keeps an authenticated fallback path and logs.
- **#6 (right-sized defensiveness)** — auth is a real boundary, so it gets the full budget:
  fail-closed, timing-safe compares.
- **#8 (one way to do each thing)** — this plan deletes three copies of `mobileTokenFromUrl`
  rather than hoisting them, resolving
  `issues/code-quality/2026-07-17-mobile-auth-parser-plumbing-cleanups.md`'s first bullet.
- **#11 (enforcement beats convention)** — no lint suppressions; the existing
  `max-params`/`no-restricted-syntax` discipline holds.
- **`callback-box/CLAUDE.md`** — the mobile wire contract is documented in
  `docs/mobile-contract.md` and mirrored in Swift + shared fixtures; a wire change updates
  all of them in the same commit (per `ios-app/CLAUDE.md`'s "Architecture boundary").
- **Boxholder standing preference:** bias toward strict/fail-closed on anything
  auth-adjacent; consolidate duplicates even when it means touching more callers.

## What already exists

The plan reuses far more than it builds.

- **Signed-cookie machinery** — `src/webapp/auth.ts:137` `signSession` and `:154`
  `verifySession` implement exactly the HMAC-SHA256-over-base64url-JSON shape this plan
  needs, including a timing-safe compare (`auth.ts:174`) and an `exp` check (`auth.ts:180`:
  *"if (typeof data.exp !== \"number\" || data.exp < Date.now()) return null;"*). **Reused**
  as the structural model; the new cookie needs its own signer because of the secret
  scoping below.
- **Raw cookie-header parsing for non-Fastify contexts** — `lib/cookies.ts` `parseCookieHeader` (hoisted out of `auth.ts` by this plan),
  written for exactly one caller: `auth.ts:201`: *"the hub's raw WebSocket-upgrade path
  (`src/hub/hub-server.ts`), which sees a bare `http.IncomingMessage`, not a
  `FastifyRequest`."* **Reused directly** — this is the piece that makes cookie-on-WS-upgrade
  work at the hub without new plumbing. It is currently module-private; this plan exports it.
- **The hub already gates the WS upgrade on cookies** — `hub-server.ts:442`: *"WS upgrades
  carry cookies too -- apply the SAME gate/injection here"*, and `decideHubAuth`
  (`hub-server.ts:193`) already takes `cookieHeader` as its input
  (`hub-server.ts:194`). **Reused** — the mobile branch slots into the existing decision
  function rather than adding a parallel path.
- **tRPC already carries the token post-upgrade** — `src/frontend/src/lib/trpc/index.ts:49`
  passes `getMobileAuthToken()` as `createWSClient`'s `connectionParams`. **Reused
  unchanged.** This is load-bearing for Track 4: the query param authenticates *only* the
  pre-upgrade gate, so deleting it costs nothing once the cookie covers that gate.
- **The `Secure`-flag precedent** — `src/webapp/routes/auth.ts:161`:
  *"secure: publicUrl.startsWith(\"https\")"*. **Reused** — the new cookie decides its
  `Secure` flag the same way rather than inventing a second rule.
- **Device-token verification** — `src/core/mobile/pairing.ts:161` `verifyMobileToken` and
  `:147` `resolveMobileBearerIdentity`. **Reused unchanged** for the mint endpoint.
- **`@fastify/cookie` is already registered** on the hub (`hub-server.ts:238`) and on the box
  server. **Reused** — no new dependency.
- **The pairing route family** — `src/webapp/routes/pairing.ts:19` registers
  `POST /api/pairing/redeem`. **Reused** as the home for the new mint endpoint, so mobile
  auth stays in one file.
- **Web-side bearer helpers** — `src/frontend/src/lib/mobile-auth.ts` (`mobileAuthHeaders`,
  `withMobileAuth`). **Partly retired** — see Track 4.

What does *not* exist and must be built: a per-box cookie secret, the mint endpoint, and
the cookie verification helper.

**Why the cookie cannot be `cb_session`.** `auth.ts:276` is explicit: *"the session-cookie
secret is symmetric (HMAC), so any box that can VERIFY a cookie could also FORGE one for a
sibling box. Under the plan's trust model (hub trusted, boxes mutually untrusting) that is
unacceptable."* `src/hub/CLAUDE.md` reinforces it: `CHILD_ENV_ALLOWLIST` deliberately
withholds `CB_SESSION_SECRET` from boxes. So `cb_mobile` must be signed with a **per-box**
secret that a box may legitimately hold, because forging it only ever grants access to the
box that already owns it.

## Prior art (external)

Searched, and it materially changed the design.

- **`WKHTTPCookieStore.setCookie` is unreliable and its completion handler can hang.** iOS
  11.3+ delays `WKWebsiteDataStore` creation until "necessary," and loading the URL only
  inside the completion block deadlocks; cookies also intermittently fail to apply to the
  first request. — [WebKit bug 185483](https://bugs.webkit.org/show_bug.cgi?id=185483),
  [openradar 40100673](https://openradar.appspot.com/40100673),
  [Apple Developer Forums thread 99674](https://developer.apple.com/forums/thread/99674).
  **Design consequence:** the original sketch (native writes the cookie into
  `httpCookieStore`, then navigates) is rejected. Instead the cookie is delivered by
  `Set-Cookie` on the initial navigation *response*, which WebKit stores reliably through its
  own network stack. See Track 3.
- **Cookies on WebSocket handshakes.** A same-origin WS upgrade from a page is an ordinary
  HTTP request from the network stack and carries the origin's cookies; the hub already
  depends on this (`hub-server.ts:442`). No contrary prior art found.
- **No prior art found** for a "short-lived single-use handshake token in the WS URL" as a
  named pattern in this problem space; the common industry answers are cookies or a
  subprotocol-header hack. That absence is part of why this plan takes the cookie route.

## Tracks / scope

Ordered by implementation dependency: the server-side primitive must exist before any client
can use it, and both clients must stop sending the query param before the parser is deleted.

### Track 1 — `cb_mobile`: per-box signed cookie primitive

**What.** A new module `src/core/mobile/mobile-session.ts` with `signMobileSession` /
`verifyMobileSession`, plus a per-box secret.

**Why this needs to change.** There is no credential today that a box can verify cheaply,
that rides both navigations and WS upgrades, and that expires. `cb_session` is structurally
unavailable (see above), and the device token is the thing we're trying to get off the wire.

**Direction.**

```ts
// src/core/mobile/mobile-session.ts
export interface MobileSession { deviceId: string; exp: number }
export function signMobileSession(boxRoot: string, opts: { deviceId: string; ttlMs: number }): string;
export function verifyMobileSession(boxRoot: string, cookie: string | undefined): MobileSession | null;
export const MOBILE_COOKIE_NAME = "cb_mobile";
```

- **Secret:** generated once per box, persisted at
  `<boxRoot>/.callback-box/mobile-session.secret` with `mode: 0o600` — the same directory and
  permissions as the existing device store (`pairing.ts:8`, `pairing.ts:80`:
  *"{ mode: 0o600 }"*). Cached in-process like `auth.ts:18` `cachedSecret`.
- **TTL: 1 hour, with sliding renewal** on every authenticated response (Track 2). This is
  the deliberate trade for the hot path: `verifyMobileSession` is pure HMAC with no file I/O,
  whereas `verifyMobileToken` reads *and writes* the device store on every call
  (`pairing.ts:172`: *"device.lastUsedAt = nowIso(); writeDeviceStore(boxRoot, store);"*) —
  unacceptable per-request write amplification if the cookie were checked that way.
  The cost is that **revocation takes up to one hour to take effect** on an active session,
  because a signed cookie can't be revoked before expiry. Renewal re-checks the device store,
  so a revoked device stops renewing immediately and is locked out within the TTL. That bound
  is stated in `docs/mobile-contract.md` as part of this change.

**Vocabulary lock-ins.** Cookie name `cb_mobile`; secret filename
`mobile-session.secret`; the payload field is `deviceId` (matching
`MobileBearerIdentity.deviceId`, `pairing.ts:143`).

**First implementation chunk.** The module plus a pure-function doctest
(`test/core/mobile/mobile-session.doctest.md`): sign→verify round-trip, expired cookie
rejected, tampered signature rejected, wrong-box secret rejected, garbage input rejected.
No open questions inside it.

### Track 2 — Server: issue and accept `cb_mobile`

**What.** Attach `Set-Cookie` on authenticated responses; accept the cookie everywhere
`?mobileToken=` is accepted today; add the explicit mint endpoint for the web/recovery path.

**Why this needs to change.** Track 1's primitive is inert until the server issues and honors
it.

**Direction.**

1. **Issuing.** An `onSend` hook on the box scope: when a request authenticated as a mobile
   device (valid `Authorization: Bearer <deviceToken>` **or** a valid, non-expired
   `cb_mobile`) produces a response, set
   `cb_mobile=<signed>; HttpOnly; Secure; SameSite=Lax; Path=/<slug>; Max-Age=3600`.
   - `HttpOnly` — page JS never reads it, so the iframe/XSS exfiltration class that the
     2026-07-09 review found in the localStorage channel does not recur.
   - `SameSite=Lax` — a cross-site POST cannot ride it. `Lax` rather than `Strict` because
     the box is navigated to from external links.
   - `Path=/<slug>` — keeps one box's cookie out of a sibling's request. This bounds the
    **cookie jar**, and is NOT an access-control boundary: boxes are path siblings on one
    origin, so a script running under box A can already `fetch("/boxB/api/...")` and box B's
    cookie will ride. What actually prevents cross-box escalation is the per-box signing
    secret. Same-origin sibling trust is a pre-existing property of the path-prefix layout
    (`cb_session` isn't path-scoped at all) — this plan neither creates nor fixes it; see
    the filed issue.
   - `Secure` follows the existing precedent at `routes/auth.ts:161`
     (*"secure: publicUrl.startsWith(\"https\")"*) rather than a second, divergent rule, so
     local dev over plain HTTP still receives the cookie.
2. **Accepting.** Replace all three `verifyMobileToken(box.boxRoot, mobileTokenFromUrl(...))`
   call sites with `verifyMobileSession(box.boxRoot, <cookie>)`:
   `server-box-scope.ts:91` (preHandler), `server-box-scope.ts:187` (tRPC context),
   `server-root.ts:311`/`:319` (`listMobileAuthorizedBoxes`, `isMobileSpaRequest`).
3. **Hub — and closing risk S1 along the way.** `decideHubAuth` (`hub-server.ts:193`) gains a
   mobile branch reading `cb_mobile` from its existing `cookieHeader` input via the
   now-exported `parseCookieHeader`.

   `hasMobileAuthAttempt` (`hub-server.ts:134`) must not merely be re-pointed at the cookie,
   because it is **presence-only and never verifies anything**:

   > `hub-server.ts:136-137`: *"return (typeof authorization === \"string\" &&
   > authorization.startsWith(\"Bearer \"))  || mobileTokenFromUrl(url) !== undefined;"*

   Any request bearing the literal string `Bearer x` therefore skips the hub's auth wall and
   is proxied to the box — which does re-verify, but only after the hub has cold-started a
   stopped box for an unauthenticated caller. This is the already-known, already-documented
   risk **S1** (`docs/mobile-contract.md:435-440`, marked OPEN and SILENT). Re-pointing a
   presence-only check at a *cookie* would be strictly worse than today, since an attacker
   would need only to set any `cb_mobile` value at all. So this plan replaces it with real
   verification: `verifyMobileSession(boxRoot, cookie) || verifyMobileBearer(boxRoot, auth)`
   for the request's slug.

   This is affordable precisely because of Track 1's design — `verifyMobileSession` is pure
   HMAC with no file I/O, so verifying at the hub costs nothing per request. **This is a
   scope addition beyond the filed issue**, taken because leaving the check presence-only
   while changing what it checks would violate fail-closed, and because it is the same five
   lines either way. Called out separately in the summary for the boxholder.
4. **Mint endpoint.** `POST /api/pairing/session` in `routes/pairing.ts`, authed by
   `Authorization: Bearer <deviceToken>`, responding `204` + `Set-Cookie`. This is the
   recovery path when a cookie expires and no bearer header is available (Track 3), and the
   only way the *web* client obtains a cookie.
5. **Delete** all three `mobileTokenFromUrl` copies (`hub-server.ts:125`,
   `server-box-scope.ts:230`, `server-root.ts:332`).

**First implementation chunk.** The `verifyMobileSession` acceptance path + hub branch,
with route doctests via `makeTestServer()`. The query param keeps working during this chunk
so the clients aren't broken mid-plan; its deletion is a later chunk.

### Track 3 — iOS: header on navigation, cookie thereafter

**What.** `ChatWebView.authenticatedChatURL` (`ChatWebView.swift:366`) stops appending the
query param; `request()` (`:362`) sets `Authorization: Bearer <deviceToken>` instead.

**Why this needs to change.** This is the ordering problem the briefing flags. The resolution
is that the *initial navigation* is authenticated by a header — reliable, because WKWebView
honors custom headers on the initial `URLRequest` — and that response's `Set-Cookie` seeds
WebKit's own cookie store. Every subsequent request, including the tRPC WS upgrade and any
WebKit-initiated reload (back/forward, content-process crash recovery), carries the cookie
automatically. Critically, this needs **no `httpCookieStore` write at all**, sidestepping the
documented unreliability in Prior art.

**Direction.**

- `request()` builds `URLRequest(url: box.chatURL)` and sets the `Authorization` header from
  `box.authToken`, reusing the exact guard shape already in `ChatAPI.applyAuth`
  (`ChatAPI.swift:64-69`) rather than a second nil/empty-token idiom.
- `authenticatedChatURL` is deleted; the URL is plain.
- **`request()` is called from exactly two sites**, both of which stay correct:
  `ChatWebView.swift:78` (`makeUIView`, the unconditional initial load) and
  `ChatWebView.swift:89-91` (`updateUIView`, guarded by `if webView.url == nil`). There is no
  `reload()` / `reloadFromOrigin()` anywhere in the target, so the *only* in-app reload path
  is `RootView.swift:52`'s `.id(box.id)`, which tears down and rebuilds the webview on a box
  switch — and that runs `makeUIView` again, so it re-sends the header. The WebKit-initiated
  reloads this plan cares about (back/forward, content-process crash recovery) bypass Swift
  entirely, which is exactly why they need the cookie rather than the header.
- **Reload-after-expiry recovery:** a WebKit-initiated reload after the 1-hour TTL carries
  neither header nor valid cookie, so it 401s. The web layer handles this rather than
  native: on a 401 the SPA calls `POST /api/pairing/session` with the bearer header from
  localStorage and retries. This keeps the recovery entirely in the web layer where the
  retry logic already lives.
- The startup `WKUserScript` that writes `callbackbox.mobileAuthToken` into localStorage
  (`ChatWebView.swift:437`) **stays for now** — it is what makes the recovery path above
  possible. Removing it is Track 4's open question, not this track's.

**First implementation chunk.** The Swift change plus an XCTest asserting `request()` carries
the header and the URL has no `mobileToken` query item.

### Track 4 — Web: drop the query param from the WebSocket URL

**What.** `getWebSocketUrl` (`api-core.ts:83`) stops appending `?mobileToken=`.

**Why this needs to change.** This is the call site with no header option at all — the
browser `WebSocket` API cannot set request headers. The cookie is the only mechanism that
authenticates a browser WS upgrade without a URL credential.

**Direction.** Delete `api-core.ts:86-87`. The cookie rides the upgrade because it is
same-origin and `Path=/<slug>` matches the tRPC endpoint. `createWSClient`'s
`url: () => getWebSocketUrl()` (`lib/trpc/index.ts:47`) is unchanged — it stays synchronous,
which is why this plan does not need tRPC's async-url support.

Post-upgrade authentication is untouched: `lib/trpc/index.ts:49` already passes the token as
`connectionParams`, so the query param was only ever authenticating the pre-upgrade gate.
Deleting it also removes the codebase's one out-of-band read of the storage key — `api-core.ts:86`
uses the string literal `"callbackbox.mobileAuthToken"` rather than
`MOBILE_AUTH_TOKEN_STORAGE_KEY`, so the deletion incidentally restores the single-definition
invariant that `docs/mobile-contract.md`'s mirrored-constants list (row A1) asserts.

**First implementation chunk.** The deletion plus a frontend-visible doctest asserting the
built URL has no query string.

## Subplans

None. Each track is a settled design decision, not a research question. The one genuinely
open item (retiring the localStorage channel) is deferred to NOT-in-scope rather than
spun out, because it is a deletion whose prerequisite is this plan shipping and being
exercised.

## Failure modes

No critical gaps: every row below has either a test or explicit handling, and none fail
silently.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Cookie expires mid-session; WebKit reloads with no bearer header | Yes — route doctest for the 401→mint→retry path | Yes — Track 3 recovery via `POST /api/pairing/session` | Clear: 401 body, client-side retry, logged on failure |
| Device revoked but cookie still within its 1h TTL | Yes — doctest asserting renewal stops after revoke | Yes, bounded — renewal re-checks the device store | Clear: documented ≤1h revocation latency in `mobile-contract.md` |
| Per-box secret file unreadable (permissions, corruption) | Yes — filesystem doctest with a chmod-ed secret | Yes — mirrors `auth.ts:40`: warn on non-`ENOENT`, then regenerate | Clear: `console.warn`, and regenerating invalidates live cookies (forces re-mint, fails closed) |
| Secret regenerated → every live `cb_mobile` invalid at once | Yes — covered by the above | Yes — clients fall back to the bearer-authed mint endpoint | Clear: a 401 round-trip, self-healing |
| Cookie sent to the wrong box (path scoping wrong) | Yes — doctest asserting box A's cookie is rejected by box B | Yes — per-box secret means cross-box verify fails even if the path were wrong | Clear: 401, fails closed by construction |
| Hub proxies the upgrade but strips `Cookie` | Yes — hub doctest on the WS-upgrade path | Yes — existing behavior, `hub-server.ts:442` already forwards cookies | Clear: WS fails to connect, `onError` logs (`server-box-scope.ts:163`) |
| `Secure` set on a plain-HTTP dev request → browser drops the cookie | Yes — doctest asserting no `Secure` on an HTTP request | Yes — flag decided per-request from the protocol | Clear: would otherwise be silent, which is why it is tested |
| iOS `box.authToken` nil at navigation time | Yes — existing XCTest around `authenticatedChatURL` extends to `request()` | Yes — existing guard (`ChatWebView.swift:367`) falls through to the plain URL | Clear: 401 page rather than a wrong-credential load |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **N/A**: this plan introduces no card schema, tag, or
  agent-authored field. It is transport-layer only.
- **Stale ref** — **N/A** for the same reason. The nearest analogue, a stale *cookie*, is
  covered in Failure modes (expiry and revocation rows).
- **Two agents touching the same card** — **N/A**: no card writes. Worth noting the plan
  *reduces* concurrent-write pressure: `verifyMobileToken`'s per-request
  `writeDeviceStore` (`pairing.ts:172`) stops running on every request once the cookie is the
  hot path, leaving it only on mint/renewal.
- **Hand-edit drift** — **ADDRESSED**: the boxholder could hand-edit
  `mobile-devices.secret.json` or delete `mobile-session.secret`. Both fail closed —
  a missing secret regenerates (Failure modes row 3) and a malformed device store is already
  filtered by `safeParse` (`pairing.ts:65`).
- **Fabricated free-form value** — **N/A**: no agent-authored free-form values.
- **Validation error UX** — **ADDRESSED**: 401 bodies keep the existing shape
  (`server-box-scope.ts:99`: *"{ error: \"Not authenticated\" }"*), and the hub-mode
  variant's diagnostic detail (`server-box-scope.ts:102-108`) is left intact.
- **Partial migration / transition state** — **ADDRESSED**, and it is the sequencing
  constraint that orders the tracks: during Tracks 2–3 the server accepts *both* the query
  param and the cookie, so an un-updated iOS build keeps working. The query-param path is
  deleted only in the final chunk, after both clients have stopped sending it. An old iOS
  binary against a new box after that point fails closed with a 401 — acceptable because the
  app and box ship together, and stated in `mobile-contract.md`.

## NOT in scope

- **`expiresAt` on `MobileDevice`.** The issue is right that the durable token has no expiry,
  but with the cookie in place the durable token only ever crosses the wire in an
  `Authorization` header, and the *session* now expires hourly. Adding device-level expiry
  is a data-shape change to `mobile-devices.secret.json` that needs a migration per
  `cb-migration`, and it would force re-pairing of existing devices. Deferred as its own
  item; the leak surface this plan closes is the urgent half.
- **Retiring the localStorage token channel.** Track 3's recovery path depends on it. Once
  the cookie flow has been exercised on a real device, the recovery mint could move to a
  native-issued `postMessage` and localStorage could go away entirely — a strictly better end
  state, but it should not gate this plan.
- **`isPairingRedeemUrl`'s unanchored `endsWith`** (`routes/pairing.ts:12`). A separate
  bullet in the code-quality issue. It is adjacent but independently testable and unrelated
  to token transport; folding it in would blur this plan's diff.
- **`embed=1` vs `nativeComposer=1` param drift** and the **`resolvedSession` non-2xx
  bug** — the code-quality issue's remaining bullets, untouched here.
- **Android.** No Android client exists yet; `docs/plans/android-companion-app.md` describes
  the localStorage channel this plan starts to supersede, and gets a pointer, not a rewrite.
- **iOS stores the device token in plaintext.** `PairedBoxStore.swift:12-16` writes
  `paired-boxes.json` into Application Support via `JSONEncoder`, and grep confirms **no
  Keychain usage anywhere in the iOS target** (`kSec*`/`SecItem`/`Keychain` all return zero
  matches). The durable token therefore sits unencrypted in the app container. This is a real
  finding, discovered while mapping for this plan, but it is a storage-at-rest problem
  orthogonal to token-on-the-wire; folding it in would mix two unrelated threat models in one
  diff. **Filed separately** rather than silently dropped.
- **`withMobileAuth`'s spread order lets callers clobber `Authorization`** —
  `lib/mobile-auth.ts:16-25` spreads `auth` first and caller headers second. No current caller
  passes an `Authorization` header, so it is latent, not live. Filed, not fixed here.

## Open design questions

- **Cookie TTL: 1 hour.** The lean is 1h as written, trading a bounded revocation latency
  against renewal chatter. If the boxholder wants revocation to be effectively immediate, the
  alternative is checking the device store on every request — which reintroduces the
  read-write-per-request cost `pairing.ts:172` already imposes. Settled as 1h unless
  challenged; not blocking any first chunk.
- **Should the mint endpoint be rate-limited?** It is bearer-authed, so it is not an
  unauthenticated oracle, and no rate-limiting infrastructure exists in the codebase today.
  Lean: no, and do not build the infrastructure for this.

## Knowledge audits

This plan is infrastructural — it introduces no tag, card shape, or convention an agent
authoring box content needs to recall. The one agent-facing consequence is that a future
agent touching mobile auth must not reintroduce a URL credential.

The draft of this plan committed to one `knows_directly` entry — *"Where does the mobile
device token travel, and where must it never appear?"* **That was a mistake, made before
reading the corpus, and it is deliberately not being added.**

`src/dev/knowledge-audits.yaml` audits what a **box agent** knows about operating its box —
`box-structure-inbox`, `find-memo-cards`, `how-items-enter`, all sourced from the agent guide
and the box's CLAUDE.md. A box agent never sees mobile auth code; the question above is a
*callback-box developer* concern, and answering it correctly would depend on this repo's
`docs/mobile-contract.md`, which is not in a box agent's context at all. An entry there would
either fail for the wrong reason or pass by accident, and would misrepresent what that corpus
covers.

Skip-with-rationale, per the skill's own allowance: this is infrastructural, and its
agent-facing durability comes from `docs/mobile-contract.md` — which has a **pre-commit
tripwire** (`bin/mobile-contract-check.ts`) that blocks any commit touching an anchor file
without co-staging the doc. That is stronger enforcement than an audit would give, and the new
modules were added to the anchor list in this change.

## Implementation order

1. **Track 1** — `mobile-session.ts` + pure-function doctest. No dependencies.
2. **Track 2, chunk A** — acceptance path (box scope, server-root, hub `decideHubAuth`) +
   issuance `onSend` hook + mint endpoint, with route doctests. Depends on 1. Query param
   still accepted.
3. **Track 3** — iOS header-on-navigation + XCTest. Depends on 2 (needs a box that issues
   the cookie).
4. **Track 4** — web `getWebSocketUrl` deletion. Depends on 2.
5. **Track 2, chunk B** — delete all three `mobileTokenFromUrl` copies and the query-param
   acceptance. Depends on 3 and 4 — this is the chunk that would break an un-updated client,
   so it lands last.
6. **Docs + audit.** `docs/mobile-contract.md` is not optional here — its own sync rule
   (`:9-15`) says a commit touching *"an auth-token carrier, a webview query param, … or a
   server-side mobile-awareness branch"* **must** update the doc in the same commit. Concretely:
   - §2.1 carriers table (`:115-125`) — drop the `?mobileToken=` row, add the `cb_mobile` row.
   - §2.2 verification table (`:127-136`) — replace the `mobileTokenFromUrl` row (currently
     annotated *"duplicated verbatim 3×"*) with `verifyMobileSession`.
   - §7 Contract Surface Index — retire row A3 and **close risks S1 and S2**, both currently
     marked OPEN (`:435-440`).
   - §8 mirrored constants — add `cb_mobile` / `MOBILE_COOKIE_NAME`.
   - New prose: the ≤1h revocation-latency bound, and the compat note that an iOS build older
     than step 5 stops working.

   Then: the `knowledge-audits.yaml` entry run and recorded, and both issue files
   `git mv`-ed to `issues/closed/bugs/` and `issues/closed/code-quality/` with
   `resolution: implemented` and a closing note. The code-quality issue closes only
   *partially* — its parser bullet is resolved here, its other four bullets are not — so it
   gets a closing note naming which bullets survive, and the surviving ones are re-filed as a
   fresh item rather than buried in a closed file.

## Reconciliation — where the build diverged from this design

Recorded rather than quietly edited into the tracks above, because the divergences are the
part a future reader most needs.

1. **Renewal is a `preHandler` step, not an `onSend` hook.** Track 2 specified `onSend`.
   Renewal ended up in the box auth preHandler (`server-box-scope.ts`), beside the check that
   already resolved the identity — so it renews on requests that pass the gate, not on
   401s/redirects/static bypasses. That is the behavior we want and it avoids resolving the
   identity twice, but the plan text was wrong.

2. **The transition window in Implementation order was not used.** Steps 2–4 were designed to
   keep accepting `?mobileToken=` so an un-updated client kept working, with step 5 deleting
   it last. In practice the query-param acceptance was deleted in the same change that added
   the cookie, because leaving a URL credential accepted while the hub's gate was rewritten
   would have meant `hasMobileAuth` verifying one carrier and ignoring another. **Consequence:
   box and iOS app must deploy together; an older installed iOS build stops working against a
   deployed box.** Flagged for the boxholder rather than buried.

3. **Three defects found by cross-model review, fixed before landing.** Recorded because each
   was a silent failure the plan's Failure-modes table missed:
   - **WebSocket reconnect had no recovery.** The 401→mint→retry path lives in `trpcFetch`,
     which is HTTP-only. A failed WS *upgrade* has no response body to branch on — wsLink just
     backs off and retries. A device idle past the TTL would have reconnected forever,
     silently. Fixed by refreshing the session in `createWSClient`'s async `url` thunk before
     each socket open.
   - **Cookie shadowing across sibling boxes.** `parseCookieHeader` was last-wins on duplicate
     names, and boxes share one origin, so `document.cookie = "cb_mobile=junk; Path=/"` under
     box A crowded out box B's real cookie — a one-line cross-box DoS. Fixed with
     `parseCookieHeaderAll`; the resolver now tries every value.
   - **Verification could create a signing secret.** Box and hub verify in separate processes
     with separate caches. Whichever first saw a missing file would have minted and cached a
     new secret while the other kept the old one — every cookie verifying in one process and
     failing in the other, indefinitely. Fixed by making the verify path read-only
     (`readSecret`); only `signMobileSession` creates.

4. **`Path=/<slug>` is not the isolation boundary the draft implied.** Corrected in Track 2.
   The per-box signing secret is what prevents cross-box escalation. Same-origin sibling trust
   is pre-existing and out of scope; filed separately.

## Rollout shape

**Test posture.** Encoded as the done-when:

- `test/core/mobile/mobile-session.doctest.md` (pure) — sign/verify round-trip, expiry,
  tamper, cross-box rejection, garbage input.
- `test/webapp/mobile-cookie.doctest.md` (route, `makeTestServer()`) — cookie issued on a
  bearer-authed response; cookie accepted on a subsequent bare request; `Secure` present on
  HTTPS and absent on HTTP; box A's cookie rejected by box B; 401 when neither credential is
  present.
- `test/hub/hub-mobile-cookie.doctest.md` (route) — `decideHubAuth` authorizes on
  `cb_mobile`; the WS-upgrade path authorizes on it too (today's suite has **no**
  mobile-token WS-upgrade case at all); and the S1 regression: a request carrying a
  syntactically valid but cryptographically bogus credential is **rejected**, not proxied.
- **Existing doctests that must change**, not merely keep passing:
  - `test/webapp/mobile-spa-fallback.doctest.md` — its third case asserts
    `?mobileToken=<deviceToken>` → `200 text/html`. That case inverts to a 401 in step 5 and
    is replaced by a `cb_mobile` case. Its Bearer case stays green throughout.
  - `test/hub/hub-server-auth.doctest.md` — the mobile-Bearer case at `:88-100` asserts the
    hub proxies with `email:null, secret:null`. Still true; but the S1 fix means an
    *invalid* Bearer must now 401 at the hub, which is a new case in a file that currently
    has none.
- **Shared fixtures** — `test/mobile-contract/fixtures/pairing-url/` and `redeem/` are
  structurally validated only, and neither encodes the query-param carrier, so no fixture
  change is required. Confirmed rather than assumed, per the fixture policy in
  `test/mobile-contract/fixtures.doctest.md:1-10`.
- iOS: a new `ChatWebViewTests.swift` asserting `request()` carries
  `Authorization: Bearer <token>` and that its URL has no `mobileToken` query item, plus the
  nil-token case. Note this is a **new test file** — there is no existing `ChatWebView` or
  `PairedBoxStore` coverage in `CallbackBoxTests`, so it needs the full four-entry
  `project.pbxproj` treatment described in `ios-app/CLAUDE.md`.

Not chasing coverage — these track the Failure-modes table's "Test exists?" column and the
substantial new codepaths, per `docs/testing.md`.

**Migration.** No card-data migration. The only on-disk addition is
`<boxRoot>/.callback-box/mobile-session.secret`, created lazily on first use. Existing paired
devices keep working — their durable tokens are unchanged and still valid; they simply start
authenticating via header + cookie instead of query param.

**Knowledge audits.** The single entry above lands with the plan, run and recorded.

**Deploy.** Auto-deploy is `main`-only and this work is on a worktree branch, so nothing
ships until the boxholder asks for the merge. The box and iOS app should land together;
step 5 is the point after which an old iOS build stops working.
