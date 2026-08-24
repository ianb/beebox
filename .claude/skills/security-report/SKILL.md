---
name: security-report
description: Generate or update callback-box's security report — the structured accounting in callback-box/docs/security-report.md and the readable callback-box/docs/security-overview.md derived from it. Use when the boxholder asks to regenerate, update, or audit the security report, or after changes to security-relevant surfaces (routes, auth, credentials, egress, publishing). Triggers include "update the security report", "regenerate the security overview", "security report pass", "/security-report". The body of this skill IS the committed rubric — the auditable process the report claims to follow.
---

# Security report: the committed rubric

This skill is the **process** behind two committed artifacts:

- **`callback-box/docs/security-report.md`** — the *structured version*: an
  exhaustive, section-by-section accounting (every endpoint, credential,
  egress point, …) with per-item evaluation. An agent is the primary
  consumer; it is the substrate updates are adjudicated against.
- **`callback-box/docs/security-overview.md`** — the *readable overview*: the human-facing
  synthesis derived from the structured version. A reader's front door.

**`SECURITY.md` at the repo root is NOT generated.** It is the short,
conventional reporting policy (how to report a vulnerability, supported
versions, pointers to the two documents above) — the file GitHub recognizes and
surfaces. It is hand-maintained and stable; this skill must never rewrite it or
recreate a `callback-box/SECURITY.md`. Touch it only if a *link* here goes
stale.

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

Both artifacts carry a YAML frontmatter provenance block:

```yaml
generated-by: .claude/skills/security-report/SKILL.md
generated-at-rev: <the HEAD the reviewed report reflects>
date: <YYYY-MM-DD>
model: <model id that produced the draft>
reviewed-by: <human name, or "DRAFT — unreviewed">
```

`generated-at-rev` is the **update anchor** — the claim "this accounting
reflects the tree as of this rev." It must be the **HEAD the report
actually reflects at review time**, i.e. the commit the reviewed draft is
current against — NOT the rev an inventory was first derived from.

This distinction is load-bearing and was gotten wrong on the first
creation: the anchor was set to the pre-work rev the inventory started
from, so the *next* update's `<anchor>..HEAD` range dragged in the report
system's entire construction history as diff noise. Set it to the current
`HEAD` at draft time (step 7 does this), and on a fresh creation set it to
the **sign-off HEAD**, not wherever the inventory began. Correct anchoring
is what makes the update range == "the commits not yet reflected."

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

   **Reason by ancestry, never by commit dates.** With a correct anchor,
   every commit in `<anchor>..HEAD` is unreflected *by construction* —
   adjudicate each on its merits. Do NOT conclude a change is "already
   handled" because its commit date looks old, because it landed on
   another branch before the last report edit, or because a nearby
   cross-reference happens to look current. A merge-heavy range routinely
   contains commits *dated* before the report's own edits that were not in
   the report's tree until a later merge. If you must ask whether a
   specific commit was in the reflected tree, answer with
   `git merge-base --is-ancestor <commit> <generated-at-rev>` (true = it
   was reflected) — never a timestamp comparison. (First-run evidence: an
   updater mislabeled correctly-caught drift as a pre-existing report bug
   precisely by trusting commit-date order over ancestry.)
4. Sweep for **new surface outside the map**: `git diff --stat` the full
   range unscoped; any new route registration, `process.env` secret,
   outbound `fetch`/SDK client, or spawned process in files the map missed
   means the map is stale — update the map in this skill in the same change.
   **Also reconcile renamed/deleted map paths:** for every path the map
   names *explicitly* (not one covered only by a directory or glob entry),
   confirm it still exists — a rename is caught by a coarser entry in the
   diff, so nothing errors, and the map silently points at a dead path
   until you check. Update the table to the new path in the same change.
5. **Scan the private security tier separately.** The surface map cannot
   reach `private-issues/security/` (a different repo, gitignored mount).
   Read it directly: has any privately-tracked defect been fixed since
   the last report? A fixed one becomes ordinary public history — move it
   back to the public queue and let the report reference it directly.
   Are there new private items to reference by class?
6. Re-derive any security-overview.md paragraph whose underlying items changed —
   and expect that to be **few or none**. The two artifacts have different
   jobs: **every** security-relevant detail belongs in
   `security-report.md`; security-overview.md changes **only** when the
   reader-facing overall picture does (a new egress destination, a changed
   blast-radius claim, a new accepted risk, a materially different auth
   story). Do not feel obligated to touch security-overview.md just because you
   edited the structured report — most per-item accounting changes need no
   security-overview.md edit at all, and a change that's already represented there
   often needs no *more* exposure than it has. When security-overview.md does need
   to move, **prefer a small edit to an addition**: if an existing
   sentence can be clarified or corrected in place, do that rather than
   append new content. The structured report grows with detail; security-overview.md
   stays a tight synthesis.
7. Update the provenance headers (new rev, date, model,
   `reviewed-by: DRAFT — unreviewed`); present the diff to the boxholder.

**Full regeneration** (first run, or when drift is suspected): execute the
inventory below from scratch — fan out read-only subagents per category —
then reconcile against the existing structured version item by item rather
than blind-replacing it, so deliberate wording and accepted-risk rationale
survive.

## When to update

Anchored to events, not a calendar (there is no reliable do-at-a-cadence
process to lean on):

- **At release boundaries** — regenerate as a step in any release / cut
  that will be shown to people. This is the primary human trigger, and it
  rides something that already happens.
- **When the staleness signal fires** — `generated-at-rev` plus the
  surface map answer "have security surfaces changed since this report?"
  Surfacing that drift (a `git diff --stat <rev>..HEAD -- <map>` that
  comes back non-empty) is what tells you it's time; it converts a
  cadence you don't keep into a signal you can see. This report is also
  listed in `callback-box/docs/maintenance.md` alongside knowledge-audits
  as slow-drift maintenance.
