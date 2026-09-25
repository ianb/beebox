---
title: "Make granted secrets available through the standard trick runtime"
status: implemented
workstream: secret-endpoint-derivation
issues: []
---

# Make granted secrets available through the standard trick runtime

The earlier endpoint fix made the live box URL derivable across processes and
separated unreachable-server failures from grant refusals. The remaining
problem is that the agent guide still teaches box code to issue a raw POST whose
response contains the plaintext secret (`issues/closed/bugs/2026-09-16-bbx-server-url-underivable-outside-the-serve-process.md:70-88`).

This plan changes the contract at the trick runner, not at each trick and not
through an agent-level `bbx secrets exec` wrapper. A trick that declares a
credential should receive that credential whenever the normal `bbx trick` path
runs it. The runner resolves the grant and injects the value into the trick's
process environment; the trick author only uses the declared environment name.
Existing boxes receive a one-shot agent-applied migration that reviews their
existing tricks and adds declarations where code inspection confirms a need.

**Issues addressed:** No open issue is attached yet. This is the deferred
follow-up explicitly called out by the closed endpoint issue and implemented
plan (`beebox/docs/implemented-plans/secret-endpoint-derivation.md:133-147`).

## Smallest fix and budget

The smallest coherent fix extends the existing trick launch path with a
machine-readable secret declaration, one resolver call per declared secret,
and environment injection before `tsx` starts. It also replaces the agent-guide
curl recipe with the trick declaration/use contract. Estimate: 100–160 source
lines, 80–140 doctest lines, and a focused documentation/knowledge-audit
update. This is not a BIG change: it preserves the existing resolver, grants,
route, and `bbx trick` command.

## Stated preferences this plan trades against

Tricks should be ordinary scripts that can use the key they are built around;
they should not need every author to rediscover endpoint URLs, bearer headers,
or a special wrapper command. The existing trick runner already creates the
subprocess environment centrally (`beebox/src/cli/commands/trick.ts:116-141`),
and `buildScriptEnv` is expressly the environment for “agents, tricks,
procedure shell steps” (`beebox/src/core/script-env.ts:176-196`). This plan
extends that seam instead of changing every trick.

The value still must not be printed by the framework, placed in argv, written
to a box file, or added to the persistent base environment. The child process
environment is the deliberate delivery channel: it is available to the one
trick being launched, while the parent and other tricks are unchanged. This is
convenience and transcript safety, not a same-user security boundary.

## What already exists

- `bbx trick` discovers `src/tricks/<name>/index.ts` and launches it through
  `tsx`, with `stdio: "inherit"` and an environment built immediately before
  launch (`src/cli/commands/trick.ts:72-142`).
- `buildScriptEnv` already fail-closes inherited credentials and derives the
  current box endpoint, including the machine-owned endpoint descriptor added
  by the preceding work (`src/core/script-env.ts:118-170`).
- The raw route authenticates with `BBX_AGENT_TOKEN`, resolves one named secret
  with a short purpose, and returns `{value, suspect}` or a typed refusal
  (`src/webapp/routes/secrets.ts:97-124`; `src/core/secrets/resolve.ts:70-148`).
- Secret declarations and grants are already the boxholder-facing lifecycle;
  `bbx secrets declare` names a slot without putting its value in the box
  (`src/cli/commands/secrets.ts:280-327`).

## Prior art (external)

No external premise is required. The design relies on this repository's
existing child-process environment and machine-level secret-grant contracts; it
does not claim to provide a provider-specific broker or protect against code
that already has permission to run as the same user.

## Tracks / scope

### Track 1 — Declare a trick's secret needs

**What:** Add a small `secrets.json` declaration next to the trick entry point,
with a stable secret name, reason, and environment variable name. The declaration must
be inspectable without executing arbitrary trick code. The v1 shape should
support one or more entries, for example:

```json
[
  { "name": "openai-images", "reason": "image-generation", "env": "OPENAI_API_KEY" }
]
```

The exact file and fields are vocabulary lock-ins: `secrets.json`, with `name`,
`reason`, and `env` fields. Validate `name` using the route's existing
non-empty bounded name rule, `reason` using the resolver's short lowercase
purpose-label pattern, and `env` as a shell environment identifier. The runner
passes `reason` as the resolver purpose, so every access log records why the
trick needs the key. An absent declaration means no secret lookup and preserves
current behavior.

**Why:** A trick has a durable dependency, not an ad hoc runtime question. The
runner can resolve it every invocation and the boxholder can see the reason in
the existing access log. It also means an image-generation trick cannot be
mistakenly run without its required key being considered.

**Direction:** Use the JSON sidecar rather than expanding the existing
description regex or importing `index.ts`. Validate it with the existing schema
tooling. Invalid declarations fail before the trick starts with a safe
diagnostic that includes names and field errors, never values.

