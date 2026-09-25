---
title: "Documentation structured like code: install and the production server"
status: active
workstream: doc-structure
issues: []
---
# Documentation structured like code: install and the production server

Third cluster under the [organizing principles](../README.md#organizing-principles).
Two subjects hide in one pile today: **installing** a beebox (three paths, by
audience) and **the one operator's production server** (provisioning,
configuration, deploying, boxes, operations, health checks). The server facts
are spread over `deploy/README.md`, `server-operations.md`, `adding-a-box.md`,
and `health-checks.md`, and they disagree with each other in three places.

**Issues addressed:** none filed. Related and left open:
[add-box targets a retired service](../../../issues/bugs/2026-08-17-add-box-script-targets-a-service-that-no-longer-exists.md),
[deploy infra drift](../../../issues/code-quality/2026-08-07-deploy-infra-drift-setup-server-not-rerun.md);
both are about the scripts, not the docs. The active
[installation story](installation-story.md) and [container-first](container-first.md)
plans cite these docs by line number; line citations go stale on any edit and
are left as they are.

## Smallest fix and budget

Smallest fix: correct the three contradictions in place (Node 22 versus 24,
`.secret.json` files versus grants, two Claude-auth stories) and stop. That
removes the wrong statements but leaves each fact with two or three homes,
which is how the contradictions arose.

Chosen: two subject directories, about 2,100 doc lines moved, roughly 200
rewritten, one manifest allowlist line, `deploy/README.md` reduced to a
directory map, and about 80 hand-repaired references.

## Stated preferences this plan trades against

The principles as written. `deploy/README.md` stays as the README for the
scripts (locality: it sits beside them), but the server facts it carried move
to `docs/server/`, since a fact about the running server is not a fact about
a script.

## What already exists

The pilot's tooling. The site publish paths for every promoted doc here are
flat (`install/`, `dev/`, `security/`), so no new stub is needed.

## Prior art (external)

None needed.

## Ontology

**Install path**: developer (from source), Docker (local or VPS), agent-led.
**Server** members, in the operator's own terms: provisioning (create and set
up the host), configuration (`.env`, service-user auth, login, access),
deploying (`deploy.sh`, rollback, the maintenance boundary), boxes (adding one
to the hub), operations (connecting, running commands, diagnostics, nightly
Claude update), health checks (the runbooks). No new nouns.

## Tracks / scope

Contradictions found by reading (2026-09-25), resolved in chunk 2:

| Fact | Says A | Says B | Truth |
|---|---|---|---|
| Node major on the server | `deploy/README.md` setup-server: "Node.js 22" | `developer-install.md`: 24, enforced | `setup-server.sh:22` `NODE_MAJOR=24` |
| Connector credentials on the server | `deploy/README.md` "Adding connector secrets": write `config/connectors/*.secret.json` | same file, env section, and `adding-a-box.md` §4, `secrets.md`: machine store plus grant; legacy files no longer read | the store |
| Claude auth for the service user | `deploy/README.md`: run `claude auth login` once | `server-operations.md`: the OAuth flow cannot complete headless; transfer credentials | unverified on the server; both kept, marked as a boxholder question |
| Restart after adding VAPID keys | `deploy/README.md` Web Push: `beebox-serve` | Systemd section: `beebox-hub` | `beebox-hub` |

Target tree and dispositions:

| Old | New |
|---|---|
| (new) | `install.md`: which path for whom; what every path shares |
| `developer-install.md` | `install/developer.md` |
| `docker-install.md` | `install/docker.md` |
| `agent-install.md` | `install/agent.md` |
| (new) | `server.md`: one operator's pipeline, not the install path; members; owned elsewhere |
| `deploy/README.md` intro, Prerequisites, Setup, create-server, setup-server, Server layout, Box package installs, Systemd units, Git-drain, Production-safe defaults, DNS and HTTPS; `server-operations.md` Server architecture | `server/provisioning.md` |
| `deploy/README.md` Environment variables, Web Push, Authentication, Google OAuth, Per-box access control; `server-operations.md` Claude Code credentials and Headless auth; `adding-a-box.md` §3 | `server/configuration.md` |
| `deploy/README.md` deploy.sh; `server-operations.md` Maintenance and replacement, Prod runs the bundle, Rolling back | `server/deploying.md` |
| `adding-a-box.md` (rest); `deploy/README.md` add-box.sh, Adding connector secrets | `server/boxes.md` |
| `deploy/README.md` prod-ssh, Production app diagnostics; `server-operations.md` Connecting, Writing scripts, Nightly updates, Diagnostic endpoints, Git-annex health | `server/operations.md` |
| `health-checks.md` | `server/health-checks.md` |
| `deploy/README.md` | rewritten: directory map, the opt-in switch, pointer to `server.md` |

