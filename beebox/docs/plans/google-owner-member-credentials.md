---
title: "Google owners can administer local member credentials"
status: partial
workstream: unknown
issues: []
---
# Google owners can administer local member credentials

This plan lets an authenticated Google owner create invite and password-reset
links without first creating a local owner password on the host. Invite
acceptance can initialize a credential store that contains members and no local
owner.

**Issues addressed:**

- [`issues/bugs/2026-08-08-google-owner-invites-require-local-owner.md`](../../../issues/closed/bugs/2026-08-08-google-owner-invites-require-local-owner.md)

## Stated preferences this plan trades against

- This is a credential-path change. The boxholder requires a complete plan,
  boxholder approval, and a cross-model review before implementation.
- Engineering principle 1 requires types that make invalid states impossible.
  `docs/engineering-principles.md:14` says: *"Prefer types that make illegal
  states unrepresentable."* The credential schema will require at most one
  owner and will represent completed setup with an empty-store tombstone.
- Principle 3 requires disk data validation at one boundary.
  `docs/engineering-principles.md:39` says: *"Disk reads, LLM output, HTTP
  bodies, third-party API responses, config files, and env vars each get
  validated into typed data exactly once, at the boundary."* Both credential
  file versions will have Zod schemas.
- Principle 4 requires visible failures. `docs/engineering-principles.md:51`
  says: *"Degradation is allowed for failures that can genuinely happen;
  invisible degradation is not."* Corrupt stores and lock failures will retain
  their current typed, logged, generic user-facing failures.
- Principle 8 requires one credential mutation path.
  `docs/engineering-principles.md:97` says: *"Competing idioms are drift
  generators."* The existing locked store mutation will handle both owner-first
  and member-first initialization.
- Principle 10 treats test seams as architecture.
  `docs/engineering-principles.md:118` says: *"Seams — clock injection, fs/agent
  injection points, a pure decision core extracted from an IO shell — are built
  into production code deliberately."* Tests will isolate credentials with
  `BBX_AUTH_FILE` and exercise both legal file states.
- `beebox/CLAUDE.md` requires typecheck, lint, and tests before deployment.
  This plan extends the auth doctests before changing behavior.
- The shipped invite and reset capability design remains the precedent. This
  change does not change token entropy, hash-at-rest storage, TTL, single-use
  semantics, throttling, or generic public failures.

## What already exists

- `src/webapp/trpc/routers/admin-invites.ts:14`: *"createInvite:
  ownerProcedure"*. `src/webapp/trpc/trpc.ts:27-31` enforces `ctx.isOwner`, and
  `src/webapp/server-box-scope.ts:244` derives that from open mode or a concrete
  user whose email equals `getOwnerEmail()`. The plan reuses this authorization,
  retains the explicit non-null `ctx.user` gate for open mode, and removes only
  the local-owner identity precondition at lines 21-27.
- `src/webapp/trpc/routers/admin-password-resets.ts:16` also declares
  `createPasswordReset` on `ownerProcedure`. The plan reuses it and removes the
  same local-owner precondition at lines 22-29. Member and allowlist eligibility
  checks at lines 30-35 remain.
- `src/webapp/local-users.ts:63-70` validates version 1 and requires *"exactly
  one owner"*. The plan changes this to a store with at most one owner. An empty
  file is a durable marker that first-run setup has already completed.
  Old binaries still reject the new member-only state, but become compatible
  again if a local owner is later added.
- `src/webapp/local-users.ts:176-199` serializes credential read-modify-write
  operations with `withAuthFileLock`. The plan reuses this lock for every first
  account race.
- `src/webapp/local-users.ts:236-261` creates the first owner with an exclusive
  file write. The plan moves this operation under the shared lock so the CLI can
  add an owner to an existing member-only store without replacing it. The web
  setup route remains permanently closed after any account exists.
