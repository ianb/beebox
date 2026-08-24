---
title: "Fail-closed webapp development surfaces and tRPC errors"
status: draft
workstream: node-env-production
issues:
  - ../../../issues/bugs/2026-08-21-trpc-errors-return-a-server-stack-trace.md
---

# Fail-closed webapp development surfaces and tRPC errors

This plan removes callback-box security decisions from ambient `NODE_ENV`.
tRPC responses never include server stacks or raw internal-error messages.
Production omits development-only routes and test behavior by default. The two
launchers that genuinely run a development server opt in through one narrow,
fail-closed process flag.

## Stated preferences this plan trades against

- `docs/engineering-principles.md:37-44`: environment variables are validated
  into typed data at an entrypoint boundary, with loud localized failure.
- `docs/engineering-principles.md:49-57`: invalid configuration must not
  silently degrade into a weaker posture.
- `docs/engineering-principles.md:95-103`: one explicit idiom should own a
  behavior; duplicated controls and differing defaults create drift.
- `docs/engineering-principles.md:116-124`: a test-only affordance must be
  inert unless deliberately enabled by a process flag.
- `docs/engineering-principles.md:141-149`: the maintainer is an agent, so the
  safe path and its validation must be discoverable from code and tests.
- `CLAUDE.md:107-110`: read before writing, prefer doctests, and retain raw
  Fastify routes only where their protocol requires them.
- `code-style.md:88-89`: resolve optional values inside function bodies and
  use named option objects rather than growing positional argument lists.

## What already exists

- **Raw-route error sanitization — REUSE.** `src/webapp/server.ts:114-128`
  already returns generic 5xx bodies while logging server-side details.
- **tRPC construction seam — MODIFY.** `src/webapp/trpc/trpc.ts:4` creates the
  root router without overriding tRPC's `NODE_ENV`-derived `isDev` default.
- **Internal server options — EXTEND.** `src/webapp/server-types.ts:40-68`
  already separates test-only construction options from public
  `ServerOptions`. The development-route opt-in belongs on the internal side.
- **Published server construction — PRESERVE.** `src/exports/server.ts`
  re-exports `createServer` and `startServer`; `createServer` already accepts
  `InternalServerOptions` through its inferred signature. This plan does not
  attempt a public-API refactor. The new option remains beside existing
  internal/test construction seams and defaults closed.
- **Development CLI seam — EXTEND.** `src/cli/commands/serve.ts:95-107`
  already exposes `cb serve --dev`; its watched child environment is the
  natural opt-in boundary.
- **Development router seam — EXTEND.** `../bin/router-core.ts:416-423` is the
  other launcher that knows both its direct-server and hub paths are local
  development processes.
- **Hub child environment seam — EXTEND.** `src/hub/child-env.ts:42-50` and
  `:103-119` copy a small allowlist into each box's own pinned engine. An env
  flag is backwards compatible: old engines ignore it instead of rejecting an
  unknown CLI argument.
- **The ambient branches — REMOVE.** `src/webapp/routes/api.ts:71-75` gates
  `/api/external`; `src/webapp/routes/chat-audio-routes.ts:115-123` gates mock
  TTS; `src/webapp/server.ts:151-160` selects CSP mode; and tRPC 11.17 derives
  whether to include stacks from `NODE_ENV`.
- **CSP has a separate development owner — REUSE.** Fastify serves built HTML,
  so it can always use the production policy. Vite already installs the
  relaxed HMR policy at `src/frontend/vite.config.ts:40`. Both headers remain
  Report-Only, as documented in `docs/content-security-policy.md:3-6`.
- **Route and process tests — ADD AND EXTEND.** Existing external-route, CSP,
  env, serve-argv, hub-child-environment, and router-spawn tests provide
  nearby harnesses. Server-main environment consumption, router spawn
  environment, and mock-TTS authorization need new assertions.
