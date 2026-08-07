---
name: security-report
description: Generate or update callback-box's security report — the structured accounting in callback-box/docs/security-report.md and the readable callback-box/SECURITY.md derived from it. Use when the boxholder asks to regenerate, update, or audit the security report, or after changes to security-relevant surfaces (routes, auth, credentials, egress, publishing). Triggers include "update the security report", "regenerate SECURITY.md", "security report pass", "/security-report". The body of this skill IS the committed rubric — the auditable process the report claims to follow.
---

# Security report: the committed rubric

This skill is the **process** behind two committed artifacts:

- **`callback-box/docs/security-report.md`** — the *structured version*: an
  exhaustive, section-by-section accounting (every endpoint, credential,
  egress point, …) with per-item evaluation. An agent is the primary
  consumer; it is the substrate updates are adjudicated against.
- **`callback-box/SECURITY.md`** — the *final report*: the human-facing
  synthesis derived from the structured version. A reader's front door.

The honesty claim these artifacts make is a **process claim**: a reader
cannot verify the report wasn't influenced by error or malice, but they can
read this rubric, the diff of every regeneration, and the review trail.
Follow the rubric literally; where you deviate, say so in the draft.

**Never auto-commit either artifact.** The loop is: agent drafts →
boxholder reviews → commit. An agent-generated security document that
self-commits could assert false safety. The provenance header's
`reviewed-by` records the human; a draft carries `reviewed-by: DRAFT —
unreviewed` until then.

## Provenance header

Both artifacts start with an HTML comment block (SECURITY.md) or YAML
frontmatter (structured version) carrying:

```yaml
generated-by: .claude/skills/security-report/SKILL.md
generated-at-rev: <git rev the inventory reflects>
date: <YYYY-MM-DD>
model: <model id that produced the draft>
reviewed-by: <human name, or "DRAFT — unreviewed">
```

`generated-at-rev` is the **update anchor** — the claim "this accounting
reflects the tree as of this rev."

## Update procedure (the normal case)

1. Read `callback-box/docs/security-report.md`; take `generated-at-rev`.
2. Run `git diff --stat <generated-at-rev>..HEAD -- <surface map paths>`
   (the map below). Also `git log --oneline` the range for context.
3. **Adjudicate, don't re-derive**: for each changed file, decide which
   section(s) of the structured version it belongs to, read the change, and
   update only the affected items — add new items for new surfaces, edit
   changed ones, move removed ones to nothing (delete; git history is the
   archive). If a change doesn't alter the security posture, it needs no
   edit.
4. Sweep for **new surface outside the map**: `git diff --stat` the full
   range unscoped; any new route registration, `process.env` secret,
   outbound `fetch`/SDK client, or spawned process in files the map missed
   means the map is stale — update the map in this skill in the same change.
5. Re-derive any SECURITY.md paragraph whose underlying items changed.
6. Update the provenance headers (new rev, date, model,
   `reviewed-by: DRAFT — unreviewed`); present the diff to the boxholder.

**Full regeneration** (first run, or when drift is suspected): execute the
inventory below from scratch — fan out read-only subagents per category —
then reconcile against the existing structured version item by item rather
than blind-replacing it, so deliberate wording and accepted-risk rationale
survive.

## Surface map

The paths each category watches. This is what scopes the update diff; keep
it current (step 4 above).

| Category | Paths |
|---|---|
| Endpoints & auth | `callback-box/src/webapp/`, `callback-box/src/hub/`, `callback-box/pub-worker/src/` |
| Credentials | `callback-box/src/webapp/auth*`, `callback-box/src/webapp/local-users*`, `callback-box/src/webapp/auth-invites.ts`, `callback-box/src/webapp/setup-token.ts`, `callback-box/src/core/token-store.ts`, `callback-box/src/core/agent/token.ts`, `callback-box/src/core/mobile/`, `callback-box/src/core/scan/tokens.ts`, `callback-box/src/core/*-key.ts`, `callback-box/src/core/search/embeddings-key.ts`, `callback-box/src/connectors/google-token-store.ts`, `callback-box/src/connectors/google-auth.ts`, `callback-box/src/webapp/trpc/routers/admin.ts`, `callback-box/src/publish/connector-secret.ts`, `callback-box/src/lib/env.ts`, `callback-box/deploy/`, any `process.env` addition anywhere |
| Data egress | `callback-box/src/connectors/`, `callback-box/src/core/agent/`, `callback-box/src/core/transcription/`, `callback-box/src/services/`, `callback-box/src/publish/`, `callback-box/src/core/external/` |
| Internal practices | `callback-box/src/shared/ref-path.ts`, `callback-box/src/lib/file-lock.ts`, `callback-box/src/lib/card-lock.ts`, `callback-box/src/webapp/` (CSP, throttles), `callback-box/src/lib/atomic-write.ts` |
| Operational | `callback-box/deploy/`, `callback-box/src/services/tailscale-exposure.ts`, `callback-box/src/hub/` (child-env allowlist), systemd units |
| Publishing | `callback-box/src/publish/`, `callback-box/pub-worker/` |
| Clients | `ios-app/` (token storage, pairing), `callback-clerk/` (host permissions, what it sends) |

