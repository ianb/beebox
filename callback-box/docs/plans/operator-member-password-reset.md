# Operator-driven member password reset

**Status:** partially implemented 2026-08 — feature and automated credential-path coverage shipped; isolated browser validation remains

The operator and member flows described below are implemented. Automated tests
cover capability migration/isolation, authorization, reset redemption, session
revocation, replay, throttling, scrypt capacity, and failure pages. The isolated
browser checklist and direct route-level post-consume race injection were not
performed; the locked credential mutation's `NoSuchUserError` seam and the
route's 410 mapping are covered separately.

This plan lets a box owner create a short-lived password-reset link for an
existing member. The member chooses the new password. The owner never sees the
password, and the reset revokes every outstanding session for that member.

**Job stories.**

- When I am a member and I forgot my password, I want the box owner to give me
  a short-lived recovery link, so I can choose a new password without giving the
  owner my password.
- When a member asks for account recovery, I want to create the link from the
  Allowed Users list, so I do not need shell access or a separate user directory.
- When I finish a reset, I want every previous session for my account to stop
  working, so a lost browser or exposed old password cannot retain access.
- When a reset link is stale, replayed, or for an account that no longer has
  access, I want one safe failure message, so the recovery surface does not
  disclose account state.

## Issues addressed

- `issues/features/2026-08-07-web-password-reset-account-recovery.md`