- **Confirmed deployed state — TEMPORARILY CONTAIN.** A boxholder-authorized
  read-only probe on 2026-08-23 returned `NODE_ENV=<unset>` for the running
  production `callback-hub`. The linked issue records the exact filtered
  probe and its implications.

## Prior art (external)

- [tRPC error formatting](https://trpc.io/docs/server/error-formatting)
  documents `errorFormatter` and the development-only stack field.
- [tRPC `initTRPC` source](https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/initTRPC.ts)
  shows that `isDev` defaults to `process.env.NODE_ENV !== "production"` and
  accepts an explicit override.
- [tRPC `getErrorShape` source](https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/error/getErrorShape.ts)
  shows that `config.isDev` adds the stack before formatting.
- No deployment-mode library is needed. Callback-box already has validated
  entrypoint schemas and explicit process-launch seams.

## Tracks / scope

### Track 0 — Reversible production containment

**What.** With separate, explicit boxholder approval, add a systemd drop-in to
the live `callback-hub` unit containing `Environment=NODE_ENV=production`, then
restart only that unit. Do not edit the shared `$CB_HOME/.env` and do not
restart `callback-scheduler`.

**Why this needs to change.** The production probe confirmed that current
engines take every development branch. `/api/external` is only box-authenticated,
not owner-only: the raw file-write route lets an authorized member replace
`config/box.json`, including `externalRoots`, and the external route then reads
non-denylisted files under those roots. This is a live host-filesystem
disclosure path. The durable code change cannot protect already deployed and
older box-pinned engines until it is present in them.

**Direction.** First inventory the engines behind the live hub by resolving
each configured box's pinned `cb` binary and classifying whether it contains
the durable guard. Then use one unit-local override under
`/etc/systemd/system/callback-hub.service.d/`, followed by `systemctl
daemon-reload` and the existing hub restart, health, and canary procedure.
Verify a known tRPC error lacks `data.stack` and an authenticated
`/api/external` request returns 404. Do not probe mock TTS in production: the
safe branch may call the paid provider. The CSP policy is Report-Only, so the
mode change cannot block a page; verify its header as supporting evidence.
Rollback removes the drop-in, reloads systemd, and restarts the hub.

The override propagates through current engines to agent and scheduled-script
subprocesses, where package managers may interpret `NODE_ENV=production` and
omit development dependencies. Treat it as a short-lived containment, not a
standing configuration. During the durable rollout, remove `NODE_ENV` from the
script subprocess allowlist, upgrade or backport every older served engine,
then remove the drop-in once the inventory shows no dependent engine.

**First implementation chunk.** This is an operational containment, not a git
commit. Perform the inventory and mutation only after approval of the exact
read, restart, and rollback procedure. Record filtered results in the issue.
The task is not operationally complete while an older engine still depends on
the override.

### Track 1 — Unconditional tRPC response sanitization

**What.** Omit server stacks and replace raw `INTERNAL_SERVER_ERROR` messages
in tRPC responses in every environment.

**Why this needs to change.** Browser clients do not need absolute server paths,
server frames, or exception strings from unexpected failures. Either the stack
or the message can contain host paths. Existing server-side logging owns
diagnosis, so disclosure should not depend on any deployment variable.

**Direction.** Construct the root router with explicit `isDev: false` and an
`errorFormatter` that replaces only `INTERNAL_SERVER_ERROR` messages with a
fixed string. Preserve useful messages for expected 4xx errors and preserve
adapter `onError` logging. Add a response-shape doctest that saves the prior
`NODE_ENV`, deletes it explicitly, asserts that an expected error has no stack,
then drives an internal exception containing an absolute path through the real
Fastify adapter and asserts that neither its message nor path reaches the wire.

**First implementation chunk.** Add the failing response-shape doctest, make
the root-router formatter change, and run the focused tRPC route suite.

### Track 2 — Explicit development-only surfaces

**What.** Replace the remaining `/api/external` and mock-TTS `NODE_ENV`
branches with a boolean internal option that defaults to `false`. Use the
dedicated process transport `CB_DEV_SURFACES=1` only between development
launchers and current engines.

**Why this needs to change.** Both features are local test facilities. The
current negative comparison fails open when a generic ambient variable is
unset. A purpose-specific positive opt-in makes omission safe and does not
conflate library optimization mode with route authorization.

**Direction.** Add `devSurfaces?: boolean` to `InternalServerOptions`, resolve
it to `false` inside server construction, and pass the resolved value only to
API and chat-audio route registration. `/api/external` is unregistered unless
it is `true`. A request with `mock: true` when the option is false returns a
400 with a stable error reason and emits a metadata-only warning; it must not
silently fall through to a paid provider call. Other TTS requests continue
through the normal provider path.

Do not split the published server API in this fix. `createServer` already
exposes the structural internal-options signature, and local embedding code is
not a privilege boundary from the host filesystem. Change the source
`startServer` signature to the same `InternalServerOptions` so the CLI can
thread the value without a second wrapper; accept that the structural option
is visible through the existing re-export. The meaningful boundary is that
every production caller omits the option and the default is false.

Add `CB_DEV_SURFACES` as the optional literal `"1"` to `serverEnvSchema` and
`hubEnvSchema`, not `baseEnvSchema`; unrelated `cb` commands must retain the
base schema's deliberately permissive behavior. Empty/unset means false and
every other value fails an affected server or hub startup. `server-main.ts`
keeps the returned `ServerEnv`. The `cb serve` action explicitly calls
`loadEnv(serverEnvSchema)` and passes the resolved boolean to `startServer`;
the top-level CLI validation result is currently discarded and is not an
adequate consumer. Likewise, `cb hub` validates with `hubEnvSchema` and
normalizes an absent value out of `process.env`; the supervisor's existing
allowlist then copies only the validated literal to children.

`cb serve --dev` sets the flag on its watched child. The monorepo router sets
it in `childEnv` for both the direct server and normal hub path. The hub
allowlist copies it to box children.

Production launchers do not set the flag, do not append a new argument, and do
not need a new `cb hub` or `cb serve` option. This preserves the exact child
argv for older pinned engines. An older development engine ignores the unknown
environment key and merely lacks the dev-only routes; it does not crash-loop.

The test helper exposes `devSurfaces` but opts in only for doctests that use one
of these facilities. Do not make all test servers implicitly developmental:
the default should remain exercised broadly.

**Vocabulary lock-in.** `devSurfaces`, `CB_DEV_SURFACES=1`, and “development
surfaces” are the only new terms. There is no general `WebappMode` and no
`--webapp-mode` argument.

**First implementation chunk.** Add failing route doctests for safe omission,
explicit opt-in, and `mock: true` rejection. Then add the internal option and
route propagation. Add the two entrypoint-specific schema fields and launcher
tests only after the in-process behavior is pinned.

### Track 3 — CSP and auditable documentation

**What.** Remove Fastify's `NODE_ENV` CSP choice and repair security and deploy
documentation.

**Why this needs to change.** Vite already owns the relaxed development CSP.
The production Fastify server serves the built frontend, so choosing a relaxed
policy from ambient state is unnecessary. Separately,
`docs/security-report.md:107` says `/api/external` is never mounted on a
deployed server; the production probe proved that statement false today.

**Direction.** Always pass `mode: "prod"` to Fastify's existing CSP builder.
Keep the header Report-Only and keep Vite's `mode: "dev"` policy unchanged.
Update `docs/content-security-policy.md` to describe this ownership split and
`deploy/README.md` to document the temporary unit override plus the durable
fail-closed development-surface control.

After the code is final, run the `security-report` procedure. Add or update the
internal-practices row for tRPC response sanitization and rewrite the
`/api/external` row to cite the explicit opt-in rather than `NODE_ENV`. Leave
`security-overview.md` alone unless the rubric finds a reader-facing posture
change. Present `docs/security-report.md` with `reviewed-by: DRAFT —
unreviewed`; do not commit that generated artifact before boxholder review.

**First implementation chunk.** Hardcode the Fastify CSP mode with its focused
header test. Update ordinary reference docs in the code commit; generate the
structured report only after implementation evidence exists.

## Could this be simpler?

The smallest immediate action is Track 0: set `NODE_ENV=production` on the
live hub. It closes all current branches and protects old box-pinned engines.
It is not sufficient as the durable design because the live unit is manually
configured, the shared environment also reaches other processes and user
scripts, and an omitted generic variable would still fail open later.

The smallest durable code change is not a general production-mode framework.
It is one unconditional tRPC setting, one internal boolean for the two real
test surfaces, one strict opt-in transport used only by development launchers,
and a constant production CSP in Fastify. This is narrower than threading a
two-value mode through public server types, CLI arguments, hub child argv, and
CSP tests.

## Subplans

There are no subplans. The four tracks are independently committable but small
enough to review as one security fix. Rebuilding the obsolete provisioning
script around the live hub topology remains a separate deployment project.

## Failure modes

| What can fail | Test or evidence | Handling | Visibility |
|---|---|---|---|
| Production omits all new configuration | Default-construction route doctests | Development surfaces stay off | Safe, explicit 404/provider path |
| `CB_DEV_SURFACES` has a value other than `1` | Server- and hub-schema doctests | Affected server/hub entrypoint rejects startup | Loud validation error naming the key |
| tRPC runs with `NODE_ENV` absent or non-production | Doctest deletes/restores the variable and injects a path-bearing exception | `isDev: false` plus the internal-error formatter are unconditional | Stack-free response with a generic internal message |
| `/api/external` is requested without opt-in | External-route doctest | Route is not registered | 404 |
| `mock: true` arrives without opt-in | Chat-audio route doctest | Reject before key lookup/provider call | 400 plus metadata-only warning |
| Dev router forgets the opt-in | Router spawn-environment tests for both paths | Dev-only facilities stay safely absent | Test failure; local 404 |
| Hub loses the opt-in before spawning a child | Child-environment doctest | Development child lacks facilities | Test failure; no weaker fallback |
| Production hub serves an older pinned engine | Read-only engine inventory; supervisor test pins child argv unchanged | Old CLI receives no unknown flag; upgrade/backport it before removing containment | Visible inventory item; no crash-loop |
| Temporary `NODE_ENV` changes package-manager behavior in agent/script subprocesses | Script-env allowlist test and bounded rollout window | Remove it from the durable script allowlist; retire the override after fleet closure | Explicit temporary tradeoff, not standing state |
| Fastify CSP change breaks a page | Existing CSP builder/header tests plus live header inspection | Policy stays Report-Only | Reports only; cannot block resources |
| Containment restart fails | Existing deploy health and canary procedure | Remove drop-in, reload, restart | Service health failure |
| Security report overstates the result | Mandatory boxholder review | Generated file remains draft and uncommitted | Provenance header |

## Agent-flow / user-flow edge cases

- **Wrong tag / stale ref / concurrent card edit — NOT APPLICABLE.** No card
  shape, reference, or workflow vocabulary changes.
- **Hand-edit drift — ADDRESSED.** Production needs no new hand-edited value;
  only development launchers set the flag.
- **Fabricated free-form value — ADDRESSED.** The schema accepts only literal
  `1`; it does not coerce truthy strings.
- **Validation UX — ADDRESSED.** A malformed flag stops the affected entrypoint
  and names the invalid key without exposing secrets.
- **Partial deployment — ADDRESSED.** Production child argv remains unchanged.
  Older engines are covered temporarily, inventoried, and upgraded or
  backported before the override is removed; newer engines ignore `NODE_ENV`
  for all four decisions.
- **Programmatic embedder — ACCEPTED.** `createServer` already exposes internal
  construction options. This plan does not treat local host code as a security
  boundary; the route opt-in remains false by default.

## NOT in scope

- Rebuild `setup-server.sh` to generate the current `callback-hub` topology.
- Change CSP from Report-Only to enforcing.
- Remove `NODE_ENV` from every dependency or child environment. This plan does
  remove it from agent/scheduled-script inheritance; hub-to-old-engine
  compatibility remains only for the bounded containment window.
- Redesign `/api/external` roots, auth, or protocol.
- Remove mock-TTS request fields; the speech harness still needs them locally.
- Hide expected 4xx tRPC messages or procedure paths; only unexpected internal
  messages are replaced.
- Add a public runtime-mode endpoint or a persistent fleet inventory feature;
  rollout uses a bounded read-only inventory of the configured boxes.
- Leave an older pinned production engine indefinitely on the temporary
  override. Each must be upgraded or backported before closure.

## Open design questions

There are no open code-design questions. Track 0 and any later production
rollout/restart remain explicit operational authority gates.

## Knowledge audits

No knowledge audit applies. This changes engine and deployment behavior, not
guidance loaded by a box agent.

## Implementation order

1. **Containment, separately approved.** Inventory served engines, install the
   unit-local override, restart only the hub, verify filtered behavior, and
   update the issue.
2. **tRPC response boundary.** Add the doctest, set `isDev: false`, and replace
   client-visible `INTERNAL_SERVER_ERROR` messages while preserving expected
   4xx messages.
3. **In-process development surfaces.** Add `devSurfaces`, gate the external
   route, and reject unauthorized mock-TTS requests before provider lookup.
4. **Process transport.** Add the strict literal to the server and hub schemas,
   consume it at both actions, set it in `serve --dev` and both dev-router
   paths, and allowlist it through the hub.
5. **CSP ownership.** Make Fastify always use the production Report-Only policy
   while leaving Vite's development policy intact.
6. **Reference docs and issue evidence.** Update CSP/deploy docs and the issue.
7. **Security-report follow-up.** Run the security-report procedure after code
   behavior is final and present the separate draft for boxholder review before
   committing that generated artifact.
8. **Validation.** Run focused doctests, the relevant router tests, full
   callback-box tests, typecheck, lint, doc-check, and `git diff --check`; then
   cross-model review the implementation diff and adjudicate findings.
9. **Rollout, separately approved.** Deploy normally, verify health/canary,
   stack-free tRPC errors, `/api/external` 404, rejected mock TTS, and the
   production Report-Only CSP header. Upgrade or backport every inventoried
   older engine, remove `NODE_ENV` from durable script inheritance, then remove
   the systemd override and repeat the filtered verification. Do not close the
   rollout with the temporary override still required.

## Rollout shape

Tests lead each code chunk:

- A tRPC adapter doctest explicitly exercises absent `NODE_ENV`, a stack-free
  error shape, and an internal exception whose message contains an absolute
  path; the wire response contains neither the raw message nor the path.
- External-route doctests prove safe default omission and explicit internal
  opt-in.
- Chat-audio doctests prove mock fields select fixtures only with the opt-in
  and otherwise return 400 without touching a provider.
- Server/hub env tests prove only literal `1` is accepted; route and child-env
  tests prove the value reaches the intended behavior.
- New serve and router spawn-environment assertions prove the flag is set only
  by development launchers.
- Hub child-env tests prove the opt-in propagates as environment, while the
  supervisor child argv remains byte-for-byte unchanged in production.
- CSP tests prove Fastify uses the production policy and keeps the
  Report-Only header; existing Vite coverage retains the HMR policy.
- Script-environment tests prove the durable engine no longer passes
  `NODE_ENV` to agent or scheduled-script subprocesses.

The durable code ships as one normal deployment and requires no data
migration. The systemd override is an independently approved, bounded
operational bridge. Production verification uses authenticated, filtered
diagnostics and emits no credentials. The structured security report
remains unreviewed until the boxholder explicitly accepts its wording.