## The inventory (section order and per-item fields)

The structured version has these sections, in this order. Every item
carries these fields (as a table row or definition list — keep the fields,
the layout may fit the section):

- **What** — the item (route, credential, host, …) with `file:line`.
- **State** — one of:
  - `ok` — working as intended, no known weakness.
  - `mitigated` — a real risk with a specific committed control; name it.
  - `accepted` — a known weakness deliberately accepted; link the issue or
    the recorded decision, and say *why* it's accepted.
  - `gap` — a known weakness with no mitigation and no acceptance decision;
    link the tracking issue. A gap with no issue is not reportable — file
    the issue first.
- **Severity** — `low` / `medium` / `high`: what an attacker gains.
- **Reachability** — who can hit it: `public` (anyone who can reach the
  port), `authed` (needs a logged-in identity), `owner` (needs the
  owner/operator), `local` (needs the host machine), `unreachable`
  (theoretical; requires conditions absent on the blessed deploy path).
- **Notes** — one or two sentences; link issues with relative paths.

Severity+reachability exist so a reader can sort: a `high`/`public` gap is
a launch blocker; a `low`/`unreachable` accepted risk is a footnote.

### 1. Endpoints, auth, abilities

Every HTTP route and tRPC procedure, WS upgrade included: method+path (or
procedure), auth mechanism, where enforced (`file:line`), what it can do.
Group tRPC procedures per router where auth is uniform; break out any
procedure with weaker auth. Enumerate the
**intentionally-unauthenticated** routes as their own list, each with its
justification (setup token, CSP report sink, …) — this list is the one
readers check first. Cover the hub's own routes and the pub-worker's.
State the auth architecture once: where the global hook lives, how routes
opt out, so a reader can verify the default is authenticated.

### 2. Credentials

Every credential/secret the system creates, stores, or consumes: files at
rest (with mode), env vars, tokens. Per item: what it gates (blast radius
if stolen), where it lives, lifetime/rotation/revocation, scope
(machine-global vs per-box vs per-user vs per-device). Include positive
controls (e.g. the hub's child-env allowlist) as `mitigated` items.

### 3. Data egress

Every place data leaves the machine: destination, trigger (automatic vs
user-initiated), exactly what data (card bodies? images? audio? email?),
credential used, per-box scoping, opt-out and what breaks without it. This
section must be complete across providers — Anthropic, OpenAI, Google,
Cloudflare, Tailscale, Telegram, push services, git remotes, and any
outbound URL fetch. "We only talk to Google" was the old, wrong story;
completeness here is the section's whole value.

### 4. Internal security practices

How the code defends itself: fail-closed patterns, path-traversal
containment, throttling, CSP, locking, input validation, session
mechanics, and the **agent blast radius** (what the box agent may touch,
with which permission mode — state this plainly; it is the item readers
most need honesty about).

### 5. Operational security

The deployed server: topology, bind defaults, TLS termination, Tailscale
exposure, process isolation between boxes, secrets handling in deploy
scripts, backup/git-push destinations.

### 6. Feature-specific sections

One subsection per feature whose security shape is its own story.
Currently: **Publishing** (the bundle pipeline, the leak scan as backstop
not gate with its stated blind spots, the access gate, and the
tier-gates-viewers-not-content honesty). Add subsections as features with
their own threat shape land (e.g. a future plugin system).

### 7. Accepted risks (roll-up)

Every `accepted` item from the sections above, repeated as a flat list
with its rationale. This is the "residual risks" register a reader can
take in at a glance.

## The final report (SECURITY.md)

Derived from the structured version — never introduce a claim that isn't
backed by an item there. Shape:

1. **What this is** — two paragraphs: the system's honest posture and the
   process claim (link this skill and the structured version).
2. **Reporting a vulnerability** — how to reach the maintainer privately.
3. **Threat model in brief** — what the system is and isn't defending
   against; single-owner assumption stated plainly.
4. **What leaves your machine** — the egress section, summarized per
   provider, with the opt-outs.
5. **What the agent can do** — blast radius, plainly.
6. **Auth surface** — the default-authenticated claim + the
   intentionally-open list.
7. **Known limitations and accepted risks** — the roll-up, readable.
8. Link to the structured version for the full accounting.

Register: honest, specific, unpromotional. Weaknesses are stated as
plainly as strengths — the OpenClaw lesson is that an explicit blast-radius
doc is what earns trust, not reassurance.

## README linkage

`callback-box/README.md` keeps a short "What leaves your machine" section
(a personal-register summary) linking to SECURITY.md. When the egress
section changes materially, check the README summary still tells the
truth.