- **On demand** — invoking `/security-report` is always the thing that
  does the update; the triggers above just say *when* to invoke it.

Deliberately **not** a cron job or a blocking commit gate: this is
judgment work under human review, so it must not fire unattended or block
unrelated commits. A scheduled *reminder* that only runs the staleness
check and notifies (never writing) is an acceptable future addition — it
automates the nudge, never the judgment.

## Surface map

The paths each category watches. This is what scopes the update diff; keep
it current (step 4 above).

| Category | Paths |
|---|---|
| Endpoints & auth | `callback-box/src/webapp/`, `callback-box/src/hub/`, `callback-box/pub-worker/src/` |
| Credentials | `callback-box/src/webapp/auth*`, `callback-box/src/webapp/local-users*`, `callback-box/src/webapp/auth-capabilities.ts`, `callback-box/src/webapp/setup-token.ts`, `callback-box/src/core/token-store.ts`, `callback-box/src/core/agent/token.ts`, `callback-box/src/core/mobile/`, `callback-box/src/core/scan/tokens.ts`, `callback-box/src/core/*-key.ts`, `callback-box/src/core/search/embeddings-key.ts`, `callback-box/src/connectors/google-token-store.ts`, `callback-box/src/connectors/google-auth.ts`, `callback-box/src/webapp/trpc/routers/admin.ts`, `callback-box/src/publish/connector-secret.ts`, `callback-box/src/lib/env.ts`, `callback-box/deploy/`, any `process.env` addition anywhere |
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

**Two calls must never be made silently — make both fail-closed and
surface them to the reviewer, never resolve them alone:**

- **`accepted` vs `gap`.** `accepted` asserts *a human deliberately chose
  to live with this* — putting words in the boxholder's mouth, in the
  direction that reads as safe. Default: **no recorded decision (a dated
  call, an issue resolution, a doc) ⇒ `gap`, not `accepted`.** If a
  weakness has a real control but no accept-decision, it is `mitigated`,
  not `accepted`. Do not mark `accepted` to describe the status quo.
- **Public issue vs private (the disclosure rule).** The repo is
  source-available, so a public issue is world-readable. Before filing a
  weakness publicly, ask: **does disclosing it hand an attacker
  materially more than reading the architecture already does?**
  - *No* — it is inherent, class-level, or evident from the design
    (prompt injection, the agent blast radius, boxes sharing an origin,
    the `secret`-tier capability URL). File **public**, and if it is
    scary, say so loudly. Concealing an architectural risk only deceives
    the operator deciding whether to trust the system.
  - *Yes* — it is a specific, unpatched defect where the disclosure *is*
    the recipe (a route + line where a check is missing, on a live
    surface). File in **`private-issues/security/`**; the public report
    references it **by class only** — no `file:line`, no link (a
    public→private link dangles and is forbidden). Such an item is
    private *until fixed*, then it becomes ordinary public history.
  - When genuinely unsure which side it falls on: **private until someone
    decides** (over-hiding costs some transparency; under-hiding hands
    out a roadmap).

  Both calls are the boxholder's to confirm — draft your classification,
  then let the human adjudicate the borderline ones at review.

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
Currently:
- **6a. Publishing** — the bundle pipeline, the leak scan as backstop not
  gate with its stated blind spots, the access gate, and the
  tier-gates-viewers-not-content honesty.
- **6b. Account lifecycle** — onboarding and recovery: the setup-token
  window, invite capabilities (pinned vs open, the email-ownership
  tradeoff), password change, the absence of web reset/MFA, and the
  member-capability tier. These rows also live structurally in §1/§2/§8;
  gather them here so the lifecycle reads as one story.

Add subsections as features with their own threat shape land (e.g. a
future plugin system).

### 7. Cross-cutting threats

Sections 1–6 are inventories — accountings of things that exist. A
threat here is a risk that does not reduce to any single row; it is
emergent from the architecture. Each entry names the attack surface (the
concrete channels) and assesses mitigations **honestly, without implying
containment that isn't there** — overstatement is worst in exactly this
section.

Currently: **7a. Prompt injection via external content** — the lethal
trifecta (agent reads private data + ingests untrusted content + acts
with no tool allowlist). Enumerate every channel by which outside content
becomes agent context (each connector, vision/OCR, transcripts, card
bodies) and state plainly that structural mitigation is thin — the real
controls are deployment-shaped (single-operator, schedules-off-by-default,
human-in-the-loop on dangerous actions), not containment. Add a threats
entry only when a second architecture-level threat earns one.

### 8. Accepted risks (roll-up)

Every `accepted` item from the sections above, repeated as a flat list
with its rationale. This is the "residual risks" register a reader can
take in at a glance.

## The readable overview (docs/security-overview.md)

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

**What reaches this document — and what doesn't.** security-overview.md is a
synthesis, not a mirror of the structured report. Its job is to give a
reader an accurate *overall picture*; it is not obligated to surface every
item, and an item it already covers rarely needs more prominence. A great
many structured-report changes leave security-overview.md untouched, and that is the
correct outcome — the pressure to "reflect the update somewhere visible" is
a trap that bloats the synthesis and buries the picture. When you do edit
it, reach for the smallest change that keeps it true: correct or clarify an
existing sentence in place before adding a new one. Length is a cost here;
the structured report is where completeness lives.

## README linkage

`callback-box/README.md` keeps a short "What leaves your machine" section
(a personal-register summary) linking to security-overview.md. When the egress
section changes materially, check the README summary still tells the
truth.