The issue records the chosen direction at lines 9-15: *“the operator mints a
reset link (a fresh invite-style capability pinned to the member's email) and
hands it to the member, who sets their own new password.”* A queue search for
`password`, `reset`, `recovery`, `invite`, and `member` found the two shipped
adjacent issues, but no duplicate open recovery issue:

- `issues/closed/features/2026-07-20-invite-links.md`
- `issues/closed/features/2026-07-20-web-password-change.md`

Those closed issues remain precedent. This plan does not reopen them.

## Stated preferences this plan trades against

- **Principle 1, types are structure.** `docs/engineering-principles.md:12-21`
  says: *“Prefer types that make illegal states unrepresentable:
  discriminated unions over flat interfaces with correlated optional fields.”*
  Invite and password-reset capabilities must be sibling variants. A reset
  email cannot be optional, and an invite route cannot consume a reset token.
- **Principle 2, exhaustiveness.** `docs/engineering-principles.md:23-35` says:
  *“Every dispatch over a closed set ... must fail to compile when a member is
  added.”* Capability-kind dispatch must be exhaustive.
- **Principle 3, validate at boundaries.** `docs/engineering-principles.md:37-47`
  says disk, HTTP bodies, and config files *“get validated into typed data
  exactly once, at the boundary, with loud, localized failure.”* The capability
  store migration and reset form both use Zod boundaries.
- **Principle 4, resilient and never silent.** `docs/engineering-principles.md:49-62`
  says: *“Every catch block either rethrows, returns a typed failure, or logs.”*
  Capability-store and credential-store failures must fail closed and remain
  visible in server logs without exposing paths to the link holder.
- **Principle 5, failure paths in signatures.**
  `docs/engineering-principles.md:64-73` says callers that branch on failure
  reason use a discriminated result. Inspect and consume keep explicit
  `valid`/`consumed`/`invalid-or-gone` results.
- **Principle 6, right-sized defensiveness.**
  `docs/engineering-principles.md:75-85` says defense belongs at disk, network,
  and process boundaries. The plan rechecks member and box access at redemption
  because both stores can change after minting. It does not add checks between
  same-process typed helpers.
- **Principle 7, hierarchy and naming.**
  `docs/engineering-principles.md:87-93` says: *“A name is a promise; keep it.”*
  The shared module becomes `auth-capabilities.ts`; a module named only for
  invites must not silently own password resets.
- **Principle 8, one way to do each thing.**
  `docs/engineering-principles.md:95-104` says: *“Competing idioms are drift
  generators.”* Reset reuses the existing token generator, hash comparison,
  store lock, atomic writer, throttle, password hasher, and session generation.
- **Principle 10, testability is architectural.**
  `docs/engineering-principles.md:116-125` requires deliberate seams for clock,
  storage, and decision logic. Store migration, expiry, races, and post-consume
  failures need deterministic doctests.
- **HTTP route boundary.** `CLAUDE.md:110` says: *“HTTP endpoints go in tRPC by
  default,”* while raw Fastify routes are for flows such as OAuth redirects that
  do not fit an ordinary request/response procedure. Owner minting is an ordinary
  Admin tRPC mutation. The public, scriptless, cookie-independent reset GET/POST
  is a root auth route beside invite acceptance.
- **Credential safety.** `CLAUDE.md:117` says the credential store is global and
  `cb auth set-password` *“revokes the user's live sessions.”* Tests use an
  isolated `CB_AUTH_FILE`. Manual verification must also isolate the sibling
  capability store because it derives from that path. No test or browser check
  may use the machine-global default auth path.
- **Failure visibility.** `code-style.md:67-69` requires every non-rethrowing
  catch to log or justify itself, and says: *“User-initiated actions never
  silently no-op.”* Admin mint failures and public redemption failures have
  visible UI states.
- **Frontend primitives.** `frontend.md:32-43` requires existing `Button`,
  `InlineAction`, `Card`, and field primitives before new appearance code.
  `AllowedEmailsSection` predates that convention and still uses raw Tailwind
  rows. Track D migrates this one component to the existing primitives while it
  adds the reset action. `InviteSection` supplies the link-copy precedent.
- **Tests as design.** `CLAUDE.md:11-17` says doctests are the primary test
  format and tests must pass before commit. Each substantial track starts with a
  focused failing doctest.
- **Shipped precedent.** `docs/plans/invite-links-and-password-change.md:59-123`
  records the current credential store, canonical email, password mutation,
  session generation, scriptless page, throttle, and root-route seams. This plan
  extends that shipped shape and keeps its accepted trusted-channel model.

## What already exists

- **The decided product boundary.**
  `issues/features/2026-08-07-web-password-reset-account-recovery.md:9-15`
  says: *“build option 2 — an operator-driven member password reset that reuses
  the invite-link machinery.”* This plan implements that decision. It does not
  add email delivery.
- **The global local-user store.** `src/webapp/local-users.ts:211-220` exposes
  `listUsers()` and `getLocalUser()` as public views without hashes. The plan
  reuses them to determine whether an allowed email has a local member account.
- **Session revocation.** `src/webapp/local-users.ts:345-356` says:
  *“Set a user's password and bump `gen` (revokes every outstanding session).”*
  Reset uses the same mutation rule. It adds a pre-hashed sibling so the
  expensive scrypt operation completes before capability consumption.
- **No-overwrite account creation.**
  `src/webapp/local-users.ts:275-290` inserts a member under the auth-file lock
  and rejects an existing email. Password reset does not reuse account creation;
  it requires an existing `role: "member"` record and preserves name and role.
- **Uniform password proof.** `src/webapp/local-users.ts:294-298` says wrong
  password and unknown email return the same `null`. The reset flow has no email
  request endpoint, but it preserves generic public failures after token lookup.
- **Self-service password change.**
  `src/webapp/routes/auth-password-change.ts:12-21` validates current, new, and
  confirmation fields. Lines 33-66 require a cookie identity, verify the current
  password, call `setPassword`, reset the cache, and return a fresh cookie. Reset
  reuses the new-password bounds and mutation, but token possession replaces the
  current-password proof and reset does not mint a session.
- **First-run setup.** `src/webapp/routes/auth-password-post.ts:302-335` accepts
  a setup token only while there are zero users. Lines 370-386 take the global
  scrypt slot, create the owner, clear the setup token, and sign in. Password
  reset is not setup: it accepts no name or editable email and never creates an
  owner or member.
- **Persistent invite capabilities.** `src/webapp/auth-invites.ts:13-30` defines
  32 random bytes, a 15-minute TTL, a 100-record cap, and a Zod-validated v1
  store. Lines 71-81 derive the store beside `CB_AUTH_FILE`, hash tokens with
  SHA-256, and compare hashes timing-safely. The plan generalizes this store.
- **Atomic single use.** `src/webapp/auth-invites.ts:172-188` rechecks under the
  store lock, removes the matching live record, and returns one consumed result.
  Reset gets a sibling consume operation. A wrong-kind token is
  `invalid-or-gone`, not an invite or reset.
- **Invite route protections.** `src/webapp/routes/auth-invite.ts:25-39` bounds
  form fields, sets `no-store` and `no-referrer`, and derives a token-hash
  throttle key. Lines 124-170 apply the token bucket before inspection, return a
  generic dead-link page, and apply the email bucket only after the token
  establishes an email. Reset retains this order.
- **Hash-before-consume ordering.**
  `src/webapp/routes/auth-invite.ts:174-190` hashes the password, rechecks the
  target, consumes the capability, and then writes the account. Reset follows
  this precedent to keep expensive or correctable failures before consumption.
- **Scriptless public forms.** `src/webapp/routes/auth.ts:167-180` confines the
  URL-encoded parser to the root auth plugin and registers invite acceptance
  there. Reset registers in the same scope. It works without the gated SPA.
- **Allowed Users is the member-management surface.**
  `src/frontend/src/components/admin/AllowedEmailsSection.tsx:99-133` renders
  the owner and every allowed email as the box's user list. Lines 113-127 already
  provide a per-email action row. Reset adds an eligible per-row action here; it
  does not create a second directory.
- **Allowed-email/local-account distinction.**
  `src/frontend/src/components/admin/AllowedEmailsSection.tsx:64-83` queries
  `admin.localAccountStatus` before granting an existing account. The backend at
  `src/webapp/trpc/routers/admin.ts:176-181` currently returns only `{ exists }`.
  The plan enriches the Admin data once, while the mutation revalidates at write
  time.
- **Invite link copy UI.**
  `src/frontend/src/components/admin/InviteSection.tsx:27-38` joins a returned
  root-relative path with `window.location.origin` and `withBase`, then copies
  it. Lines 78-89 show URL, expiry, and copy feedback. Reset reuses this local
  presentation pattern inside Allowed Users. It never logs or stores the token.
- **Owner-only minting.** `src/webapp/trpc/routers/admin-invites.ts:9-23`
  combines `ownerProcedure` with a concrete signed-in owner and matching local
  owner prerequisite. Reset minting reuses the same prerequisite and takes
  `boxRoot` only from context.
- **Host recovery remains.** `src/cli/commands/auth.ts:237-245` defines
  `set-password` as *“Change a user's password (revokes their outstanding
  sessions).”* This remains the owner-recovery and emergency fallback.