**First implementation chunk:** Define the declaration type and parser,
validate it, and add discovery tests for no declaration, one declaration,
multiple declarations, and malformed declarations.

### Track 2 — Resolve and inject at the standard trick boundary

**What:** Extend `runTrick` so it discovers the sidecar, resolves each secret
for the current box with `access: "agent"`, and adds the returned value
only to the environment passed to that trick's `spawn`. Keep the existing
`buildScriptEnv` base environment and additions ordering; secret additions are
the final child-only additions.

**Why:** This is the one place all tricks already pass through. It removes the
need for box code to know `$BBX_SERVER_URL`, `$BBX_BOX_NAME`, endpoint paths, or
bearer headers, and avoids an agent debugging a raw response into a transcript.

**Direction:** Add a small CLI client helper for the existing resolve route,
using the freshly built trick environment's endpoint and agent token, passed
explicitly to the helper rather than reread from the CLI parent's
`process.env`. Do not create a second grant or
store implementation. On success, keep `value` in memory and inject it under
the declared `env` name. Do not put it in the command argv, log lines,
diagnostics, JSON output, or a shared environment file. If `suspect` is true,
emit a value-free warning and continue, matching the resolver's existing
meaning that the key may be expired but is still available for use.

If the agent token cannot be provisioned into the built environment, refuse
before making the request with machine attribution; do not turn that into a
misleading grant refusal. If any other resolution fails, do not spawn the trick.
Preserve server refusal kinds
and messages, map endpoint/network failures to the existing `BOX_UNREACHABLE`
machine attribution, and make the final error say which declared dependency
failed without echoing a response body that could contain a secret. Multiple
secrets resolve sequentially or with bounded parallelism, but the first v1
implementation should prefer sequential calls so access-log order is clear.

The child receives the injected variable even if the parent already has a
variable with that name; the parent is never mutated. Reject duplicate `env`
names and runner-owned names (`BBX_*`, `PATH`, `HOME`, and `SHELL`) because the
winner would otherwise be ambiguous or could break the runner's own contract.

**First implementation chunk:** Wire declaration discovery and the client into
`runTrick`, add a child-only environment injection seam, preserve child exit
codes/signals, and add focused tests for success, refusal, unreachable server,
suspect warning, missing token, and child launch failure. Because `runTrick` is
currently private and the doctest launches the built CLI, expose only a narrow
injection seam (resolver/client and spawn dependencies) for tests; do not make
the whole command module public.

### Track 3 — Replace the agent-facing recipe and audit the knowledge

**What:** Change `beebox/src/core/agent-guide/secrets.ts` so it teaches:

1. declare the needed secret with `bbx secrets declare`;
2. add `secrets.json` to the trick directory; and
3. run the normal `bbx trick <name>` path.

Update the generated trick-authoring template in
`beebox/src/core/box/templates.ts` and its stock-hash ledger, plus the tricks
skill content in `beebox/src/core/box/skills-content.ts`, so new box agents see
the sidecar contract before authoring a trick. Existing boxes with customized
templates must not be silently overwritten; field rollout of that stock change
is a boxholder decision.

Update `beebox/docs/secrets.md` to retain the HTTP route only as a low-level
engine reference, explicitly warning that a shell `curl` prints the credential
and is not the box-code workflow. Document the declaration shape, grant
requirements, reason/access logging, and the limitation that a trick can still
print its own environment.

Rewrite the existing `secrets-adhoc-use` direct knowledge audit, rather than
adding a conflicting second audit. It should prove an agent knows to declare a
need and put the mapping in the trick rather than manually calling the secret
endpoint. Also revise the guide/doc wording that currently says a credential is
never in an env var: distinguish an agent-authored env var/file from a
framework-injected, child-only runtime variable.

**First implementation chunk:** Update the guide source, reference docs, audit
fixture/expectations, and generated documentation checks together so there is
one current instruction.

## Could this be simpler?

An agent-level command such as `bbx secrets resolve <name>` would require fewer
runner changes, but it would either print the value or require every trick to
invent a wrapper and delivery convention. The former recreates the transcript
leak; the latter violates the requirement that a trick needing a key should
just work through the normal trick path.

A true broker that performs image generation or another provider operation
without disclosing the key would be stronger, but it is provider-specific and
would require new operation contracts. This plan deliberately stops at
standard child-environment delivery.

## Migration

This is a judgment-bearing on-disk migration, so it is registered as the
`trick-secret-runtime` procedure migration. A deterministic script cannot know
whether an arbitrary trick's external API requires a credential or which slot
the boxholder intends. The procedure asks an agent to inspect every existing
trick, update only confirmed dependencies, maintain a checklist, and pass the
machine gate `bbx trick --check-secrets`. New boxes and newly authored tricks
get the contract from the updated authoring template; they do not need the
migration.

