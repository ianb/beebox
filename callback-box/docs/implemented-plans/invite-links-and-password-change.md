# Invite links and self-service password change

**Status:** Implemented 2026-08-06 after boxholder approval and cross-model review.

This plan adds the complete no-password-sharing lifecycle for member accounts.
An owner can invite one person to one box. The invitee chooses their own
password, and a signed-in local-password user can later rotate that password.
Google OAuth remains an optional login method for the same email identity.

**Job stories.**

- When I invite someone to a box, I want to send a short-lived link instead of
  a password, so only the invitee chooses their credential.
- When I do not know the invitee's email, I want the link holder to supply it;
  when I do know it, I want the link pinned to that email.
- When my password may be weak or exposed, I want to change it while signed in,
  so I can revoke old sessions without host access.
- When I use Google after accepting a password invite, I want the same verified
  canonical email to resolve to the same account and box access.

## Issues addressed

- `issues/closed/features/2026-07-20-invite-links.md`
- `issues/closed/features/2026-07-20-web-password-change.md`

The stale empty-allowlist copy recorded in
`docs/reports/user-stories-audit-2026-06-26.md:325-329` is corrected because the
same Admin component becomes the invite-minting surface.

## Stated preferences this plan trades against

- `docs/engineering-principles.md:37-47`: validate disk, form, OAuth, and config
  inputs once at a typed boundary and fail loudly.
- `docs/engineering-principles.md:49-62`: invite consumption, account creation,
  ACL writes, password hashing, and cookie renewal must never degrade invisibly.
- `docs/engineering-principles.md:64-73`: callers dispatch on explicit invite
  status and acceptance results rather than exception text.
- `docs/engineering-principles.md:95-104`: reuse the existing canonicalizer,
  scrypt implementation, throttle, session signer, identity resolver, ACL, file
  lock, and auth-route registration rather than adding competing mechanisms.
- `docs/engineering-principles.md:116-125`: expiry, contention, and injected
  storage failures need deliberate seams and deterministic tests.
- `callback-box/CLAUDE.md`: ordinary APIs use tRPC, while OAuth-like root auth
  pages and cookie-setting browser responses may use raw Fastify routes. Invite
  GET/POST and password-change POST are deliberate raw auth routes. Owner invite
  minting remains an ordinary tRPC mutation.
- `callback-box/CLAUDE.md`: the credential file is global. No existing `cb auth`
  behavior or `--agent-confirmed` guard changes. The first cut adds no new CLI
  command.
- `code-style.md:24-51`: use typed failures, minimal catches, and the shared
  cross-process file lock for mutations reachable from hub and child processes.
- `docs/implemented-plans/local-password-auth.md`: preserve global email
  identity, the local credential store, the setup capability, login throttling,
  and `gen`-based session revocation.
- `frontend.md:32-85`: use existing primitives and cover loading, errors,
  accessibility, responsive behavior, and real-browser verification.

## What already exists

- **Global credential store.** `src/webapp/local-users.ts:4-18` owns the global
  `~/.cb-auth.json`, validates it fail-closed, stores scrypt hashes, and mutates
  it with crash-safe replacement under the shared file lock. Invites create a
  normal member here; there is no second user database.
- **A local-owner prerequisite.** The auth schema requires exactly one owner,
  and `addUser` refuses to add a member when the auth file/owner is absent
  (`local-users.ts:63-70,264-280`). Google-only deployments can therefore sign
  in an owner without being able to create local members. Invite minting must
  detect this configuration before issuing a link.
- **Canonical email.** `local-users.ts:90-95` defines trim-plus-lowercase and
  `findUser` uses it. Some adjacent boundaries do not: `getOwnerEmail`,
  `canAccessBox`, legacy `allowedEmails`, Admin writes, and the Google callback
  can currently retain or compare raw case. This plan closes the whole boundary,
  not only the OAuth callback.
- **Non-overwriting member creation.** `addUser` creates `role: "member"` and
  rejects an existing email. Acceptance never replaces an existing password,
  role, name, or generation.
