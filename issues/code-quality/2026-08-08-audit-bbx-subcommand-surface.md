---
title: "Audit the `bbx` subcommand surface — only box-agent commands belong there"
workstream: unknown
area: beebox
needs: [decision]
labels: [cli, agent-surface]
priority: important
---

`bbx` is the box-agent-facing command surface, but operator, deploy, and dev
commands keep landing in it. [Extracting `bbx serve`](2026-08-08-extract-bbx-serve-from-the-box-cli.md)
is one instance; the pattern recurs often enough that the surface needs a
deliberate pass rather than another one-off extraction.

**62 registered top-level commands** today (73 files under
`src/cli/commands/`). Every one of them is surface an agent reads and may try to
use, and the surface is the agent's mental model of what a box *is*.

## Evidence it hasn't been reviewed

`bbx show --raw` is documented as *"Show raw XML instead of pretty-printed"*
(`src/cli/index.ts:155`). The XML card format, its loader, and the `cardworks`
package were all removed — cards are frontmatter + markdown, full stop. A flag
survives advertising a format that no longer exists.

## Rough buckets (to be settled, not assumed)

**Clearly not agent-facing** — operator/deploy/infrastructure:
`serve`, `hub`, `tick`, `scheduler`, `tailscale`, `pub`, `upgrade`, `doctor`,
`health`, `init`, `boxes`, `migrate`, `migrate-view-links`, `relink`,
`google-auth`.

**Clearly agent-facing** — what an agent does inside a box during a wakeup or
chat: `answer`, `create`, `dismiss`, `handle`, `intake`, `ls`, `mv`, `rm`,
`search`, `show`, `todos`, `triage`, `validate`, `wakeup`, `finalize`,
`reactor`, `procedure`.

**Genuinely unclear, and where the decision actually lives:** `auth`,
`connector`, `drive`, `calendar`, `scenario`, `view`, `feedback`, `retro`,
`usage`, `activity`, `status`, `push`, `scan-import`, `upload`, `trick`.
Several are things the *boxholder* runs but an agent shouldn't, which is a
different axis from "does it operate on box data."

## What to decide first

**The criterion**, before any moving. Candidates, and they don't agree:

- "Would an agent run this during a wakeup or chat?" — narrowest, probably right
- "Does it operate on box content?" — admits `migrate`, `relink`
- "Is it safe for an agent to run unsupervised?" — a safety axis, orthogonal
  (`auth` is box-scoped but the repo already forbids agents from touching
  credentials without `--agent-confirmed`)

Then: where does everything else go? One `bbx-admin`, several entry points, or
`pnpm` scripts — the [`bbx serve` issue](2026-08-08-extract-bbx-serve-from-the-box-cli.md)
raises the same question and they should be answered together.

## Constraints

- **Prod and the dev router call these.** `bbx hub` runs the live server,
  `bbx serve` is spawned per box, systemd units and `bin/router.ts` invoke them
  by name. Renames are deploy changes; sequence so prod is never mid-migration.
- **Box guidance references command names.** Box `CLAUDE.md`s, schema
  `instructions`, and the generated agent guide name commands in prose. A rename
  silently invalidates guidance the agent already absorbed — the knowledge-audit
  harness (`docs/knowledge-audits.md`) is the tool for catching that.
- Cheapest useful first step may be **hiding** non-agent commands from `bbx
  --help` rather than moving them — it shrinks the agent's surface immediately
  with no deploy risk, and separates "what agents see" from "what exists."

Related: [extract `bbx serve`](2026-08-08-extract-bbx-serve-from-the-box-cli.md).

## The other half: nobody tells *coding* agents who `bbx` is for (2026-08-17)

Boxholder: *"It's not clear to coding agents that `bbx` is only for agent-run
commands. It's not for development. It's not for users. It's for the agents to
run. We both need to audit this, and the docs."*

This is the same audit from the reader's side. The sections above ask which
commands belong on the surface; this asks **who is told what the surface is
for** — and today, an agent working in *this repo* is told nothing, so it treats
`bbx` as a general-purpose tool.

The top-line framing invites exactly that:

- `beebox/CLAUDE.md:3` — "the `bbx` CLI is the **universal** interface"
- `README.md:3` — "the `bbx` CLI is the interface"

"Universal interface" reads as *for everyone and everything*. A coding agent
that absorbs that line has no reason to think `bbx` isn't its tool too.

**Live instance, from the session that filed this.** A main-session agent
(Claude, working in the monorepo) ran `bbx health` and `bbx scheduler status`
against real boxes as ordinary diagnostics while debugging the dev server —
treating `bbx` as a developer troubleshooting tool. Nothing warned it, and
nothing in the repo's own guidance says otherwise. That is the failure this
section is about, and it is not hypothetical.

Note the asymmetry that makes this confusing rather than simple: the box-agent
guide (`src/core/agent-guide/commands.ts`) *does* carry a three-way taxonomy —
commands to reach for, the job/procedure lifecycle, and system-run commands the
agent doesn't invoke. That taxonomy exists **only inside the box**, delivered to
box agents. Coding agents in the repo never see it.

### The nuance the audit has to resolve

"`bbx` is only for agents" is the intent, but it is not literally true of the
shipped surface, and the audit should say so precisely rather than repeating a
slogan the code contradicts. Verified 2026-08-17: `bbx hub`, `bbx serve`,
`bbx init`, `bbx scheduler`, and `bbx activity` are invoked by systemd units and
`deploy/*.sh` — genuinely operator-facing, by design. So the honest statement is
per-audience, not global:

- **box agents** — the everyday surface, and the thing the intent is about
- **operators / deploy scripts / systemd** — a real, small, permanent set
- **coding agents working in this repo** — *none of it*, which is the part
  nobody has ever written down
- **end users** — none of it

### The two deliverables, per the boxholder

1. **Audit the `bbx` commands** — the surface itself, which is what the sections
   above are for.
2. **Make sure every agent working on the codebase knows this** — the docs half.
   The audience is specifically *agents developing beebox*, not end users
   and not box agents (who already get the in-box taxonomy). The place that
   reaches all of them is the repo's `CLAUDE.md` files: Codex reads generated
   `AGENTS.md` mirrors of exactly those (`bin/generate-agents-md.ts`), so one
   well-placed paragraph covers both agent families, and a paragraph placed
   anywhere else covers neither.

### What to audit on the docs side

- The "universal interface" line in `beebox/CLAUDE.md` and its `README.md`
  twin — the highest-leverage two sentences here.
- Whether the repo's agent-facing guidance should state the boundary outright,
  and where it would actually be read.
- `docs/generated/bbx-commands.md` — a full reference with no audience marking.
- Whether `bbx --help` should say who it is for, which pairs with the
  hide-non-agent-commands idea above.
- Anywhere a coding agent is likely to reach for `bbx` as a diagnostic
  (health, status, doctor) and should be pointed at something else instead —
  and whether that something else exists yet, because if the answer is "just
  don't," the guidance will lose to convenience.
