---
generated-by: .claude/skills/security-report/SKILL.md
generated-at-rev: 67f4d34ea59c91840d6444b907dc31ed937f8e21
date: 2026-09-03
model: claude-fable-5-1
reviewed-by: Ian
---

# Security overview

beebox is a personal assistant that a Claude Code agent operates on
your behalf: it reads your email, listens to your voice memos, edits your
files, and runs shell commands. A system like that deserves a blunt
security document, so this one leads with blast radius, not reassurance.

This is the readable overview. The reporting policy is
[`SECURITY.md`](../../SECURITY.md) at the repo root; the full accounting is
[`security-report.md`](security-report.md).

This document is **maintained by an agent, reviewed by a human**. The
process that generates it — an ordered inventory and evaluation rubric —
is committed at
[`.claude/skills/security-report/SKILL.md`](https://github.com/ianb/beebox/blob/main/.claude/skills/security-report/SKILL.md)
(repo root), and the full accounting it produces is
[`security-report.md`](security-report.md): every endpoint and
its auth, every credential and its blast radius, every place data leaves
the machine. You can't verify a security doc wasn't shaped by error or
malice, but you can read the rubric that produced it, the diff of every
regeneration, and the review header above. That's the claim this document
makes: it is auditable as a process, honest about where it isn't
verifiable as an artifact.

## Reporting a vulnerability

See [`SECURITY.md`](../../SECURITY.md) — the reporting policy lives there so
it is where GitHub and a first-time reader look for it.

## Threat model, briefly

beebox assumes a **single trusted operator** (plus, optionally, a
few invited members they personally trust). It defends the box from the
network — authentication is structurally always-on; there is no flag,
env var, or config field that disables the login wall — and it limits
what the box's own moving parts inherit: per-box processes and agent
subprocesses get an allowlisted environment that omits the
session-signing secret and other cross-box credentials. Be precise
about what that is: **env-level isolation, not OS-level.** Everything
runs as one OS user, and the secret is also a 0600 file that same-user
code could read — the stripping stops accidents and lazy exfiltration,
not a determined same-user process. It does **not** defend you from
your own agent: the agent
is the product, and it runs with real power (next section). It also does
not currently treat invited members as adversaries — membership grants
broad capability short of admin operations
([details](../../issues/code-quality/2026-08-07-member-level-writing-procedures.md)).

## What the agent can do

Plainly: the box agent runs Claude Code with `bypassPermissions` and no
tool allowlist. It can execute arbitrary shell commands as the user the
box runs as, and read or write any file in the box. Its working scope is
the box directory, and no current call site widens it beyond that — but
the scope parameter itself is unguarded caller input, and either way it
is a convention the agent operates within, not a sandbox that contains
it. Treat "what can the agent do" and "what can beebox do" as the
same question. On fresh boxes, scheduled agent runs are off by default —
nothing runs until you turn it on.

## Prompt injection — the risk we most want you to understand

beebox is, by design, an agent that reads your private data,
ingests untrusted external content, and acts with no tool allowlist.
Those three together are the well-known "lethal trifecta": text written
by someone else — an email body, a web clipping, a calendar invite, a
Telegram message, even words inside a photographed image — can reach the
agent's context and try to steer it. If that succeeds, the attacker
isn't limited to reading one card; they have whatever the agent has,
which is arbitrary shell as your box's user.

We're telling you this plainly because the honest mitigations today are
thin. There is no injection filter and no containment sandbox. What
actually reduces the risk is the shape of how you run it: it's your own
single-operator box (the blast radius is your data, not a stranger's),
scheduled processing is off until you enable it, and the few dangerous
actions — publishing, changing credentials — refuse to happen without a
human present. That's a real posture, but it's mitigation-by-how-you-
deploy, not a guarantee the agent can't be turned against you. Tighter
containment is
[tracked](../../issues/features/2026-07-20-agent-containment-allowed-directories.md)
and not yet built. Until it is, be deliberate about which untrusted
sources you connect, and don't leave the agent processing them
unattended in a box that can reach anything you'd mind losing.

## What leaves your machine

The complete inventory is
[§3 of the structured report](security-report.md#3-data-egress).
The summary:

- **Anthropic** — the core engine. Every agent turn sends its context to
  Anthropic: your prompts, and whatever box files the agent reads while
  working (cards, emails, chat history), plus uploaded and scanned
  images. Auth is your Claude subscription login; the system actively
  strips `ANTHROPIC_API_KEY` so a stray key can't take over billing.
  There is no opt-out — this is the product.
- **Transcription vendors** — voice goes to Mistral (the default),
  OpenAI Whisper, or Deepgram, per your `_config/transcription.json`.
  Live dictation streams microphone audio from your browser directly to
  the vendor under a short-lived key minted by your box. Search
  embeddings, when configured, send each card's text and your search
  queries to OpenAI. All of these are per-box configurable or omittable.
  A generic adapter proxy can also forward requests to Replicate,
  Mistral, Anthropic, or OpenAI with the box's stored key — used by
  box-local code, never automatically.
- **Google** — if you connect it: Gmail (read + **drafts only** — the
  code requests no send scope, so autonomous email sending is
  impossible today), Calendar (two-way), Drive/Sheets/Docs (two-way,
  broad `drive` scope by design). One shared OAuth token covers all
  boxes on a server — see accepted risks below.
- **Telegram** — if you connect a bot: message text in and out.
- **Web push** — notification text transits your browser's push service
  (Google/Mozilla/Apple).
- **Your git remote** — every wakeup pushes the box's full history to
  the remote *you* configured; no remote, no push.
- **Cloudflare** — only if you set up publishing. `bbx pub setup` itself
  calls Cloudflare's API to provision buckets and deploy the worker (no
  box content); box content uploads only when you interactively confirm
  a publish (below).
- **Nothing else.** The running system sends no telemetry, analytics,
  crash reports, or update checks — verified absent, not just
  unpromised. (The monorepo's developer maintenance scripts in `bin/`
  query package registries; they are not shipped and never run on a
  box.)

One caveat worth naming: the iOS app's dictation prefers Apple's
on-device recognizer, but on older systems it falls back to Apple's
cloud speech service without an app-level opt-out
([issue](../../issues/closed/bugs/2026-08-07-ios-cloud-speech-fallback-no-optout.md)).

## The authentication surface

Every box route — HTTP and the WebSocket upgrade alike — sits behind one
auth wall. A request gets in with a logged-in session (local password,
scrypt-hashed, throttled; or Google OAuth), a scoped machine credential
(mobile device token, per-box agent token, scan token), or not at all.
Box access fails closed: a box with no explicit member list is
owner-only. A corrupt credential store answers 503, never "logged out."

The deliberately unauthenticated surface is small enough to list: the
CSP violation report sink (spec-required, tightly capped), a build-info
probe (a hash and a flag), the login/static assets needed to reach the
login page, and — for its 15-minute first-run window — the setup route,
gated by a token printed only to the server console. Everything else
that skips the session wall carries its own dedicated credential
(Telegram webhook secret, diagnostic bearer key, Cloudflare Access JWT).
The full route-by-route table is
[§1 of the structured report](security-report.md#1-endpoints-auth-abilities).

## Publishing

Publishing a document is the one flow that deliberately makes box
content public, so it gets its own controls: a leak scan runs before
anything enters git history, and flipping a publication live requires a
human typing a confirmation at an interactive terminal — an agent can't
do it through the blessed path. Be clear about two things the design
says out loud: the leak scan is a **backstop, not a gate** (it can't
read prose or the inside of images — the file-by-file preview you
confirm is the real control), and a published bundle is **fully public
content** regardless of tier. Tiers gate who can *reach* a page —
`secret` means an unguessable capability URL with no login, `accounts`
means Cloudflare Access with an email allowlist — not what a viewer does
with it after loading it.

## Known limitations and accepted risks

The full register with rationale is
[§8 of the structured report](security-report.md#8-accepted-risks-roll-up).
The ones you should actually weigh:

- **First-run window**: until an owner account exists, a box with an
  exposed port is claimable for up to 15 minutes. Create the owner
  account promptly.
- **No MFA; owner recovery is host-side**: an invited member who forgets
  their password now gets a self-service reset — the owner mints a
  15-minute link from Allowed Users and the member picks their own new
  password without exposing it
  ([details](../../issues/closed/features/2026-08-07-web-password-reset-account-recovery.md)).
  The owner's own recovery is still `bbx auth set-password` on the host;
  full email self-service reset was rejected as operationally complex,
  and MFA/passkeys are deferred.
- **One Google token, broad scopes, all boxes**: per-box service policy
  is enforced in application code, not by Google. Compromise of the
  token file is fleet-wide Google access
  ([hardening direction](../../issues/features/2026-07-28-google-auth-policy-proxy.md)).
- **Boxes share a browser origin**: scripts in one box can make
  same-origin requests to a sibling box. Fine single-operator; known
  limitation otherwise.
- **Boxes share an OS user**: a box's own processes can read a sibling
  box's files and the host's shared state; the server never lets one
  box's *credentials* reach another box's data, and that is tested by a
  two-box probe in the suite and re-swept weekly
  ([§7b](security-report.md#7b-cross-box-leakage-on-a-shared-host)).
  A per-box boundary on disk is accepted for now, not for good
  ([direction](../../issues/features/2026-09-04-cross-box-filesystem-isolation.md)).
- **CSP is report-only** so far; enforcement is a staged flip.
- **Open invite links don't verify email ownership**: pin the invite to
  an email when you know it, and send invite URLs over a channel you
  trust.

Known **gaps** (tracked, not yet accepted or fixed) live in the issue
queue — at this writing they include plain-HTTP between Cloudflare's edge
and the origin on the public deploy path, two connector secret files
written without restrictive permissions, deploy-time infra config drift,
and how much capability an invited member should hold. The structured
report lists each with a pointer.

A few gaps are **tracked privately** rather than in the public queue:
where a defect is specific and unpatched enough that publishing its
exact location would be a roadmap to a live hole, we hold it until it's
fixed and name it only by class here. That's a deliberate rule, not
concealment of the *kind* of problem — the structured report says which
category is affected, just not the `file:line`. It is the mirror of the
prompt-injection section above: architectural risks we disclose loudly;
location-precise unpatched defects we disclose once they're closed.
