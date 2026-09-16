---
title: "Derive the box server endpoint across process boundaries"
status: draft
workstream: secret-endpoint-derivation
issues:
  - ../../../issues/bugs/2026-09-16-bbx-server-url-underivable-outside-the-serve-process.md
---
# Derive the box server endpoint across process boundaries

Persist the live per-box server endpoint when `bbx serve` binds so a fresh CLI
process can derive the same `BBX_SERVER_URL` and `BBX_BOX_NAME` as a server-
spawned child. Report missing or unreachable server transport separately from
secret-grant refusals. Do not change the secret-returning agent API in this
workstream.

**Issues addressed:** `issues/bugs/2026-09-16-bbx-server-url-underivable-outside-the-serve-process.md`.

## Smallest fix and budget

The smallest fix is a machine-owned endpoint file written by `startServer`
after `listen`, read by `buildScriptEnv`, plus transport classification in the
shared delegated-verb path. Estimate: 45–75 source lines and 45–75 doctest
lines, with a small reference-doc update. The fuller descriptor includes PID
and URL rather than only a port so stale state can be diagnosed without making
the CLI guess.

## Stated preferences this plan trades against

The endpoint must remain derived from the current box, not inherited: the
allowlist explicitly excludes `BBX_SERVER_URL` and `BBX_BOX_NAME` because a
parent could point a child at the wrong box (`src/core/script-env-allowlist.ts:50`).
The descriptor therefore adds a machine-owned runtime artifact rather than
weakening that boundary. It also preserves the existing direct-read path and
does not add a default port, because `box-client.ts:42–44` rejects guessing at
`localhost:3210` as unsafe.

## What already exists

- `startServer` knows the actual bound host and port and registers the live URL
  only after `server.listen` (`src/webapp/server.ts:371–383`). Reuse this bind
  point as the write owner.
- `.bbx-serve.pid` is already a per-box machine runtime marker
  (`docs/box-layout.md:133–140`). Place the endpoint descriptor in the same
  runtime-artifact family and keep it out of committed box content.
- `buildScriptEnv` already has one priority cascade and `parsePublicUrl`
  (`src/core/script-env.ts:112–148`). Add the disk source to that cascade
  without changing the allowlist.
- `dispatchCredentialed` already attributes missing client state to the
  machine (`src/cli/lib/credentialed-verb.ts:108–116`). Extend the transport
  boundary there, not in each connector family.

## Prior art (external)

No external premise is needed. This uses the repository's existing atomic
runtime-file and PID-file conventions.

## Tracks / scope

### Track 1 — Persist and read the live endpoint

**What:** Add a small validated descriptor with the full box public URL and
serving PID. `startServer` writes one descriptor per served box atomically after
bind; graceful shutdown removes it with the PID file. `buildScriptEnv` reads it
when the in-process ambient map is unavailable, before configured/env URLs.

**Why:** The ambient map is process-local, while hub children receive a new
port on every restart (`src/hub/child-spawn.ts:77–90`). A file refreshed by the
process that actually binds survives both boundaries.

**Direction:** Use a hidden runtime file under `.beebox/`, containing
`{ pid: number, publicUrl: string }`. Validate both fields and ignore malformed
or absent state. Write via the existing atomic-write helper. Never put a secret
in this file. Do not delete a stale file on a fresh CLI read; the server owns
cleanup, and the next server generation replaces it after binding.

**Vocabulary lock-ins:** `.beebox/serve-endpoint.json`; fields `pid` and
`publicUrl`; source priority `ambient > endpoint file > box.json > env`.

**First implementation chunk:** Add the descriptor read/write helpers, wire the
post-bind write and shutdown cleanup, update `buildScriptEnv`, and add doctests
for cross-process-style disk derivation, malformed state, and replacement.

### Track 2 — Classify transport failures

**What:** Map failures before or during delegated calls to a stable machine
refusal, with wording that says the box server could not be reached. Preserve
HTTP/tRPC refusal kinds and their boxholder guidance.

**Why:** A dead or stale endpoint is not evidence that a grant is missing. The
current shared dispatcher catches remote errors but does not give raw network
failures a distinct refusal (`src/cli/lib/credentialed-verb.ts:112–141`).

**Direction:** Add a `BOX_UNREACHABLE` classification for missing endpoint
variables and network-level fetch failures; keep server-returned refusal codes
unchanged. Cover DNS/connection refusal and HTTP 403/404 separately.

**Vocabulary lock-ins:** `BOX_UNREACHABLE` and fix party `machine`.

**First implementation chunk:** Add the classifier and focused doctests through
`dispatchCredentialed`; do not alter individual connector implementations.

## Could this be simpler?

The simplest version writes only a port text file and reconstructs localhost,
but it cannot represent host/slug correctly and invites the exact wrong-box
guess that the allowlist prevents. A validated full URL descriptor buys correct
multi-box routing and preserves the fail-closed rule.

## Subplans

None. The descriptor shape and writer are settled here.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Endpoint file is absent before the first successful bind | yes | leave URL unset; classify machine-unreachable | clear |
| Endpoint file is malformed or partially written | yes | atomic replacement plus validated-read ignore | clear |
| Old endpoint remains after SIGKILL | yes | next generation replaces it; transport classifier reports unreachable if still stale | clear |
| Server returns a secret refusal | yes | preserve typed refusal and boxholder fix party | clear |
| Server cannot be contacted | yes | return `BOX_UNREACHABLE` with machine guidance | clear |

## Agent-flow / user-flow edge cases

- Wrong box: ADDRESSED by deriving from the box-root-specific descriptor and
  retaining the non-inherited allowlist.
- Stale endpoint: ADDRESSED by atomic replacement on every bind and explicit
  transport classification when the old endpoint no longer answers.
- Concurrent restart: ADDRESSED by atomic file replacement; readers see the
  old complete descriptor or the new complete descriptor, never a partial JSON.
- Hand-edit drift: ADDRESSED by strict validation and treating invalid state as
  unavailable; the file is machine-owned and not documented for hand editing.
- Secret leakage: DEFERRED; the documented POST remains unchanged in this
  workstream and the CLI broker remains a recommendation.

## NOT in scope

- Secret-returning `bbx` subcommand: it changes the agent-facing contract and
  needs a separate decision about how a caller receives the value.
- Box-side trick edits: the evidence lives in a real box, outside this repo.
- Hub port allocation or routing: the hub already owns allocation and passes the
  selected port to `bbx serve`.
- Inheriting `BBX_SERVER_URL` or `BBX_BOX_NAME`: unsafe cross-box ambiguity.

## Open design questions

None for the two bug fixes. The separate secret-delivery redesign remains open.

## Knowledge audits

None. This is machine-owned runtime plumbing; no new box-agent concept is
intended beyond making the already-documented variables available.

## What will hold this after it ships

`test/core/script-env.doctest.md` will cover the descriptor cascade and invalid
state. A focused CLI doctest will cover `BOX_UNREACHABLE` versus HTTP refusal.
The tests exercise pure parsing/classification plus injected filesystem/network
seams; no full server restart is needed for the core regression.

## Implementation order

1. Add endpoint descriptor helpers and script-env disk derivation.
2. Write/replace the descriptor after bind and remove it during graceful
   shutdown.
3. Add transport-error classification and focused tests/docs.
4. Run focused doctests, typecheck/lint, and cross-model review.

## Rollout shape

No data migration is needed. Existing boxes without the descriptor continue to
use configured `publicUrl` or env URLs; a running server creates the descriptor
on its next successful bind. Done-when is the focused script-env and dispatcher
doctests plus repository checks passing, with no changes to the allowlist or
secret response body.