- **Security documentation.** `docs/todo-security.md:20-28` records hashed,
  single-use, 15-minute invite capabilities, generic failure responses, the
  login throttle, the scrypt cap, and generation revocation. The plan updates
  this section to include member reset and removes the line 40 statement that
  no password reset exists.
- **Tests.** `test/webapp/auth-capabilities.doctest.md` verifies hash-at-rest,
  mode 0600, expiry metadata, and single use. Lines 112-164 verify corruption,
  symlinks, capacity, and cross-process consume. `test/webapp/invite-accept.doctest.md:30-109`
  verifies public headers, mismatch retry, success, and replay. These are the
  closest store and route precedents.

## Prior art (external)

- The OWASP Forgot Password Cheat Sheet recommends long random URL tokens,
  secure storage, single use, expiry, rate limiting, `Referrer-Policy:
  no-referrer`, password confirmation, and invalidation of existing sessions:
  <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>.
  The plan follows these controls even though the operator, not email delivery,
  supplies the side channel.
- The same OWASP guidance says the user should log in through the ordinary
  mechanism after reset and should not be logged in automatically. Reset
  therefore redirects to the normal login page with a success state. It does
  not reuse invite acceptance's automatic session creation.
- NIST SP 800-63B permits an application-specific recovery method based on a
  documented risk analysis and requires recovery secrets to be throttled and
  invalidated after use:
  <https://pages.nist.gov/800-63-4/sp800-63b.html>. The trusted box owner acts as
  the recovery contact in this application-specific AAL1 model.
- NIST also expects an independent account-recovery notification. Callback Box
  has no verified outbound member channel. This plan records that notification
  as a residual limitation instead of adding unverified email infrastructure.
- MDN specifies `autocomplete="new-password"` for password creation and reset
  fields:
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete>.
  The reset page uses it for both password fields.
- No third-party library is required. Fastify, Zod, the existing file-lock and
  atomic-write helpers, tRPC, and the current React primitives cover the work.

## Tracks / scope

### Track A — typed sibling capability and store transition

**What.** Generalize the persistent invite store into a typed auth-capability
store. Add a password-reset variant without allowing either route to consume the
other variant.

**Why this needs to change.** The current store has one untyped purpose:
`src/webapp/auth-invites.ts:1` says it holds capabilities *“for creating one
member account.”* Reusing that exact type would let account creation and
credential replacement share ambiguous metadata. A separate copied store would
duplicate the lock, expiry, hashing, corruption, and capacity rules.

**Direction.**

- Rename `src/webapp/auth-invites.ts` to `src/webapp/auth-capabilities.ts`.
  Preserve the on-disk path `${authFilePath()}.invites.json` so deployment and
  backup configuration do not move a secret file during this feature.
- Define an in-memory discriminated union:

  ```ts
  type AuthCapability =
    | { kind: "invite"; boxRoot: string; email?: string; createdBy: string; expiresAt: number }
    | { kind: "password-reset"; boxRoot: string; email: string; createdBy: string; expiresAt: number };
  ```

  The stored records also carry `tokenHash` and `createdAt`. Reset email is
  required and canonical. Invite email remains optional.
- Change the disk schema from v1 `{ version: 1, invites: InviteRecord[] }` to v2
  `{ version: 2, capabilities: StoredAuthCapability[] }`. Read and validate both
  versions. Normalize each v1 record to `kind: "invite"` in memory. Every
  mutation writes v2 atomically under the existing lock.
- Keep purpose-specific public APIs:
  `mintAuthInvite`/`inspectAuthInvite`/`consumeAuthInvite` and
  `mintAuthPasswordReset`/`inspectAuthPasswordReset`/`consumeAuthPasswordReset`.
  Common private helpers own token generation, hashing, comparison, TTL, prune,
  locking, and writes. A purpose-specific inspect or consume treats a valid
  token of the other kind as `invalid-or-gone`.
- Rename store and capacity errors to purpose-neutral typed errors. Update all
  existing invite callers. Do not preserve duplicate invite-named aliases.
- Keep 32 random bytes, SHA-256 at rest, timing-safe comparison, 15-minute TTL,
  mode 0600, symlink refusal, and one total cap of 100 live auth capabilities.