- **Password verification and mutation.** `verifyPassword` performs dummy scrypt
  work for unknown users; `setPassword` replaces the hash and increments `gen`
  (`local-users.ts:283-319,334-346`). The local-user cache is keyed by file
  metadata and also has an explicit reset seam; mutations followed by session
  signing should reset it rather than depend on filesystem timestamp behavior.
- **Shared session identity.** `signSession` consults the local generation, and
  `classifyLocalRecord` rejects stale or gen-less cookies once an email has a
  local record (`auth.ts:212-224,454-488`). Password and Google login therefore
  converge naturally after canonicalization.
- **Google callback.** `routes/auth-google.ts:93-114` verifies the ID token and
  reads `payload.email`, but does not require `email_verified === true` or
  canonicalize the value before signing.
- **Per-box ACL.** `box-access.ts:14-30` grants the owner access and grants a
  member only when `allowedEmails` explicitly contains the email. Empty means
  owner-only. `AllowedEmailsSection.tsx` currently says the opposite; the
  authorization code is authoritative.
- **Owner Admin seam.** `trpc/trpc.ts:21-31` defines `ownerProcedure`, but open
  test mode can satisfy owner authorization without a concrete human identity.
  Minting must additionally require `ctx.user`. `admin.ts:230-280` already
  updates and commits `allowedEmails`, but its in-process coordination is not
  sufficient when invite acceptance writes from the hub and Admin writes from a
  child. Both must use one cross-process box-config mutation helper.
- **Pre-auth auth pages.** `login-page.ts:2-20` supplies a scriptless,
  base-prefix-aware form shell. Invite acceptance follows that precedent with
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- **Setup capability.** `setup-token.ts:27-67` uses a 32-byte base64url token, a
  15-minute expiry, timing-safe comparison, explicit statuses, and clear-on-use.
  Invite tokens retain that contract but persist because Admin minting runs in a
  box child while acceptance runs in the root hub, and either process can restart
  during the link's lifetime.
- **Persistent nonce precedent.** `connectors/google-oauth-state.ts:12-22,127-171`
  stores only a nonce hash, prunes expired entries, and consumes once. The invite
  store uses that record pattern plus the shared lock and atomic writer.
- **Login protections.** `routes/auth-password-post.ts:37-55,208-254` bounds
  bodies, throttles by request IP and canonical email, caps concurrent scrypt,
  and gives unknown and wrong-password attempts the same result. Invite
  acceptance and password change reuse these controls.
- **Cookie-setting raw route precedent.** The password login handler owns both
  authentication and `Set-Cookie` in one response (`auth-password-post.ts:153-164`).
  Password change should do the same, avoiding a second login round trip.
- **Root registration.** `routes/auth.ts:59-85` registers one auth surface in
  standalone and hub mode. Hub children never verify credentials. Invite and
  password-change routes belong on that root surface.
- **iOS contract.** Native iOS uses pairing/mobile bearer credentials, not local
  password login. No pairing, mobile token, bridge, Swift, or
  `mobile-contract.md` change is required.

## Prior art and accepted identity tradeoff

- OWASP recommends random, long, stored-hashed, single-use, expiring URL tokens,
  trusted URL construction, rate limiting, and `Referrer-Policy: no-referrer`:
  <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>.
- OWASP recommends uniform authentication failures and throttling, including
  uniform status behavior:
  <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>.
- OWASP treats password changes as sensitive and recommends reauthentication:
  <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>.
- Google recommends stable `sub`, not mutable email, as the durable OIDC key.
  The boxholder explicitly selected email across both methods. We therefore
  require `email_verified`, canonicalize email, and treat a changed Google email
  as a different callback-box identity:
  <https://developers.google.com/identity/openid-connect/reference>.

No new external library is needed.

## Tracks / scope

### Track A — persistent invite capability and owner minting

**What.** Add a global invite store beside the global credential store and an
owner-only Admin mutation that mints one invite for the current box.

**Direction.**

- Add `src/webapp/auth-invites.ts`. Derive a sibling path from `authFilePath()`
  so tests remain isolated via `CB_AUTH_FILE`; do not alter the v1 user schema.
- Require minting in the box child and acceptance in the hub to resolve the same
  `authFilePath()`; fail closed at registration if their configured auth roots
  differ rather than creating two invite stores.
