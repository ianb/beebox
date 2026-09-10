---
title: "Agent browsing as the owner: a box opts in, the browse key becomes a person"
status: implemented
workstream: tour-health
issues:
  - ../../../issues/closed/bugs/2026-08-26-chat-load-logs-resumable-capture-list-error.md
---
# Agent browsing as the owner: a box opts in, the browse key becomes a person

An agent driving a real browser in local dev (`bin/browse`, tours, the user-story
browser pass, journey walks) authenticates with the machine-wide browse key,
which clears the auth wall but is deliberately nobody: no `user`, never the
owner. Every owner-gated surface — capture, device pairing, most of Settings,
every `ownerProcedure`, and every chat send's attribution — is therefore
unreachable or wrong for exactly the sessions that exist to test the app. This
plan lets a **box** declare that agent browsing acts as its owner, so a box
built for that use (`test1` and its clones) is fully testable, and a box that
never said so (`personal-test`, any real box) keeps today's fence.

**Issues addressed:**
`issues/bugs/2026-08-26-chat-load-logs-resumable-capture-list-error.md` (the
401 that put a red error badge on every capture open under the key). Related,
not closed by this: `issues/decisions/2026-07-31-three-layer-auth-verification-cost.md`
(this plan adds a rung to one layer only — the box's — and notes why the other
two are untouched).

## Stated preferences this plan trades against

- `docs/engineering-principles.md` #8 *One way to do each thing* — identity is
  resolved in one function and every box-scoped reader calls it; the current
  `browseOk`/`getSessionUser ?? resolveMobileSender` side-paths are what this
  replaces.
- #2 *Exhaustiveness* — a new `source` member forces every `switch` on it to
  say what it does with browse-owner identity.
- #3 *Validate at boundaries* — `config/box.json` is disk; the new field is
  parsed, not trusted.
- #6 *Right-sized defensiveness* — the fence is the box's own declaration, not
  a second credential or a checkout heuristic.
- #10 *Testability is architectural* — the decision "what does this credential
  mean for this box" becomes a pure-ish function with a `makeTmpBox` doctest.
- `beebox/CLAUDE.md` "Never change credentials to unblock yourself":
  the plan adds no credential and mints no session.
- Precedent: `core/browse-key.ts` (the last credential added; its header
  explains why the agent token must not be widened — this plan keeps that).

## What already exists

- `core/browse-key.ts:86` `verifyBrowseKey(headers)` — the credential; unchanged.
- `webapp/auth.ts:413` `resolveRequestIdentity(request, {openAccess})` — the
  identity resolver: hub header → cookie → open → null. Sync, box-unaware.
  **Reused**, wrapped by a box-aware resolver (Track 1).
- `webapp/server-box-scope.ts:99` preHandler: `if (verifyBrowseKey(...)) return;`
  and `:220-250` tRPC context: *"`browseOk` grants `authed`, never
  `user`/`isOwner`."* — the special case this plan replaces.
- `webapp/capture-request-owner.ts:16` `resolveCaptureRequestOwner` — the
  401. Reused; it calls the new resolver instead of the old one.
- `webapp/routes/chat-send-routes.ts:92` `getSessionUser(request) ??
  resolveMobileSender(...)` — a third identity path; folded into the resolver.
- `core/box/config.ts:15-65` `BoxConfig` + `loadBoxConfig(boxRoot)` (mtime
  cached, `{}` on missing) — gets the new field. `webapp/box-config-write.ts`
  writes the file for Settings; not needed here (the field is hand-set).
- `webapp/scan-auth.ts:58` and `webapp/trpc/trpc.ts:26-54`
  (`authedProcedure` / `ownerProcedure` / `authenticatedOwnerProcedure`) —
  gates that read the context; only the context changes.
- `user-stories/journeys/prepare.ts:375-401` — the capture-blind warning and
  the `bin/browse auth save …` advice; **replaced** (Track 3).
- `.claude/skills/browse/SKILL.md:181-205` "The key is not the box owner" —
  rewritten (Track 3).
- `deploy/prod-curl` — mints an owner `bbx_session`; the precedent considered and
  not taken (see *Could this be simpler?*).
- Tests: `test/core/browse-key.doctest.md` (the credential);
  `test/webapp/trpc-procedures.doctest.md` (the gates, but no browse-key case);
  nothing covers `resolveCaptureRequestOwner`.

## Prior art (external)

- Django `Client.force_login(user)` — a test client that becomes a user without
  a password; the same shape as this plan, scoped to tests rather than to a box.
  https://docs.djangoproject.com/en/stable/topics/testing/tools/#django.test.Client.force_login
- Playwright's `storageState` — reuse a real login's cookies across automated
  runs; that is what `bin/browse auth save/login` does today, and it needs the
  password once. https://playwright.dev/docs/auth
- No prior art found for "the *target* declares that a machine credential acts
  as a person" — per-resource opt-in is unusual because most systems have one
  deployment, not many boxes behind one key.

## Tracks / scope

### Track 1 — a box-aware identity resolver, and the field it reads