- Minting a password reset removes every older live password-reset capability
  for the same canonical email before checking the total live-capability cap.
  It then rejects the mint only if adding the replacement would still exceed
  the cap. The account is global, so replacement is global across boxes.
- Consuming a password reset removes the matched record and every other reset
  record for the same canonical email. Thus a completed reset cannot leave an
  older recovery link able to replace the new password.
- A v2 store is intentionally unreadable to an old process. Old code fails
  closed with its existing store-unavailable behavior instead of silently
  dropping reset records. The rollout restarts the auth surface and box
  children as one deployed unit. A rollback can leave v2 in place; the old
  release will refuse invite operations until the new release is restored or a
  deliberate store migration is performed.

**Vocabulary lock-ins.** `kind: "password-reset"`; `AuthPasswordReset`;
`/auth/reset-password`; one live reset per canonical account; fixed 15-minute
TTL; the legacy on-disk filename remains `.invites.json`.

**First implementation chunk.** Extend and rename
`test/webapp/auth-capabilities.doctest.md` to
`test/webapp/auth-capabilities.doctest.md`. Add failing cases for v1 read and v2
write, kind isolation, required reset email, global 100-record cap, latest-link
replacement including replacement while the store starts at cap, all-links
invalidation on consume, expiry, hash-at-rest, permissions, corruption,
symlinks, and concurrent consume. Then implement only the store and APIs.

### Track B — owner minting and Allowed Users eligibility

**What.** Add an owner-only mutation that mints a reset capability for an
existing local member who is allowed in the current box. Enrich the existing
Allowed Users data so the row can show the action only when it applies.

**Why this needs to change.** `AllowedEmailsSection` has the correct product
location, but allowed email is not identical to local password account. An
allowlisted Google-only identity has no local password to reset. Client-only
eligibility would race and would allow a crafted mutation for an owner,
nonexistent account, or member outside the current box.

**Direction.**

- Add `passwordResetEligibleEmails: string[]` to `admin.boxConfig`. Derive it
  from the intersection of normalized `allowedEmails` and local users whose
  role is `member`. Do not return names, generations, password hashes, users
  from other boxes, or the owner.
- Add `admin.createPasswordReset({ email: string })` in a sibling Admin router
  module. Require `ownerProcedure`, a concrete `ctx.user`, and the same matching
  local-owner prerequisite as invite minting.
- Canonicalize and validate the email. Re-read the local record and current box
  config at mutation time. Require `role === "member"` and current access to
  `ctx.boxRoot`. Reject owner, Google-only, removed, nonexistent, and
  other-box-only identities before minting.
- Return `{ resetPath, expiresAt }`, where `resetPath` is
  `/auth/reset-password?token=<encoded token>`. The server never constructs an
  origin and never logs the token.
- The owner surface can return precise `BAD_REQUEST`, `CONFLICT`,
  `PRECONDITION_FAILED`, and capacity errors because it is authenticated and
  already displays the allowed email. Generic anti-enumeration failures apply
  to the public bearer route.

**Vocabulary lock-ins.** `admin.createPasswordReset`;
`passwordResetEligibleEmails`; `resetPath`.

**First implementation chunk.** Extend
`test/webapp/trpc-admin-box-config.doctest.md` with failing cases for the
eligibility intersection, owner and Google-only exclusion, stale local user,
other-box-only member, concrete owner requirement, canonical email, capacity,
store failure, and replacement of an older reset for the same account. Then
implement the query field and mutation.

### Track C — public reset redemption

**What.** Add a scriptless root GET/POST flow that accepts a password-reset
capability, lets the pinned member choose a new password, revokes all existing
sessions, and sends the member to ordinary login.

**Why this needs to change.** Password change requires the forgotten current
password. Setup creates the first owner. Invite creates a new member. None can
safely replace an existing member credential based on a reset bearer.

**Direction.**

- Add `src/webapp/routes/auth-password-reset.ts` and
  `src/webapp/password-reset-page.ts`. Register GET and POST in the existing
  root URL-encoded auth scope. Do not register them in a box child.
- GET `/auth/reset-password?token=...` inspects only a password-reset
  capability. It resolves the stored exact `boxRoot` against registered boxes,
  verifies that the canonical email still names a local member with access to
  that box, and renders the pinned email as read-only text.
- The form accepts only bounded `token`, `newPassword`, and `confirmPassword`.
  It uses `autocomplete="new-password"`, a minimum of eight characters, a
  maximum of 1024 characters, and the shared 16 KiB auth-body limit. It does
  not accept email, name, role, box, or current password.
- Apply `Cache-Control: no-store` and `Referrer-Policy: no-referrer` to every
  reset response. The page contains no script or external resource.
- GET inspection matches the existing invite GET: it performs no throttle
  mutation. The 256-bit bearer is not practically enumerable, and recording
  dead-link refreshes in the shared login throttle would delay the member's
  subsequent login. POST redemption checks a reset-specific throttle with request
  IP plus a SHA-256 token key before capability inspection. Record invalid,
  expired, replayed, wrong-kind, and stale-target POST attempts as failures in
  that bucket. Do not use a submitted email as a throttle key.