- Validate the complete file with Zod, refuse symlinks, enforce 0600, write
  atomically, and serialize read-modify-write with `withFileLock`. Corrupt or
  unreadable storage makes mint and acceptance unavailable; it never looks empty.
- Store SHA-256 hashes of 32-byte random base64url tokens. Each record contains
  `tokenHash`, `createdAt`, `expiresAt`, optional canonical `email`, exact
  `boxRoot`, and canonical `createdBy`. Never persist or log the bearer token.
- Use the setup flow's fixed 15-minute TTL. Prune expired records on mutation and
  enforce a small hard live-record cap without evicting live capabilities.
- `inspectInvite` returns `valid`, `invalid-or-gone`, or `unavailable`.
  `consumeInvite` rechecks and removes under the lock so exactly one concurrent
  acceptance obtains metadata.
- Add `admin.createInvite({ email?: string })`. It requires both
  `ownerProcedure` and a concrete `ctx.user`, takes `boxRoot` only from context,
  and calls the same service as future minting surfaces.
- Before minting anything, require a readable local auth file whose canonical
  owner matches the current owner identity. A Google-only owner gets a clear
  instruction to initialize local auth with the existing guarded `cb auth`
  workflow. Do not create or modify the auth file implicitly.
- A pinned invite is rejected at mint time if its email is the owner or already
  has a local-user record. An open invite defers its stricter collision check to
  acceptance because the email is not known yet.
- Return `{ invitePath, expiresAt }`, where `invitePath` is a root-relative path
  containing the token. The server does not guess browser origin; the Admin UI
  joins `window.location.origin + withBase(invitePath)` for display/copy so dev
  worktree prefixes and the production root both resolve correctly.
- No `cb auth invite` command in this cut. That removes public-URL resolution and
  a second minting entry point without weakening any existing CLI safety guard.

**Vocabulary lock-ins.** `/auth/invite`; `AuthInviteStatus`; fixed 15-minute
TTL; one invite grants one member identity access to exactly one box.

**First implementation chunk.** Write `test/webapp/auth-invites.doctest.md`
first: hash-at-rest, expiry, box binding, corruption, permissions, cap,
concurrent consume, replay, owner/local-auth prerequisites, and pinned conflicts.
Then implement the store and minting service; no route or UI yet.

### Track B — invite acceptance and one-box access

**What.** Add a public form that creates one local member, grants that canonical
email access to the stored box, signs the ordinary session cookie, and redirects
to the box.

**Direction.**

- Extend root auth registration so `registerPasswordRoutes` receives the
  registered boxes/options needed by `GET /auth/invite` and
  `POST /auth/invite`. These routes never run in a hub child.
- Render a scriptless, uncached, no-referrer page. A pinned invite shows its
  canonical email as read-only text and accepts no editable email. An open invite
  asks for email. Both ask for display name, password, and confirmation.
- Reuse the bounded form parser and add exact field caps. Establish one shared,
  server-side minimum of eight characters for setup, invite acceptance, and
  password change; the existing setup page's HTML minimum alone is not enough.
  Preserve all password characters and never truncate.
- Trust only token-store metadata. Resolve the stored exact `boxRoot` against
  the boxes registered on this auth surface before token consumption.
- Before token validation, throttle by request IP plus token hash so guessed
  emails cannot push a victim's login bucket into backoff. After a valid token
  establishes the canonical email, also apply the existing email bucket and
  global scrypt slot. Invalid,
  expired, replayed, malformed, collision, and unknown-target cases share one
  public status/message shape. Logs include a category, never token/password.
- For an open invite, reject the chosen email if it is the canonical owner, an
  existing local user, or appears in the canonicalized `allowedEmails` of **any**
  box registered on this auth surface. This prevents a bearer from claiming a
  pre-authorized Google-only identity. This cross-box check runs again
  immediately before durable mutation.
- A pinned invite may target an existing Google-only/allowlisted identity because
  the owner deliberately chose it, but it may not target the owner or an existing
  local user. Recheck those constraints before mutation.