The migration is resumable and idempotent: no tricks means a skip; a completed
checklist plus valid declarations means a skip; a partial agent run leaves its
committed work for the next run. It never guesses secret names, changes grants,
or writes values. Customized trick templates are not overwritten silently.

## Subplans

None. The declaration, resolver client, runner injection, and guide update are
one contract and should land together.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Trick has no declaration | yes | do not resolve; run as today | silent |
| Declaration is malformed or has duplicate/reserved env names | yes | refuse before launch with field-level guidance | clear |
| Agent token cannot be provisioned | yes | refuse with machine attribution before HTTP | clear |
| Secret is unknown, empty, or not granted at agent level | yes | preserve typed refusal; name the missing dependency, not its value | clear |
| Endpoint is absent, stale, or unreachable | yes | `BOX_UNREACHABLE` with machine guidance; do not suggest changing grants | clear |
| Secret is marked suspect | yes | value-free warning, then continue | clear |
| Child cannot start or exits nonzero | yes | preserve existing start error/exit status; never include the secret | clear |
| Trick itself prints the injected value | yes, as a documented limitation | framework cannot prevent the trick from disclosing its own environment | clear |

## Agent-flow / user-flow edge cases

- A trick with several keys: each declaration resolves at invocation time;
  duplicate environment names are rejected before any child starts.
- A box restart during resolution: the endpoint descriptor is already refreshed
  by the server bind path; a failed request is reported as unreachable and the
  trick is not launched.
- A box with no running server: a declared-secret trick now requires the normal
  served-box endpoint, so it fails before launch; a trick without a declaration
  retains today's offline behavior.
- A grant is raised after a failed run: rerunning the same trick retries the
  resolve; no secret is cached in the box or parent process.
- A renamed or cloned box: the existing slug-based grant check remains the
  authority; declaration does not grant access.
- A malicious or merely buggy trick: it can read or print values in its own
  process, write them to a file, and have that file auto-committed by the
  existing trick cleanup (`src/cli/commands/trick.ts:201-202`), as any code
  granted execution can. This is not a new privilege boundary and must be
  stated in the docs.
- Debugging: the recommended command is `bbx trick <name>`, whose framework
  output contains only names, purposes, refusal messages, and exit status—not
  the response body or resolved value.

## NOT in scope

- A value-printing `bbx secrets get/resolve` command.
- A per-invocation `bbx secrets exec` wrapper required by trick authors.
- Stdin, inherited-file-descriptor, or temporary-file secret delivery.
- Provider-specific broker operations that avoid giving the trick the key.
- Changing secret grants, access levels, endpoint authentication, or the raw
  route's response contract.
- Editing the real box trick that exposed the issue; that belongs to the
  boxholder and is outside this repository.
- Preventing a trick from voluntarily logging its own environment.
- Silently rolling the updated trick-authoring template into customized boxes;
  those need a boxholder-approved rollout.

## Open design questions

None required for v1. Future work may add an FD-based delivery channel for
processes that should not use environment variables, or a provider broker for
high-sensitivity keys, but neither should block the standard trick path.

## Knowledge audits

Rewrite the existing `secrets-adhoc-use` `knows_directly` audit for the sidecar
declaration and normal `bbx trick` workflow. Run it after the guide, template,
and docs change; a passing unit test is not evidence that a fresh box agent
learned the contract.

## What will hold this after it ships

Focused doctests will cover declaration parsing, injected child environment,
no value in framework stdout/stderr/argv, typed refusals versus transport
failures, suspect warnings, and child exit propagation. Run the relevant
backend typecheck/lint and documentation checks. Run the direct knowledge audit
in the isolated test box. A full production deployment or physical-device
check is not relevant; live boxholder credential rotation remains separate.

## Implementation order

1. Define and validate the `secrets.json` trick declaration.
2. Add the raw resolve client using the existing derived endpoint/token.
3. Inject resolved values only into the `bbx trick` child environment and test
   all failure/exit paths.
4. Add the agent-applied migration, registry entry, checklist, and machine
   validation command.
5. Replace the agent-guide curl recipe; update the trick template, skill,
   `docs/secrets.md`, and migration reference.
6. Add/run the knowledge audit, then run focused tests, typecheck, lint, and
   doc checks.
7. Obtain cross-model review before implementation is declared complete.

## Rollout shape

Existing boxes run the `trick-secret-runtime` migration: an agent reviews
existing tricks and adds declarations only where needed. Existing tricks with
no secret dependency run unchanged. New or edited tricks use the declaration;
a missing grant fails only that trick invocation before its code starts. The raw
endpoint remains available for existing server-process callers during the
transition, but new box-agent guidance points exclusively to the standard trick
runtime.

Done-when: a granted image-generation-style trick runs through `bbx trick`
with its declared environment variable populated, an ungranted one gets a
safe actionable refusal, an unreachable server gets `BOX_UNREACHABLE`, and no
framework output or argv contains the plaintext value.