- Reset throttling deliberately remains isolated from ordinary login backoff:
  the capability itself is the credential, so there is no account-password
  proof to brute-force. After a valid token establishes the target, acquire the
  process-global scrypt slot. Throttle and capacity failures return a retryable
  generic reset-page state without consuming the token.
- A password mismatch or invalid password re-renders the same form with a
  generic correctable error and preserves the live token. It does not disclose
  any account state.
- Hash the new password before consumption. Recheck the local member, role, and
  box access after hashing. Then consume the reset capability under the
  capability lock.
- Add `setPasswordWithPasswordHash({ email, scrypt })` beside
  `addUserWithPasswordHash`. It rechecks the user under the auth-file lock,
  preserves name and role, replaces the hash, increments `gen`, and returns the
  public user. `setPassword` delegates to this helper after hashing so the
  generation rule remains in one implementation.
- After consume succeeds, call `setPasswordWithPasswordHash`, reset the local
  user cache, and record throttle success. Do not set a session cookie.
- Redirect success to
  `${prefix}/auth/login?returnTo=<encoded prefixed box path>&passwordReset=1`,
  where `prefix` comes from `readBasePrefix(request.headers)` and the return
  path is `${prefix}/${box.slug}/`. Extend the login page's validated query
  state to show “Password reset. Sign in with your new password.” The member
  authenticates through the normal login handler.
- Invalid, expired, replayed, wrong-kind, disappeared-box, removed-user,
  role-changed, and no-longer-allowed cases share one 410 “Reset link
  unavailable” page. Store failures return a generic 503 page. Logs record a
  bounded category and IP, never token, password, email for invalid tokens, or
  filesystem path in the public response.
- There is one non-atomic boundary: capability consumption precedes the
  credential write. Hashing and all ordinary eligibility checks happen first.
  If the credential write then fails, the route logs the failure, returns 503,
  and the owner must create a new link. The route never reports success without
  a completed generation bump. Reversing the order would let a losing replay
  change the password, so this fail-closed partial state is retained. A
  post-consume `NoSuchUserError` is not temporary: it maps to the same 410
  unavailable page as an earlier removed-member check. Only credential-store
  infrastructure failures map to 503.

**Vocabulary lock-ins.** `/auth/reset-password`; “Reset link unavailable”;
`passwordReset=1`; reset never creates a session.

**First implementation chunk.** Add
`test/webapp/password-reset.doctest.md` first. Cover public headers, pinned
identity, wrong content type, malformed and mismatched form retry, wrong-kind
token, success, old-password rejection, new-password login, revocation of every
old cookie, absence of a reset-created cookie, replay, multiple-link
invalidation, removed member, removed box access, role/box mismatch, token
throttling, scrypt capacity, corrupt stores, and the consumed-token plus
credential-write-failure partial state. Include a member removed after consume
and assert that it returns 410, while an unavailable auth store returns 503.
Then implement the route and page.

### Track D — reset action in Allowed Users

**What.** Add an eligible per-member reset action to the existing Allowed Users
rows. Display and copy the short-lived link in that section.

**Why this needs to change.** The owner currently needs shell access. A separate
member directory would duplicate the existing per-box list and make access
management and account recovery disagree about who belongs to the box.

**Direction.**

- Keep `AllowedEmailsSection` as the single box user list. For each email in
  `passwordResetEligibleEmails`, render an `InlineAction` or small secondary
  `Button` labeled “Reset password.” Do not render it for the owner or an
  allowed email without a local member account.
- Migrate this component's existing shell, owner row, allowed-user rows, remove
  action, loading state, warnings, and errors from raw Tailwind markup to
  `Card`, `Stack`, `Row`, `Text`, `Button`, and `InlineAction`. Preserve all
  existing add/remove behavior. This contained migration avoids two UI idioms
  in one row and gives the section the dark-mode behavior the primitives own.
- The action calls `admin.createPasswordReset({ email })`. While pending,
  disable reset and remove actions for that row to avoid conflicting owner
  operations. Other rows remain usable.
- On success, show the full URL, exact local expiry time, a “Copy link” action,
  and text that the link is single-use, replaces any previous link for that
  account, and must be sent through a trusted channel.
- Construct the full URL with
  `window.location.origin + withBase(result.resetPath)`. Hold it only in React
  state. Do not put it in console logs, analytics, browser storage, or the page
  URL.
- Keep only one displayed reset result at a time. Minting for another row
  replaces the displayed result. Removing the corresponding allowed email
  clears its displayed result.
- Show mutation failures inline in the same section. If eligibility changed
  since the query, refresh `admin.boxConfig` and remove the stale action.
- Preserve keyboard activation, visible focus, non-color status, responsive
  row wrapping, and dark mode. Reuse `Button`, `InlineAction`, `Card`, `Stack`,
  `Row`, and `Text`; add no UI primitive.