- `src/webapp/local-users.ts:275-292` hashes outside the lock and inserts a
  member inside it. The implementation keeps ordinary user insertion dependent
  on an owner and adds an explicit invited-member insertion path that can create
  a member-only file only while an owner still resolves.
- `src/webapp/routes/auth-invite.ts:169-190` performs throttling, hashes the new
  password, rechecks the identity, consumes the one-use capability, and then
  calls the hashed-password insertion path. The implementation reuses this
  route, rechecks owner resolution before token consumption, and uses the
  explicit invited-member insertion API.
- `src/webapp/trpc/routers/admin-user-details.ts:32-38` classifies the absence
  of a local owner as `not-initialized`. The plan changes the vocabulary so an
  absent local owner is a valid ready state; an unreadable store remains
  unavailable.
- `src/frontend/src/components/admin/AllowedEmailsSection.tsx:30-49` renders
  the SSH instruction and mismatch error. The plan removes these obsolete
  notices. Existing per-user account badges and reset actions remain.
- `test/webapp/trpc-admin-box-config.doctest.md:100-117` asserts the current
  failing precondition. `test/webapp/invite-accept.doctest.md:30-93` only tests
  acceptance after a local owner exists. These become the primary regression
  tests.

## Prior art (external)

No external search is needed. This change concerns an internal JSON credential
format and existing project authorization. It adds no library, protocol, or
third-party identity behavior. Standard OAuth account-linking patterns are not
the relevant boundary because the Google owner does not acquire or link a local
password.

## Tracks / scope

### Track 1: Represent a member-first credential store

**What:** Keep credential-file version 1 and relax its owner invariant. A file
must contain at least one user and may contain zero or one owner.

**Why this needs to change:** The current file schema rejects the desired state,
and the shared `insertUserWithPasswordHash` rejects an absent file unless the
caller passes `allowMemberOnlyStore`. Treating the member as a
fake owner would give the wrong role and authorization semantics.

**Direction:** Validate a user array with at most one owner.
`createFirstUser` will use `withAuthFileLock`: it creates an owner file when no
file exists, appends the owner when a member-only file has no owner, and reports
`UserExistsError` when an identity or owner already exists so the web setup and
CLI retain their current conflict contract. `addUser` continues to require an
existing owner. The explicit
`addInvitedMemberWithPasswordHash` path can create a member-only store only when
`BBX_OWNER_EMAIL` still configures the owner. Invite acceptance checks
`getOwnerEmail()` before capability consumption, so temporary configuration
loss returns a retryable generic 503 without burning the link.
`removeUser` will keep an empty version 1 file when it removes the last member.
The setup route and startup token logic will distinguish a missing store from
an initialized empty store, so member removal cannot reopen first-run setup. It
will continue to reject local-owner removal. `AuthFileLockError`
will become an `AuthStoreUnavailableError` so setup, invite, login, and Admin
surfaces preserve their fail-closed 503 contract under contention.

**Vocabulary lock-ins:** `version: 1` means an initialized local credential
store with at most one local owner. An empty user list is the durable setup
tombstone. A "local owner" is optional and is separate from the configured box
owner.

**First implementation chunk:** Add failing local-user doctests for a
member-only file, member-first initialization, last-member removal,
owner-after-member CLI initialization, duplicate rejection, lock-error typing,
and serialized owner/member races. Then change the schema and locked mutation
behavior.

### Track 2: Authorize web credential administration by box ownership

**What:** Let a signed-in box owner mint invite links without a local owner.
Let that owner mint reset links for eligible local members after they join.

**Why this needs to change:** The current procedures perform the correct
`ownerProcedure` authorization and then add an unrelated requirement for a
matching local-password account. Hosted Google owners cannot meet that
requirement through the web UI.

**Direction:** Remove `getLocalOwnerEmail` checks from both admin procedures.
Keep the explicit `ctx.user` check as load-bearing authorization: open mode can
satisfy `ownerProcedure` without a user, but it must not mint global credential
capabilities. The concrete identity also supplies `createdBy`. Keep invite
collision checks, reset member/allowlist
eligibility, capability capacity limits, generic store failures, and all
existing token properties.