**What.** `BoxConfig` gains `agentBrowsing?: "owner"`. A new
`resolveBoxIdentity({ boxRoot, request, openAccess })` in
`webapp/box-identity.ts` returns `RequestIdentity` with one more rung after
`resolveRequestIdentity` yields no email: *browse key present AND the box's
config says `agentBrowsing: "owner"` AND a local owner exists* →
`{ email: owner, name: owner's local name ?? email, source: "browse" }`.
`RequestIdentity.source` gains `"browse"`.

**Why.** The key's meaning is decided in three places today (preHandler,
tRPC context, and by omission in capture/chat-send), and none of them can
say "for this box, the owner". A box-aware resolver is the only place that
knows both facts.

**Direction.**

```ts
// core/box/config.ts
/**
 * Agent browsing acts as the box owner. Set on boxes BUILT for agent-driven
 * testing (test1 and its clones); absent, the browse key clears the wall and
 * is nobody. A box a person actually uses must not set this.
 */
agentBrowsing?: "owner";

// webapp/box-identity.ts
export async function resolveBoxIdentity(opts: {
  boxRoot: string; request: IdentityRequest; openAccess: boolean;
}): Promise<RequestIdentity>;
```

Rules inside it, in order: a real identity (`hub`/`cookie`) wins; `open` wins;
`unavailable` is returned as-is (the *rung* never masks a corrupt store); then
the browse rung; else null. Note what this does not change: the wall bypass at
`server-box-scope.ts:99` and the tRPC context's `browseOk` term already admit
the key without consulting the credential store, exactly as the agent bearer
and mobile auth are admitted — credentials the store does not back. That is
pre-existing and stays; a key-only request never reaches cookie verification,
so `unavailable` cannot arise on that path at all.
Parsing: `agentBrowsing` is read through a narrow check (`=== "owner"`); any
other value is treated as absent and warned once per box (principle #4).

Callers switched to it: `server-box-scope.ts` preHandler and tRPC context;
`capture-request-owner.ts`; `routes/chat-send-routes.ts:92`. NOT switched:
`routes/admin.ts:64` (OAuth completion binding) — completing a Google grant is
a real-session surface like password change, and stays on
`resolveRequestIdentity`. Each `switch (identity.source)`
gains `case "browse"` beside `"cookie"`. The tRPC context keeps `browseOk` in `authed` — it is what still admits the
key on a box that did *not* opt in — and keeps
`isAuthenticatedOwner: user !== null && source !== "browse" && email === owner`
— the machine-level secret store is shared across every box on the machine, so
one test box's opt-in must not unlock it (`docs/plans/secret-custody.md`).
*Amended 2026-09-10:* that exclusion now applies to the **shared** store only.
The dev router gives every worktree's box its own store
(`~/.cache/beebox/secrets/<worktree>.json`), and on an isolated store the
browse-owner reaches the Secrets panel like any other owner surface — there is
nothing of the boxholder's there, and an owner surface an agent could never
drive was a testing gap the boxholder called a bug.

`auth-password-change.ts:34` (`source === "cookie"` only) is unchanged.

**Vocabulary lock-ins.** `agentBrowsing: "owner"` (string literal, so a later
value can mean something else); `source: "browse"`.

**First chunk.** The field, the resolver, its doctest; no caller switched yet.

### Track 2 — switch the callers, delete the special cases

**What.** The four call sites above call `resolveBoxIdentity`; the tRPC
context's `browseOk` no longer decides identity (only bare `authed` on a box
without the field), and the chat-send sender fallback goes. `server-box-scope.ts:99`'s bare `verifyBrowseKey → return` stays as the
wall bypass for a box that did *not* opt in (the key still loads the app there).

**Why.** Otherwise the resolver is a sixth path, not the one path.

**First chunk.** The preHandler + tRPC context, with the trpc-procedures
doctest gaining the browse-key cases (`authed` + `isOwner` true, `isAuthenticatedOwner`
false on an opted-in box; `authed` only on a box that did not opt in).

### Track 3 — replace the ad hoc workarounds

**What.**
- `user-stories/journeys/prepare.ts`: delete the `bin/browse auth list` probe,
  the `captureBlind` flag and its `before.json` field; instead, when the
  journey's box is built, **write `agentBrowsing: "owner"` into its
  `config/box.json`** (a journey box is by definition built for this), and
  fail loudly if the file can't be written.
- `~/src/boxes/test1/content/config/box.json` gets the field (a box edit, not a
  repo edit — done by hand with the boxholder; worktree clones inherit it).
- `.claude/skills/browse/SKILL.md` "The key is not the box owner" → "The key
  is the owner only on a box that says so": what the field is, that clones of
  test1 carry it, and that `bin/browse auth save/login` remains the route for
  a box that must not be marked.
- `user-stories/README.md:257-259` lesson → resolved, pointing here.
- `docs/security-report.md:127` browse-key row: scope now "full app access;
  the owner on boxes with `agentBrowsing: owner`".
- `core/browse-key.ts` header: one paragraph on the box-side opt-in.
- Tours: none required — the tour-health worktree's box is a test1 clone.