**Vocabulary lock-ins.** The product action is “Reset password”; the generated
artifact is a “password reset link.”

**First implementation chunk.** Add the action and link state to
  `AllowedEmailsSection.tsx` after Tracks A-C pass. Run targeted frontend
  typecheck and lint. Then verify the Admin UI at desktop and 375x800,
  keyboard-only, dark mode, successful copy, stale eligibility, and mutation
  failure through a dedicated server process with an isolated `CB_AUTH_FILE`,
  isolated session secret, isolated test box, and unused port. Do not use the
  shared dev router for any capability mint or credential mutation.

### Track E — operator and security documentation

**What.** Document the new recovery lifecycle and its remaining trust limits.

**Why this needs to change.** Current security and deploy docs say password
reset does not exist and identify host CLI recovery as the only path.

**Direction.**

- Update `docs/todo-security.md` with the operator-minted reset capability,
  trusted-channel requirement, one-live-link rule, session revocation, ordinary
  login after reset, and the non-atomic consume/write partial state.
- Replace the “No MFA / password reset” residual with the narrower remaining
  gaps: no email self-service, no independent recovery notification, no MFA,
  and host CLI recovery for the owner.
- Update `deploy/README.md`, `docs/docker-install.md`, and
  `docs/developer-install.md` where they describe invite/password lifecycle.
- State that the owner must verify the member's recovery request out of band.
  The application does not authenticate that conversation.
- On completion, move the issue to `issues/closed/features/` and move this plan
  to `docs/implemented-plans/` through the finish workflow.

**Vocabulary lock-ins.** “Operator-driven member password reset”; “trusted
channel”; “independent recovery notification.”

**First implementation chunk.** Update reference docs after behavior and route
names are final. Run `pnpm doc-check` and the normal docs commit hooks.

## Could this be simpler?

The smallest plausible implementation is an owner-only text field that accepts
an email and calls a new reset-token store copied from the invite store. The
public route could then call `setPassword` and set a session cookie.

That version is smaller in diff size but fails specific cases:

- A free-form email field recreates a second user-selection surface and can
  target an owner, Google-only identity, or account outside the current box.
  The existing Allowed Users row already supplies the correct box-scoped
  identity. Reusing it follows principle 8.
- A copied reset store duplicates security-sensitive lock, corruption, TTL,
  hash, and capacity behavior. A typed sibling in one capability store makes
  wrong-purpose use unrepresentable and follows principles 1 and 8.
- Setting a session cookie after reset merges recovery proof with ordinary
  authentication. OWASP recommends ordinary login after reset. Redirecting to
  login keeps the session boundary smaller and follows principles 6 and 8.
- Leaving older reset links live lets an earlier leaked link replace the new
  password after recovery. One live link per account and all-link invalidation
  buy a concrete replay guarantee at small store complexity, per principles 1
  and 4.

The plan does not add email delivery, a reset-request form, a general account
directory, token management UI, or a cross-file transaction coordinator. The
remaining complexity is the minimum needed for a typed credential capability,
box-scoped owner action, safe public redemption, and visible recovery outcome.

## Subplans

None. The store variant, owner mutation, public redemption route, Allowed Users
action, and docs are one credential lifecycle. Their decisions are settled and
their implementation order is direct.

## Failure modes