**Vocabulary lock-ins:** The signed-in configured owner authorizes operator
actions. A local owner record is a login method, not a prerequisite for web
administration.

**First implementation chunk:** Change the admin doctest to mint an invite with
no credential file and continue to reject a caller without `ctx.user`. Add a
reset test that uses a member-only store. Then remove the two local-owner
checks.

### Track 3: Make Admin describe the valid state truthfully

**What:** Remove the host command from the invite form and stop presenting an
absent or different local owner as a blocked state.

**Why this needs to change:** After Tracks 1 and 2, those messages are false.
The user can create an invite in the browser, and the invited member initializes
their own password during acceptance.

**Direction:** Reduce `LocalPasswordStatus` to `ready | unavailable`, unless
implementation shows another active caller needs the finer states. Return
`ready` for an absent store, a member-only store, or a store whose optional
local owner differs from the signed-in configured owner. Keep `unavailable`
when the store cannot be read. Delete `LocalPasswordNotice` branches that tell
the operator to use SSH. Keep badges based on actual member records and Google
login availability.

**Vocabulary lock-ins:** An allowed address without a local record remains
"Google sign-in only" when Google login is configured and "Needs account
setup" otherwise. A member-only store is not "uninitialized."

**First implementation chunk:** Update the admin detail doctest expectations and
the component tests or doctest snapshots that cover the removed notice. Then
simplify the status type and rendering.

## Could this be simpler?

The simplest patch removes both local-owner preconditions and relaxes the
version 1 schema to allow zero owners. That is now the proposed design. A second
schema version would add a permanent duplicate representation without improving
fail-closed rollback: old binaries reject either ownerless shape. The remaining
complexity is necessary to serialize first-account races, preserve a durable
setup tombstone after last-member removal, and preserve setup error contracts.
This follows principles 3, 8,
and 9 without adding a second credential mechanism.

## Subplans (when a sub-question needs its own design step)

No subplan is needed. The disk transition, operator authorization, and UI copy
form one bounded credential workflow. All design choices are settled here.

## Failure modes (the load-bearing section)

There are no unresolved critical gaps.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A credential file has two owners | Extend `local-users.doctest.md` | Zod rejects the file as corrupt | Clear typed store failure |
| Invite acceptance is the first local account | Extend `invite-accept.doctest.md` | Locked insertion creates a member-only file | Clear success or existing generic 503 |
| Owner creation races first invite acceptance | Add direct store race tests for both winners | One cross-process lock serializes both mutations | Clear deterministic result |
| The sole member is removed | Add direct store, setup POST, and setup-token tests | Mutation writes an empty tombstone; setup remains permanently closed | Clear no-local-users state without reopening ownership claim |
| Credential lock contention reaches setup or invite | Add error inheritance and route-path coverage | Lock failure is an `AuthStoreUnavailableError`; setup now maps it to a logged, generic 503 | Clear and fail-closed |
| The configured owner disappears before invite acceptance | Extend `invite-accept.doctest.md` | Acceptance checks owner resolution before consuming the token | Generic 503; same link remains retryable |
| The invited email collides while password hashing runs | Existing invite acceptance checks remain | Route rechecks before consuming the capability | Generic retry/failure, no enumeration |
| A corrupt credential store exists before invite acceptance | Existing invite doctest covers it | Store fails closed; route logs and returns generic 503 | Clear to operator logs and generic to bearer |
| A Google owner mints without a concrete identity | Existing admin doctest covers null `ctx.user` | Procedure returns `UNAUTHORIZED` | Clear |
| A reset target is not an allowed local member | Existing reset doctests cover it | Procedure returns generic `NOT_FOUND` | Clear without enumeration detail |
| Deployment rolls back while the store is member-only | Add ownerless schema fixture coverage; no old-binary test is practical | Older code fails closed as corrupt instead of misreading credentials; adding a local owner makes the file old-reader-compatible again | Clear outage; documented rollback boundary |
| Box access grant fails after member creation | Existing invite partial-account doctest covers it | Route returns the explicit signed-out partial-account page | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED:** No agent-authored tag or free-form
  field is introduced. Zod validates the disk discriminator in Track 1.
