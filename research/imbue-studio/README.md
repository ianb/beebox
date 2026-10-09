# Imbue Studio (announced 2026-10-01), read 2026-10-08

A dated snapshot of Imbue's "personal AI operating system" against Bee Box,
written one week after launch from public sources and one afternoon running
it from source ([hands-on.md](hands-on.md)). No waitlist access; the code is
the primary source. Per [research/AGENTS.md](../AGENTS.md) this
corpus needs no cross-model review.

| Note | Covers | Disposition or status |
|---|---|---|
| [sources.md](sources.md) | Every source read, the launch-video transcript, reception | Reception is thin: 4 HN points, no reviews |
| [architecture.md](architecture.md) | The workspace container, the desktop app, apps as windows, the right-click reference menu, self-modification, automations, data and backups | Read-out |
| [permissions-models-integrations.md](permissions-models-integrations.md) | The latchkey/detent permission gateway, provider switching, the integration surfaces, the sandbox and the encryption claim | Read-out; ten claims the code does not substantiate |
| [starter-templates.md](starter-templates.md) | The 14 `*-mind-template` repos, the manifest, the `use-template` flow, the scripted first turn | Read-out |
| [comparison.md](comparison.md) | Studio against Bee Box, ten areas, each with a disposition traced to a Bee Box file or decision | Adopt 2, adapt 4, reject 6, later 4 |
| [hands-on.md](hands-on.md) | Running Studio from source on a Mac: setup, one snag, timings, footprint, the first app the agent built | Create: 365 s; first app: under 3 min |
| [chat-app.md](chat-app.md) | The chat UI: transcript model, composer, lifecycle, progress, scroll; thirteen lessons for Bee Box's chat | Adopt 5, adapt 4, reject 3, later 1 |

## What Studio is, in practice

A persistent Claude Code (or Codex, pi, opencode, Antigravity) session living
in a git repo that is also the user's "computer": a Docker container (Linux)
or Lima VM (macOS) running supervisord, a Mithril desktop shell with windows,
a chat app, a terminal, a file viewer, a browser fleet, and whatever Flask or
FastAPI apps the agent builds under `system/apps/`. An Electron app
(`mngr/apps/minds`, v0.8.5) creates and proxies workspaces, signs the user in
to model providers, and brokers sharing over Imbue's relays. The product name
is new; the internal name is "minds" and the code is public under
`imbue-ai/default-workspace-template` and `imbue-ai/mngr`. Public is not open
source here: see "Licensing" below. A six-person team built it on top of
Imbue's coding-agent tools (mngr, latchkey, detent); none of Sculptor, Vet, or
Blueprint is part of it.

## Licensing

The launch post says "all of the base code for a studio is open source" and
the product page tags Studio "Open source". The repositories say otherwise
(checked 2026-10-08, see [sources.md](sources.md), "Licences"):

- The desktop app (`mngr/apps/minds/LICENSE`) and the workspace shell
  (`default-workspace-template/system/apps/system_interface/LICENSE`) are
  under the Fair Core License 1.0 with an MIT future licence: source
  available, no "Competing Use", MIT two years after each release.
- The workspace template repository as a whole has no licence file; GitHub
  reports none. The chat app, the skills, the hooks, and every
  `*-mind-template` starter carry no licence either. By default that is all
  rights reserved.
- The building blocks are open source: the mngr library, latchkey, detent,
  and datalib are MIT; Vet and Cloud in a Bottle are AGPL-3.0.

For this corpus that changes nothing about reading the code, and the
dispositions adapt designs, not code. It does mean no Studio code can be
copied into Bee Box, and an acknowledgement entry, if one ever lands, names
the FCL or the missing licence as its terms.

Three claims land differently in the code than in the launch copy:

- **"Zero access by default, e.g. label emails but not send or delete."**
  Default-deny is real (a credential-injecting gateway with per-scope,
  per-account rules the agent must request). The example is not expressible
  with the shipped catalog, and plain outbound `curl` from the container is
  not mediated.
- **"Switch models mid-conversation keeping context and memory."** Switching
  providers on the same harness restarts the agent; switching harness
  archives it and seeds a new one with a markdown summary the old one wrote.
- **"End-to-end encrypted."** Only account metadata syncs that way. Backups
  are restic-encrypted; running cloud workspaces are, in mngr's own audit,
  "not private from the operator", and the research-preview terms license
  user content for model training.
- **"All of the base code for a studio is open source."** The shell and the
  desktop app are Fair Core licensed and the template repo has no licence at
  all. The parts that are open source are the developer tools underneath.

## Where Studio is ahead of Bee Box

- **The empty-workspace on-ramp.** A Getting Started window, six shelves of
  42 templates, and a scripted first turn that ends on "connect your accounts
  now?" with "the user sees their own data" as done-when. Bee Box has openers
  and a decision to build starters ([2026-10-05](../../issues/decisions/2026-10-05-target-specific-underserved-use-cases.md)).
- **Right-click anywhere.** A DOM-derived reference attached to chat, on
  every app and the shell. Bee Box has selection tokens on content and a plan
  for the agent to point back at controls.
- **Integration breadth.** About 35 services by browser-captured credentials,
  custom services, MCP servers, a stealth browser. Bee Box has four
  connectors and no Slack.
- **Packaging.** A signed desktop app on macOS and Linux with staged rollout,
  a prebuilt VM image delivered as signed chunks, and a working cloud tier.

## Where Bee Box is ahead

- **One data model.** Studio's tools are separate servers with separate JSON
  stores; the hero "live to-do" cannot be queried beside anything else. Bee
  Box's connectors, todos, and views all read one card store in one git repo.
- **Scheduling.** Bee Box's scheduler has catch-up, quota deferral,
  inconclusive verdicts, and per-box logs; Studio's automations exist in the
  base but no starter uses them and the glossary still calls them future.
- **Containment of the app itself.** Boxes hold no app code; Studio puts the
  shell, chat, and hooks in the user's repo, and its own starters have already
  drifted from the base (stale 36 KB `CLAUDE.md`, six missing skills).
- **Honesty of the claims.** Bee Box's security overview and release-honesty
  decision say what a grant covers; Studio's launch wording outruns its audit,
  its terms, and its licence files.
- **Export.** A box is the repo. Studio needs a backup service and a key to
  move what the user made.

## The two things worth acting on

1. **A starter manifest and a scripted first turn** for the use-case decision:
   required connector scopes requested first by the agent, a named list of
   adaptations, and "you see your own data" as done-when. Studio's
   `template.toml` and `welcome` skill are the worked example.
   Filed: [starter manifest and scripted first turn](../../issues/features/2026-10-08-starter-manifest-and-scripted-first-turn.md).
2. **The cross-tool to-do as the first target use case.** It is Studio's hero
   demo, it is the task-inbox template's shape, and Bee Box's substrate does it
   better once a Slack connector exists.
   Filed: [cross-tool to-do as a target use case](../../issues/features/2026-10-08-cross-tool-todo-as-a-target-use-case.md).

Also filed: [modify this view from the context menu](../../issues/features/2026-10-08-modify-this-view-from-the-context-menu.md),
[grant requests the agent can file](../../issues/features/2026-10-08-agent-files-a-grant-request.md),
and a [watch item](../../issues/watch/2026-10-08-imbue-studio-public-access.md) for when Studio opens beyond the waitlist.