There are no unresolved critical gaps. The capability-consumed/credential-write
failure is non-atomic, but it is tested, handled, visible, and safe: the password
does not change, the link dies, and the owner creates another link.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Existing v1 invite store is read after upgrade | Track A migration doctest | Normalize v1 invites to typed v2 records; next mutation writes v2 | Clear; existing links remain valid |
| Old process reads a v2 capability store | Track A incompatible-version doctest | Existing typed store error; refuse invite/reset operations | Clear 503 and server error; no record loss |
| Reset token is persisted in plaintext | Track A hash-at-rest assertion | Store only SHA-256 hash | Test fails; never accepted |
| Store is corrupt, symlinked, unreadable, or wrong mode | Track A and C doctests | Typed store error; tighten mode; refuse unsafe/unparseable store | Clear server log and generic 503 |
| Live capability cap is full | Track A/B doctests | Refuse mint; do not evict unrelated live links | Clear owner error |
| Two reset tokens are minted for one account | Track A contention doctest | Mint under lock; newest replaces every older live reset for the account | Clear; one inspectable token remains |
| Two requests redeem the same token | Track A/C contention doctest | Consume under lock; exactly one obtains metadata | Losing request gets generic 410 |
| An older distinct reset link is used after a newer link or completed reset | Track A/C doctest | Mint and consume purge all reset records for the canonical account | Generic 410 |
| Invite token is submitted to reset route or reset token to invite route | Track A/C doctest | Purpose-specific inspect and consume return `invalid-or-gone` | Generic dead-link response |
| Owner, Google-only identity, nonexistent user, or other-box member is targeted | Track B doctest | Owner mutation requires allowed local `member` in `ctx.boxRoot` | Clear owner error; no token minted |
| Allowed/member state changes after Admin query | Track B/D test plus browser check | Mutation revalidates; UI refreshes eligibility on conflict | Clear inline error |
| Target box disappears after mint | Track C doctest | Resolve stored root before hash/consume | Generic 410; token may remain until expiry |
| Member is removed, role changes, or access is revoked after mint | Track C doctest | Recheck before render and again after hash; refuse redemption | Generic 410; no password change |
| Reset POST is sprayed with guessed tokens | Track C throttle doctest | IP plus token-hash throttle; 256-bit random token | Generic 410/429; bounded warning category |
| Dead reset GET is refreshed repeatedly before login | Track C route doctest | GET does not record into the shared login throttle | Login remains available; GET stays generic 410 |
| Attacker submits victim email to exhaust victim throttle | Track C doctest | Form accepts no email; email bucket starts only after valid token inspection | Cannot target a known account without its bearer |
| Password is too short, oversized, malformed, or mismatched | Track C doctest | Zod/body bounds; preserve token for correctable input | Generic in-form error |
| Global scrypt capacity is full | Track C doctest | Return retry before hashing or consuming | Clear retryable form state |
| Eligibility changes while password hashes | Track C race-shaped doctest | Recheck member, role, and box access after hash | Generic 410; token not consumed |
| Token is consumed, then auth store is unavailable | Track C injected-failure doctest | Log context, return generic 503, mint a new link | Clear; password unchanged and token dead |
| Member is removed after consume but before credential write | Track C race-shaped doctest | Map `NoSuchUserError` to unavailable 410 | Clear; token dead and retry cannot claim success |
| Password write succeeds, then client disconnects before redirect | Track C success test plus behavior documentation | Generation bump is committed; member can use new password at ordinary login | Clear on retry: token dead, new password valid |
| Old browser sessions survive reset | Track C session doctest | Password write increments `gen`; no reset-created cookie | Test fails if any old cookie authenticates |
| Reset link leaks through cache or referrer | Track C header doctest | `no-store`, `no-referrer`, 15-minute TTL, one live link, single use | Mitigated; proxy/browser history remains accepted exposure |
| Token appears in Admin logs or storage | Static review plus browser log check | React memory only; no token logging, analytics, or durable client storage | Review-blocking finding |
| Clipboard write fails | Browser check | Keep URL visible/selectable and show copy failure without discarding it | Clear inline error |
| Independent recovery notification cannot be sent | Documentation review | Explicit residual limitation; owner and member coordinate through trusted channel | Clear in security docs, not silent |

## Agent-flow / user-flow edge cases

The template's card-centric cases map to this human credential flow as follows:

- **Wrong capability / wrong field — ADDRESSED.** Track A uses a discriminated
  capability kind and purpose-specific APIs. Track C accepts no email, name,
  role, or box from the public form.
- **Stale ref — ADDRESSED.** Track B revalidates the Admin row at mint. Track C
  rechecks the member, role, registered box, and box access at redemption.
- **Two agents or operators touching the same account — ADDRESSED.** Track A
  serializes mint/consume and keeps one live reset per canonical account. Track
  C's auth-file mutation uses the existing lock and generation bump.
- **Hand-edit drift — ADDRESSED.** Track A validates both v1 and v2 stores with
  Zod and fails closed for every other shape. The local-user and box-config
  boundaries already validate their files.
- **Fabricated free-form value — ADDRESSED.** The owner selects an existing
  Allowed Users row. The public form supplies only the new password and its
  confirmation. No agent invents an account identifier.
- **Validation error UX — ADDRESSED.** Owner errors are precise because the
  owner already sees the identity. Holder errors are generic for dead links and
  correctable for password form mistakes. Each error is inline and keyboard
  reachable.
- **Partial migration / transition state — ADDRESSED.** Track A reads v1 and v2,
  writes only v2, and makes old processes fail closed on v2. The rollback
  consequence is explicit in Track A and Rollout shape.
- **Signed in as another user — ADDRESSED.** Reset does not trust or replace the
  current cookie. It changes only the capability-pinned member and redirects to
  ordinary login. The next successful login replaces the browser cookie.
- **Member removed while holding a reset link — ADDRESSED.** Track C returns the
  same unavailable state as a dead token and does not restore box access.
- **Operator creates a replacement link — ADDRESSED.** Track A invalidates every
  older reset link for that account at mint and again at consume.

## NOT in scope

- **Email or SMS self-service reset.** Callback Box has no verified outbound
  member channel. The owner hands over the link through a trusted channel.
- **A “forgot password” email-entry page.** There is no delivery channel, and
  adding the form would add enumeration and flood controls without completing
  recovery.
- **Independent recovery notification.** NIST recommends it, but there is no
  verified notification address. This remains a documented security limitation.
- **Owner web recovery.** The action is member-only. The owner controls the host
  and retains `cb auth set-password` as the recovery path.