## Could this be simpler?

One `server.md` file instead of a directory: 1,300 lines, the same size
problem `testing.md` had. The directory is what makes "where is the restart
command" a name walk.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Fact dropped in the split | section-hash check | zero missing before commit | clear |
| Script comments and issues cite old paths | no | repo-wide grep | clear once grepped |
| A contradiction resolved the wrong way | no | the table above cites the source of truth for each; the Claude-auth one is left open | clear (flagged) |

## Agent-flow / user-flow edge cases

Stale ref: `doc-check`. Hand-edit drift: periodic review.

## NOT in scope

`maintenance.md` (dev-repo code maintenance), `scheduler.md` (the tick
daemon), `secrets.md`, `publishing.md`, `google-setup.md` and the connector
setup docs (next cluster). The scripts themselves. `deploy/CLAUDE.md`.

## Open design questions

Which Claude-auth story is current on the server. Lean: the paste-code flow
the Docker page describes now works headless and the credential transfer is
the fallback; not verified.

## Knowledge audits

Skipped: nothing box-loaded changes.

## What will hold this after it ships

`doc-check`; periodic review.

## Implementation order

Before-run (done); chunk 1 moves with the hash check; chunk 2 rewrite and
contradiction fixes; after-run; Codex review; results here.

## Rollout shape

Questions (protocol as in the pilot; the allowed area adds
`beebox/deploy/README.md` and `beebox/docker/README.md`):

| # | Question | Key string |
|---|---|---|
| 1 | Which Node major does beebox require, and how is it enforced? | `Node 24` |
| 2 | How does a box on the production server get a connector credential? | `grant` |
| 3 | What does an empty `allowedEmails` mean? | `allowedEmails` |
| 4 | After adding a hub.json entry, what must happen, and which command adds it safely? | `hot-reload` |
| 5 | How do you roll production back, and where is the deploy history? | `deploy-history.json` |
| 6 | Which KillMode do the units need, and why? | `KillMode` |
| 7 | Which compose profile starts Caddy, and which ports? | `--profile public` |
| 8 | How is Claude Code authenticated for the service user; what if the flow cannot complete? | `.credentials.json` |
| 9 | What does nginx show during a deploy, and where are downtime windows recorded? | `windows.tsv` |
| 10 | What does `/healthz/canary` do, and why not poll it? | `canary` |

### Before (2026-09-25)

| # | Found | Steps | Cited | Locations |
|---|---|---|---|---|
| 1 | yes | 3 | developer-install.md#Prerequisites | 2, conflicting (deploy README says 22) |
| 2 | yes | 8 | adding-a-box.md#4 | 4 agreeing plus 1 conflicting (deploy README "Adding connector secrets") |
| 3 | yes | 5 | adding-a-box.md#3 | 3 (also deploy README, security-overview) |
| 4 | yes | 3 | adding-a-box.md#2 | 3 (also deploy README Systemd, server-operations) |
| 5 | yes | 3 | server-operations.md#Rolling back | 3 (also deploy README, deploy/CLAUDE.md) |
| 6 | yes | 3 | deploy/README.md#Git-drain | 1 |
| 7 | yes | 3 | docker-install.md#Public domain | 1 |
| 8 | yes | 3 | server-operations.md#Claude Code credentials | 2, conflicting (deploy README env section) |
| 9 | yes | 5 | deploy/README.md#deploy.sh | 1 |
| 10 | yes | 3 | health-checks.md#Hub health endpoints | 1 (deploy README summarizes) |

The walks found everything; none opened the second home, so the walk cannot
see a contradiction. The location column is what records them.