- Validate and hash before consuming the token. Immediately before the first
  durable mutation, atomically consume it; a retry or different-email race then
  cannot create a second account.
- Create the `role: "member"` through `local-users.ts`; never overwrite. Reset the
  local-user cache before session signing.
- Factor `mutateBoxAllowedEmails` behind a shared cross-process lock keyed to the
  exact config path. Use it for both existing Admin edits and invite grants so
  hub and child writes cannot lose each other. Canonicalize/dedupe while writing,
  atomically replace the config, explicitly invalidate the config cache, and
  use the existing path-scoped Git commit helper.
- Treat the config-file write as the authorization commit point. A later Git
  stage/commit failure is visible operational degradation, but the account and
  authorization are complete; return success to the invitee and log a loud
  repair-needed error naming the box and config path rather than falsely claiming
  auth rollback. The staged/dirty path can temporarily block unrelated box
  operations, although the ordinary housekeeping sweep should normally commit
  it later. If the config
  write itself fails after account creation, return an explicit
  `account-created-access-failed` page naming the accepted canonical email and
  telling the invitee to contact the owner. The account is a safe orphan with no
  box access; the consumed token is not restored.
- Sign and set the normal generation-bearing cookie only after the account and
  ACL write succeed. Redirect using the existing validated worktree/box URL
  helper. The partial-failure page does not sign a session.

**First implementation chunk.** Write `test/webapp/invite-accept.doctest.md`
first: headers/forms, fixed validation, throttle, all collisions, pinned/open,
target resolution, single-use concurrency, account/ACL ordering, cross-process
ACL contention, cache refresh, Git degradation, injected write failures, and
unauthenticated hub reachability for `GET /auth/invite`.

### Track C — one canonical email identity across both methods

**What.** Make every authentication/authorization boundary consume the shared
canonical email form and require a verified Google claim.

**Direction.**

- Require non-empty `payload.email` and `payload.email_verified === true`, then
  call `canonicalizeEmail` before Google access checks and `signSession`.
- Canonicalize **both operands at every comparison**, not only newly minted
  values: `getOwnerEmail()` output, session/cookie email, hub-injected identity
  headers, owner checks, `canAccessBox`, `filterAccessibleBoxes`, the hub box
  picker, root-server checks, invite collision scans, and Admin `allowedEmails`
  input. This keeps pre-change mixed-case cookies and environment values working.
  Normalize/dedupe `config/box.json` allowlists in memory on reads and write
  canonical values on the next ordinary mutation; do not touch the unrelated
  publish-manifest `allowedEmails`. No bulk migration.
- A canonical email with a local record is one account for password and Google
  login. Google does not modify its password/role. A canonical Google-only email
  stays Google-only and remains governed by the same box ACL.
- Preserve the existing generation rule: once a local record is created, old
  gen-less Google cookies for that email are rejected and the person signs in
  again.

**First implementation chunk.** Add focused auth/ACL tests for mixed case and
space, legacy mixed-case config, unverified/missing Google email, same-email
method linking, changed-email separation, and old-cookie invalidation.

### Track D — authenticated self-service password change

**What.** Add a root raw `POST /auth/password` route and a member-visible
Settings form. It verifies the current password, updates the hash, revokes old
sessions, and sets a fresh cookie in the same response.

**Direction.**

- Register the route beside password login. Require a cookie-backed
  `resolveRequestIdentity` result with a concrete human `user`; reject machine
  and open/test identities.
- The Settings client posts through `withBase("/auth/password")`, preserving the
  dev worktree prefix while remaining `/auth/password` in production.
- Accept only bounded JSON/form fields `currentPassword`, `newPassword`, and
  `confirmPassword`. The email is always the canonical session email and can
  never be supplied by the client.
- Apply the existing request-IP/email throttle and global scrypt slot. Verify the
  current password through the uniform path. Google-only and wrong-password
  attempts share the same public authentication failure.
- Enforce the shared web-password bound/minimum, then call `setPassword`. Reset
  the local-user cache, sign a new generation-bearing session, and attach the new
  cookie to the successful response. There is no separate login request and no
  moment where the UI claims a rollback that did not happen.
