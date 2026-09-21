---
title: "Check out Claude Code Mods — plugins that change the CLI's own interface and behavior"
workstream: unattached
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder shared a post about the rollout
---

Claude Code is rolling out **Mods**: plugins that customize the CLI's interface
and behavior, not just its prompts. Source of record is
[`anthropics/claude-code/mods`](https://github.com/anthropics/claude-code/tree/main/mods),
which publishes the four that ship inside the binary.

## The mechanism

A mod is a Claude Code plugin whose behavior lives in a hooks module:
`.claude-plugin/plugin.json`, a `hooks/hooks.json` naming the module, and
TypeScript exporting `register(on, options)`. Hooks are functions
`($, e, next)` over engine events — `session.start`, `command.register`,
`process.run`, `tool.call`, `prompt.context`, `ui.open`, and more. A mod can
register a slash command, open a UI pane, wrap a tool call, and change what
reaches the model.

Run one from source with `claude --plugin-dir <dir>`; test with
`claude plugin test <dir>`, which hands the test the engine's own `$` and a
plugin's `on`, with `mock.env` / `mock.store` / `mock.clock` answering the
world beneath the mod.

The four built-ins: `diff` (a `/diff` pane of the session's uncommitted
changes), `telemetry` (adds `$.telemetry` for first-party analytics rows),
`sec-default` (keeps an organization's managed settings out of reach of
installed plugins), and `agents-md` (see the separate issue below).

## Why it might matter here

- **`bin/` tooling that is currently a CLI plus a habit.** `bin/schedules`,
  `bin/workstreams`, `bin/issues`, `bin/comments` are agent-facing plumbing
  the boxholder does not use directly ("the CLI is not a user surface"). A mod
  could put the parts a person needs — a pending-comment count, an alert
  badge, a landing gate — in the session surface instead of a command someone
  has to remember to run.
- **Repo rules that are currently prose.** Several standing rules are enforced
  only by an agent remembering them: do not restart the shared router from a
  worktree, do not `--no-verify`, do not weaken a lint rule. A `tool.call`
  hook is a real enforcement point, and unlike our git hooks it can act before
  the command runs.
- **Provenance and evidence.** Exhibits, commit trailers, and the
  screenshot-evidence convention are all conventions an agent follows by hand.

## What to check before any of that

- Early access at time of writing: the design thread opened 2026-09-03 and the
  built-ins landed 2026-09-09. Availability, GA status and stability are
  unverified here.
- Does any of this reach **box agents**? They run through the Claude Agent SDK,
  not the CLI. If mods are CLI-only, this helps developers in this repo and
  does nothing for a boxholder's own box.
- Codex sessions get none of it. Anything a mod enforces has to keep working
  for a Codex worktree, or it is a rule with a hole in it.

Related: [move to AGENTS.md only](../docs-and-chores/2026-09-18-move-to-agents-md-only.md).

Sources: [mods README](https://github.com/anthropics/claude-code/tree/main/mods),
[the post that prompted this](https://x.com/Voxyz_ai/status/2099564071972450641).