- **Adding a password to a Google-only identity.** An allowed email without a
  local member record has no reset action. Password bootstrap is a separate
  proof and account-linking design.
- **Changing email, name, role, or box access.** Reset changes only the password
  hash and generation. Existing Admin/CLI surfaces keep their current duties.
- **A separate user directory.** Allowed Users remains the box's user list.
- **Reset-token listing, manual revocation, custom TTL, resend, or audit history.**
  Replacement minting invalidates older links. The fixed 15-minute TTL bounds
  forgotten links.
- **A new CLI reset-link command.** Admin is the only minting surface. Host-side
  `cb auth set-password` remains the emergency CLI operation.
- **A general cross-file transaction coordinator.** The one consume/write
  partial failure is fail-closed, visible, and recoverable with a fresh link.
- **New password policy, compromised-password blocklist, MFA, or passkeys.** Use
  the existing eight-to-1024-character policy. Broader credential policy is a
  separate security decision.
- **iOS changes.** Native iOS uses pairing/mobile credentials, not local-password
  account recovery. The server-rendered reset and Admin web surfaces do not
  change the mobile bridge contract.

## Open design questions

None. The owner-mediated product direction, sibling capability, Allowed Users
location, member-only scope, fixed TTL, one-live-link rule, session revocation,
and ordinary login after reset are settled in this plan.

## Knowledge audits

Skip. This feature adds human-facing Admin and authentication operations. It
does not add a card shape, box authoring rule, CLI vocabulary, or fact a box
agent must recall. Security behavior is covered by deterministic doctests and
operator documentation instead.

## Implementation order

1. **Capability store.** Write the failing v1/v2, kind-isolation, replacement,
   consume, corruption, capacity, and contention doctests. Rename/generalize the
   store and keep invite behavior green.
2. **Owner API.** Write the failing Admin eligibility and minting doctests. Add
   `passwordResetEligibleEmails` and `admin.createPasswordReset`.
3. **Credential mutation seam.** Add focused local-user doctests for
   `setPasswordWithPasswordHash`, role/name preservation, generation bump, and
   missing-user failure. Make `setPassword` delegate to it.
4. **Public route.** Write the full reset-route doctest. Add the scriptless page,
   throttle order, eligibility rechecks, consume/write ordering, login success
   state, and generic failures.
5. **Allowed Users UI.** Add the per-row action, URL/copy/expiry state, stale
   eligibility recovery, and accessibility behavior. Perform isolated browser
   checks.
6. **Docs and review.** Update security and operator references. Run focused and
   full checks. Run a cross-model diff review before finish.

Each item is a commit boundary, not a ship boundary. The complete plan ships as
one unit only after explicit boxholder instruction.

## Rollout shape

- **Focused tests.** Run the renamed auth-capability doctest, Admin doctest,
  local-users doctest, password-reset doctest, invite-accept doctest,
  password-change doctest, password-login doctest, hub auth doctests, and any
  login-page doctest changed by the success state. Run each changed file alone
  before the auth set.
- **Contention tests.** Run concurrent same-token consume, concurrent distinct
  reset redemption, and concurrent replacement minting. Exactly one credential
  reset may win.
- **Static checks.** Run callback-box typecheck and lint, then the repository
  checks required by the root hooks. Do not weaken lint rules.
- **Full tests.** Run the callback-box full test suite. Report unrelated flakes
  separately; do not call the suite green if it is not green.
- **Manual browser verification.** Use the isolated worktree and box. Verify the
  Allowed Users action, owner/Google-only ineligibility, link copy, replacement,
  reset form, typo retry, normal login, old-session revocation in another
  browser, replay, responsive layout, keyboard flow, dark mode, and client debug
  logs. Launch a dedicated server on an unused port with an isolated
  `CB_AUTH_FILE`, isolated session secret, and the worktree's isolated test box.
  Do not use the shared dev router: it inherits the machine-global auth path,
  and the first capability mutation would migrate the shared sibling store to
  v2 and make invite operations fail closed in older checkouts. Never use or
  mutate real credentials or the machine-global capability store.
- **Store migration.** The first capability-store mutation upgrades v1 to v2
  under the existing lock. Reads do not rewrite. Existing v1 invites remain
  usable. Deployment updates and restarts the root auth surface and box children
  as one unit. A mixed old process fails closed on v2.
- **Rollback.** Source rollback does not understand v2 and therefore makes
  invite/reset operations unavailable rather than deleting capabilities. Login,
  existing accounts, passwords, and sessions continue to use the unchanged auth
  file. Restore the new release to recover capability operations; do not delete
  or hand-edit the store automatically. Live links expire after 15 minutes.
- **Documentation.** Update security and install/deploy references in the same
  unit. No knowledge audit lands.
- **Review.** Run cross-model review on the plan before implementation and on the
  final diff before finish. Surface and reconcile findings.
- **Ship boundary.** Move the issue and plan to their closed/implemented
  locations only after implementation evidence is complete. Merge/deploy is a
  separate explicit instruction.