- Expose only the current user's `hasPassword` state through the existing
  authenticated current-user/status seam; never reveal other accounts.
- Do not add a password to a Google-only account. That is a separate
  recent-OAuth/recovery design.

**First implementation chunk.** Write
`test/webapp/password-change.doctest.md` first: success plus fresh cookie, old
cookie revocation, wrong current password, no client-selected email, Google-only
and machine/open rejection, throttle, scrypt cap, bounds, and store failure.

### Track E — owner and member UI

**What.** Add invite creation to Admin Allowed Users and password change to
Settings; retain the server-rendered public page from Track B.

**Direction.**

- Keep direct allowlist editing. Correct empty-list copy to “owner-only.”
- Add optional pinned email plus an explicit “Let invitee enter email” choice.
  Show the fixed expiry before minting and warn that an open link lets its holder
  choose an otherwise unclaimed email.
- On success, join `window.location.origin + withBase(invitePath)`; copy the
  result without console logging, analytics, query persistence, or local storage.
  Render loading/error/success and local-owner-prerequisite states.
- Add `PasswordSection` to member-visible Settings. Show the form only for a
  local account and explain that Google-only accounts have no local password.
- Use existing fields/buttons, inline errors, error focus, keyboard submission,
  `autocomplete="current-password"`/`"new-password"`, and non-color-only status.
- After success, clear all password fields and announce that other sessions were
  signed out. The new cookie is already present from the route response.
- Verify Admin, invite, and Settings at desktop and 375x800, keyboard-only, dark
  mode, and with client-debug logs inspected.

### Track F — operator and security documentation

- Document Admin minting, the required initialized local owner, bearer-link
  handling, fixed TTL, one-box scope, pinned/open behavior, recovery, and
  self-service password change.
- Update `docs/todo-security.md`: hashes at rest, single use, open-link email
  choice, collision exclusions, Google-email tradeoff, and lack of email delivery
  verification.
- Document partial acceptance: an account can exist without box access only when
  the ACL file write fails. The owner may add the exact email through Admin or
  remove the orphan with the existing guarded CLI before issuing another invite.
- Note that creating that local orphan invalidates any older gen-less Google
  sessions for the same pinned identity; the partial page is therefore part of
  the recovery signal, not merely informational copy.
- On completion, move both issues to closed and this plan to
  `docs/implemented-plans/` through the finish workflow.

## Could this be simpler?

The retained simplest cut is **Admin-only**. A new CLI minting command, public URL
resolution, invite listing/revocation, and email delivery are deferred.

Process-memory tokens are not sufficient because minting and acceptance occur in
different processes and lazy processes restart. Account-only invites are not
useful because the per-box ACL is authoritative. Omitting password rotation
would leave password sharing solved only at creation, not through the account
lifecycle. The persistent hashed token store, one-box grant, identity hardening,
and cookie-renewing password route are the minimum coherent feature.

## Subplans

None. The capability, identity, ACL, and password seams are tightly coupled and
ship together. Each track remains an independently testable commit boundary.

## Failure modes

There is one non-atomic boundary: global account creation precedes the per-box
ACL write. Its safe partial state is a member with no box access. The ACL file
write is the authorization commit point; Git commit failure after it is an
operator-visible persistence problem, not an authentication rollback.