- **Stale ref — ADDRESSED:** Invite and reset capabilities keep their existing
  TTL, single-use, and eligibility recheck behavior in Track 2.
- **Two agents touching the same card — ADDRESSED:** The analogous concurrent
  credential mutations use the existing cross-process lock and new race tests
  in Track 1.
- **Hand-edit drift — ADDRESSED:** Both file versions validate at load. Invalid
  owner counts fail closed in Track 1.
- **Fabricated free-form value — ADDRESSED:** `createdBy` comes from `ctx.user`,
  not from request input. Member email validation and pinning remain unchanged.
- **Validation error UX — ADDRESSED:** Public invite failures stay generic.
  Authenticated Admin errors stay specific where the operator can act on them.
- **Partial migration / transition state — ADDRESSED:** Existing owner-backed
  files stay valid without rewriting. New member-only and empty-tombstone files
  use the same version and the at-most-one-owner schema. The rollback
  boundary is explicit in Failure modes and Rollout shape.

## NOT in scope

- Do not give the Google owner a local password automatically. They did not
  choose one, and the server must not invent a credential.
- Do not add a web flow to create or convert a local owner account. Google
  owners do not need one for this job; the CLI remains available for operators
  who explicitly want a local owner login.
- Do not change invite or reset capability cryptography, TTL, storage, limits,
  or throttling. Those controls already solve the bearer-link security problem.
- Do not add email delivery. The operator continues to copy and send the link
  through a trusted channel.
- Do not merge allowed users and credential records into one store. An allowed
  address and an initialized local password remain different facts.
- Do not add a second schema version only to signal ownerless state. Old code
  cannot understand that state under either version. Rollback must move forward
  or add a valid local owner with the current CLI before using the old binary.

## Open design questions

None. The boxholder approved this plan after cross-model review before
implementation started.

## Knowledge audits

No knowledge audit is needed. This change adds no box-agent-facing concept,
card format, prompt convention, or tool behavior. It changes operator UI and
server credential storage only.

## Implementation order

1. Add the member-only, deletion, error-contract, and concurrency tests.
   Implement the relaxed schema and the single locked mutation path. Commit
   this as the credential-store transition.
2. Add the Google-owner invite and reset procedure tests. Remove the matching
   local-owner preconditions. Commit this as the authorization correction.
3. Update Admin status tests and UI copy. Remove the SSH instruction and false
   blocked states. Commit this as the operator UX correction.
4. Run the targeted auth doctests, full typecheck, lint, and full test suite.
   Run a cross-model diff review and resolve its concrete findings.

## Rollout shape

- Tests land before each production change. Required targeted tests are
  `test/webapp/local-users.doctest.md`,
  `test/webapp/invite-accept.doctest.md`,
  `test/webapp/trpc-admin-box-config.doctest.md`, and the password-reset
  doctests that cover owner minting and member mutation.
- The completed branch must pass beebox typecheck, lint, doctests, and the
  full test suite before merge. Browser verification must create an invite as a
  Google owner with no local auth file, accept it as a member, and create a
  reset link for that member.
- Existing owner-backed version 1 files need no migration or rewrite. The first
  member-first acceptance writes an ownerless version 1 file atomically. This is
  a validation-rule transition, not a data rewrite.
- Rolling back while an ownerless file exists will fail closed under the old
  exactly-one-owner validator. Operational rollback must move forward or use
  the current CLI to add the configured owner before starting the old binary.
  Once that owner exists, the unchanged version 1 shape is compatible again.
  This boundary must be called out in the implementation handoff.
- The plan ships as one unit after explicit boxholder approval and `$finish`.
