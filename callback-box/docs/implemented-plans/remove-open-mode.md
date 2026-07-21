# Remove the unauthenticated-mode operator path

**Status:** implemented 2026-07 — `CB_ALLOW_UNAUTHENTICATED` removed; auth is
structurally always-on; the only unauthenticated servers are test-constructed
via the in-process `openAccess` seam, which no CLI exposes.

Delete `CB_ALLOW_UNAUTHENTICATED` — the last way an operator can run a box
without authentication. Auth becomes structurally always-on: the only
unauthenticated servers that can exist are test-constructed ones, via an
in-process option no CLI exposes. Boxholder directive (2026-07-21): "I'd like
to remove that path entirely then, unless it's key to testing" — it is key to
testing only through the env var, which is exactly the operator surface being
removed.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — fail-closed; make invalid
  states unrepresentable (an env var is an operator surface; a constructor
  option is not).
- Precedent: `docs/implemented-plans/local-password-auth.md` (auth default-on;
  this removes its deliberate escape hatch) and
  `docs/implemented-plans/tailscale-expose-and-protect.md` (whose
  exposure-vs-open-mode startup guard becomes vestigial and is removed as
  strictly-stronger).
- Boxholder memory: bias toward strict.

## What already exists

- `callback-box/src/webapp/auth.ts:103` `openMode()` reads the env var;
  `:117` `authRequired()`; `:135` `enforceOpenModeAtListen` (loopback gate +
  banner + Tailscale exposure guard). All deleted or rewritten.
- `callback-box/test/helpers/test-server.ts:39` sets
  `CB_ALLOW_UNAUTHENTICATED ??= "1"` at module scope — the test dependency.
  Replaced by an explicit option.
- `resolveRequestIdentity` (auth.ts) returns `source: "open"`;
  `server-box-scope.ts:107` honors it (skips box ACL); tRPC `context.ts`
  reads the env; hub (`hub-server.ts:238`, `box-picker.ts`) advertises
  auth-off to children only when `!authRequired()`. The "open" identity
  source and the hub header mechanics STAY (the test seam drives them); only
  the env-var trigger goes.
- `src/services/tailscale-exposure.ts` `assertPortNotExposedInOpenMode` +
  its `enforceOpenModeAtListen` call — deleted (guards a now-impossible
  state); the intent store itself stays (serve-lifecycle bookkeeping for
  `cb tailscale stop`/`status` drift).
- `src/services/tailscale-target.ts` / `tailscale-status-running.ts` —
  `{open:true}` refusal branches stay (defensive against older/foreign
  servers).
- Docs mentioning the opt-out: `docs/docker-install.md`,
  `docs/agent-install.md`, implemented-plans (historical — leave those).

## Prior art (external)

None needed — purely internal surface removal. (The pattern "test-only
capability via constructor injection instead of env" is the codebase's own
services convention, `src/services/CLAUDE.md`.)

## Direction

One track. New `openAccess?: boolean` (default false) on webapp server
construction (`createServer` options) and hub server construction, decorated
onto the fastify instance; `authRequired`/`resolveRequestIdentity`/tRPC
context consult the instance flag, never the environment. `cb serve`/`cb hub`
never pass it — no flag, no env, no config field. `makeTestServer` passes
`openAccess: true` by default (preserving current test ergonomics); auth
doctests that previously `delete process.env.CB_ALLOW_UNAUTHENTICATED` now
construct with `openAccess: false` (or omit it where they build servers
directly). Delete `openMode`, `InvalidOpenModeError`, `OpenModeBindError`,
`enforceOpenModeAtListen`, the startup banner, and
`assertPortNotExposedInOpenMode` + its auth-required doctest section. Docs
drop the opt-out.

**First implementation chunk** (the whole plan is one chunk): the refactor +
full test migration, green suite.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A stale `CB_ALLOW_UNAUTHENTICATED` in someone's env silently ignored (expected auth-off, got auth) | n/a | none, deliberately — single-operator install, boxholder waived the notice (2026-07-21); the var is simply unread | accepted |
| A test that relied on module-scope env open-mode now runs auth-on and 401s | covered by suite run | migrated to the option | clear |
| Hub child receives auth-off header from a non-test hub | impossible by construction (no CLI path sets openAccess) | n/a | n/a |
| tailscale setup probes an older server still exposing `{open:true}` | exists (kept) | refusal branch kept | clear |

**Critical gap:** none — every removal makes a formerly-guarded state
unrepresentable.

## Agent-flow / user-flow edge cases

N/A across the board: no card vocabulary, no agent-facing convention. The one
operator-facing edge (stale env var) is in the failure table.

## NOT in scope

- Removing the `"open"` identity source or hub auth-off header mechanics —
  the test seam needs them; they are unreachable in production.
- Reworking route doctests to authenticate for real — enormous churn for no
  production-behavior gain; the seam preserves test ergonomics.
- `local-users.ts` fsync gap, `file-lock.ts` try-acquire semantics —
  pre-existing, tracked separately.

## Open design questions

None.

## Knowledge audits

Skip: removes an operator surface; nothing new for box agents to recall.
Docs updated in the same change.

## Implementation order / rollout

Single chunk on this worktree branch; full suite + typecheck + lint green;
Codex diff review (auth surface) before merge. No data migration; a stale
env var is simply unread (accepted, see failure table).