| What can fail                                           | Detection / test               | Handling and visibility                                                                                                                       |
| ------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No initialized local owner                              | Minting doctest                | Refuse to mint; explain the existing guarded setup command; change nothing                                                                    |
| Invite store missing                                    | Store doctest                  | Create only on authenticated owner mint; acceptance treats absence as dead link                                                               |
| Invite store corrupt, symlinked, unreadable, or unsafe  | Store/route doctests           | Typed unavailable result; mint/accept fail closed with clear 503 and secret-free server context                                               |
| Concurrent mint/consume                                 | Contention doctest             | Shared lock plus atomic write; exactly one consume succeeds                                                                                   |
| Guessed, expired, replayed, malformed token             | Store/route doctests           | Hash lookup, TTL, atomic consume, one generic holder-facing failure                                                                           |
| Token leaks through referrer/cache                      | Header doctest                 | Scriptless page, no-referrer, no-store, short TTL, single use; proxy access logs remain accepted exposure                                     |
| Pinned field tampering                                  | Route doctest                  | Ignore submitted email and use stored canonical email                                                                                         |
| Open holder chooses owner/local/pre-authorized identity | Cross-box route doctest        | Recheck all registered boxes immediately before mutation; generic collision failure                                                           |
| Pinned invite conflicts before acceptance               | Mint and route doctests        | Owner/local rejected; deliberate Google-only/allowlisted target permitted; no overwrite                                                       |
| Target box disappeared                                  | Route doctest                  | Resolve before consume; no durable mutation                                                                                                   |
| Scrypt capacity exhausted                               | Invite/password route doctests | Existing slot returns retry before mutation                                                                                                   |
| Token consumed, account creation fails                  | Injected failure               | No ACL write; dead token; clear generic holder failure and contextual server error                                                            |
| Account created, ACL file write fails                   | Injected failure               | Safe orphan, no cookie; explicit partial-completion page names accepted email and owner recovery                                              |
| ACL write succeeds, Git commit fails                    | Injected failure               | Account/access/cookie succeed; log box/path and possible staged-operation blockage; housekeeping normally commits later; never claim rollback |
| Hub and child edit ACL concurrently                     | Cross-process contention test  | One shared config-path lock, fresh read inside lock, canonical merge; no lost update                                                          |
| Auth/config caches lag mutation                         | Route doctest                  | Explicit invalidation/reset before authorization or signing                                                                                   |
| Google email missing/unverified                         | OAuth doctest                  | Reject before access check or cookie                                                                                                          |
| Google/config email differs by case/space               | Auth/ACL doctest               | Shared canonicalization links correctly, including legacy config reads                                                                        |
| Password caller lacks human cookie identity             | Password route doctest         | Unauthorized; machine/open contexts cannot mutate                                                                                             |
| Wrong current password or Google-only account           | Password route doctest         | Shared generic proof failure and throttle; no enumeration                                                                                     |
| New password invalid/oversized                          | Password route doctest         | Shared server-side rule rejects before mutation                                                                                               |
| Password store fails                                    | Password route doctest         | 503; no claimed success                                                                                                                       |
| Secret appears in logs or durable plaintext             | Static review plus assertions  | Tokens only hashed; passwords only scrypt; UI/log/storage assertions fail the review                                                          |

## Agent-flow / user-flow edge cases

- **Method switching.** Password and verified Google login resolve to canonical
  email and the same `gen` once a local record exists.
- **Stale/racing link.** Expired, consumed, and losing concurrent requests share
  one dead-link state; exactly one request obtains capability metadata.
- **Free-form open email.** Canonicalization is not ownership verification. The
  holder can choose only an identity that is neither owner, local, nor already
  authorized anywhere on this server; the owner UI states this limitation.
- **Signed in as someone else.** The invite capability authorizes acceptance;
  success replaces the browser cookie with the created member after warning.
- **Legacy mixed-case ACL.** Reads canonicalize without migration; the next
  ordinary write canonicalizes and deduplicates.
- **Wrong pinned email.** It expires in 15 minutes and cannot overwrite owner or
  local credentials. Manual revocation is deferred.

## NOT in scope

- Email delivery or ownership verification. Links are copied out of band.
- Password reset/forgotten-password email. Existing guarded host-side
  `cb auth set-password` remains recovery; self-service change requires the
  current password.
- Adding a local password to a Google-only account.
- CLI invite minting; invite listing, revocation, resend, custom TTL, or audit UI.
- A general user directory, changing roles, changing account email/name, or
  granting members all boxes.
- Provider-link records keyed by Google `sub`; email identity is an explicit
  product decision despite Google's contrary recommendation.
- OAuth PKCE/nonce redesign, MFA, passkeys, strength services, or a session DB.
- Changes to `--agent-confirmed`, auth schema, secrets, mobile pairing, or iOS.
- A general cross-file transaction coordinator. Safe ordering and explicit
  partial recovery cover this feature's two stores.

## Approved design choices

The boxholder approved these settled choices before implementation:

- first release is Admin-only;
- minting requires an initialized matching local owner;
- every invite grants exactly one box;
- pinned invites can deliberately claim an existing Google-only/allowlisted
  email, while open invites cannot claim any already privileged identity;
- TTL is fixed at 15 minutes;
- password change is a raw cookie-renewing auth route;
- listing/revocation and Google-only password bootstrap are deferred.

## Knowledge audits

Skip. These are human-facing authentication operations and do not alter what a
box agent must know, a card schema, or box authoring guidance. There is no new CLI
vocabulary in this cut.

## Implementation order

1. **Capability core.** Failing store/mint prerequisite tests, then persistent
   hashed invite storage and service.
2. **Identity and ACL hardening.** Failing canonicalization and cross-process
   config-mutation tests, then shared canonical boundaries/lock helper.
3. **Acceptance core.** Failing root route tests, then invite form, collision
   protection, account creation, ACL grant, cache reset, session, failures.
4. **Owner minting UI/API.** Failing tRPC authorization tests, then
   `admin.createInvite` and Admin UI/copy.
5. **Password backend.** Failing raw route tests, then current-password proof,
   hash update, cache reset, and same-response cookie renewal.
6. **Password UI.** Settings status/form, accessibility, and real-browser checks.
7. **Docs and verification.** Security/operator docs, focused and full checks,
   then cross-model diff review. Do not merge until separately instructed.

Each numbered item is a commit boundary, not a ship boundary. Each starts with a
deterministic red doctest and lands only with its focused checks green.

## Rollout shape

- **Tests.** Add `auth-invites.doctest.md`, `invite-accept.doctest.md`, and
  `password-change.doctest.md`; extend the closest OAuth/session/box-access/Admin
  doctests. Use isolated `CB_AUTH_FILE` and registered test boxes; never touch
  real credentials.
- **Commands.** Run each changed doctest alone first, the auth set serially when
  shared process state matters, targeted lint/typechecks, then the full suite.
  A contention-shaped run is required for invite consumption and ACL writes.
- **Manual browser verification.** Through the isolated worktree URL, verify
  pinned/open minting and acceptance, replay, Google/password same-email login,
  password change, old-session revocation in a second browser, responsive/dark/
  keyboard states, and client-debug logs. No real credential mutation for tests.
- **Migration.** No auth-file migration. The invite store appears on first mint.
  Existing config reads canonicalize in memory; later writes normalize. Existing
  matching Google cookies may require one login after a local record is added.
- **Rollback.** Removing invite/password surfaces leaves created users and ACLs
  as ordinary valid state. Existing CLI recovery remains. Leave the unused invite
  store in place; never delete it automatically.
- **Ship boundary.** Both source issues and this plan moved to their
  closed/implemented locations after implementation review. Merge/deploy remains
  a separate boxholder instruction.

## Implementation evidence

- Seven implementation commits cover the capability store, canonical identity
  and ACL writes, acceptance, owner/password UI, operations, and security-review
  hardening.
- Focused route and service doctests cover minting, pinned and open acceptance,
  expiry/replay, collisions, throttling, partial storage failures, password
  rotation, OAuth identity, hub propagation, and sanitized HTTP errors.
- The final full run passed 6,368 assertions in 475 suites with zero failures.
- Backend and frontend typechecks, lint, documentation checks, and the repository
  commit hooks passed.
- Desktop and mobile signed-out/loading states were checked in a real browser.
  A signed-in owner mint and successful acceptance remain useful post-merge
  smoke tests because the isolated browser had no owner credentials.

## Cross-model review disposition

The first outside review found two blockers and eight important ambiguities. This
revision adopts its local-owner prerequisite, open-invite collision exclusions,
raw cookie-renewing password route, full canonicalization boundary, root-relative
URL result, concrete-user minting check, explicit cache reset, shared
cross-process ACL lock, and server-side password minimum. It deliberately does
not add compensating account deletion after an ACL-file write failure:
`removeUser` can itself fail, adding a second mutation and failure mode without
eliminating the need for explicit recovery. The plan distinguishes a visible
safe pre-write orphan from post-write Git degradation.