**Why.** Each of these encodes the limitation as a fact; leaving them makes
the plan's outcome invisible (`CLAUDE.md`: infrastructure isn't done until
discoverable).

### Track 4 — revisit the tours with an owner session

**What.** Re-run `bin/tour --all`; the capture-page error badge should be
gone; `nav-pages` on `/settings` and `/admin` now walks owner content — extend
their skeleton rows; `capture` may assert the resumable prompt path. Close
the capture-list issue. Fold in the small fix from the issue regardless:
`capture-api.ts:157` throws `ResumableCaptureListError` with the status.

## Could this be simpler?

- **Mint an owner `bbx_session` in `bin/browse` (the `prod-curl` shape).** One
  script, no server change. Fails on the boxholder's stated fence: the session
  is machine-wide and would make *every* local box — `personal-test` included
  — writable by any agent-driven browser, and it also satisfies the router's
  owner-only control routes. The fuller plan buys a per-box fence and leaves
  the router untouched (#6: defend at the boundary that has the fact).
- **Checkout-based: owner in worktrees, key in main.** Simpler than a field,
  but the fence would be "which directory", and the main checkout serves test
  boxes too. The box knowing is the primitive (#8, minimal concepts).
- **Just make the browse key the owner everywhere.** The cruder version; it is
  exactly what `browse-key.ts` refused for the agent token, for the same
  reason: a machine-wide credential silently becomes a person on boxes nobody
  marked.

The complexity the plan keeps is one field and one resolver. Everything else
is deletion.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `agentBrowsing` set on a real box by mistake | no | doc + field comment only | silent — accepted risk: the same person who sets it holds the key; the field name says what it does |
| Key present, box opted in, but no local owner (`getOwnerEmail()` null) | plan: doctest | resolver returns the pre-rung identity (unauthenticated) | clear: 401, plus a warn naming the box |
| `agentBrowsing: "yes"` (bad value) | plan: doctest | treated as absent, warned once | clear |
| Auth store `unavailable` while key present | plan: doctest | rung never runs; 503 stands | clear |
| A caller keeps using `resolveRequestIdentity` for a box-scoped decision | no | `switch` exhaustiveness catches only callers that switch on `source` | silent for `.email` readers — mitigated by Track 2 grepping every reader (the inventory above lists them) |
| Secrets panel reachable through browse-owner | doctest on `isAuthenticatedOwner`, both stores | excluded by source on the shared store; allowed on an isolated one (2026-09-10) | clear |
| Chat send attributed to the owner on a box that did NOT opt in | plan: doctest | resolver yields no user there (as today) | clear |

No critical gap: the one silent row is a deliberate human act on their own box.

## Agent-flow / user-flow edge cases

- Wrong field — ADDRESSED: one literal value; anything else warns (Track 1).
- Stale ref — n/a.
- Two agents touching the same card — n/a.
- Hand-edit drift — ADDRESSED: `"owner"` only; the loader's existing
  `{}`-on-corrupt behaviour means a broken `box.json` disables the rung, never
  enables it.
- Fabricated value — n/a.
- Validation error UX — ADDRESSED: the warn names the box and the field.
- Partial migration — ADDRESSED: no data migration; a box without the field is
  today's behaviour; Track 2 lands as one piece so no caller is half-switched.

## NOT in scope

- Router and hub gates — the key's reach there is unchanged; this plan is about
  what the key *means* inside a box. (The three-layer decision issue stays open.)
- The agent bearer acting as owner — same "machine credential" comment, but
  its use is subprocesses calling their own box, which have no UI to gate;
  revisit if a scheduled script ever needs an owner-only procedure.
- A Settings-page indicator that a box is agent-browsable — useful, but UI
  work for a dev-only flag; file if wanted after living with it.
- `openAccess` — test-only, stays as is.
- Auto-setting the field in `bbx init` templates or worktree box cloning — the
  clone inherits it from test1; no mechanism needed.

## Open design questions

- none. (`auth-password-change` and the OAuth completion in `routes/admin.ts`
  stay real-session-only; decided during review.)

## Knowledge audits

Skip: box agents never see this field; it is read by the web server only.

## What will hold this after it ships

- `resolveBoxIdentity` — filesystem-tier doctest (`makeTmpBox` writes
  `config/box.json`; headers are a plain object): the seven rows above.
- tRPC context — `test/webapp/trpc-procedures.doctest.md` gains the browse
  cases.
- Capture — a route doctest (`makeTestServer({openAccess:false})`, key in env,
  opted-in box): `GET /api/capture/sessions/resumable` → 200 with the key,
  401 without the field.
- Tours (Track 4) show the outcome in the running app but are not the anchor.

## Implementation order

1. Track 1 (field + resolver + doctest).
2. Track 2 (callers; trpc + capture doctests).
3. Track 3 (prepare.ts, docs, skill, test1's box.json by hand).
4. Track 4 (tours re-run, capture-api status, close the issue).
Cross-model review after 2 and after 4.

## Rollout shape

Doctests first (Track 1's file is written with the resolver). No data
migration. Done when: the three doctests pass; `bin/tour --all` in this
worktree shows no capture error badge; `prepare.ts` no longer prints the
capture-blind line.
