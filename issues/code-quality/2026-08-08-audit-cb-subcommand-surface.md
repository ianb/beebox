---
title: "Audit the `cb` subcommand surface — only box-agent commands belong there"
workstream: unknown
area: callback-box
needs: [decision]
labels: [cli, agent-surface]
---

`cb` is the box-agent-facing command surface, but operator, deploy, and dev
commands keep landing in it. [Extracting `cb serve`](2026-08-08-extract-cb-serve-from-the-box-cli.md)
is one instance; the pattern recurs often enough that the surface needs a
deliberate pass rather than another one-off extraction.

**62 registered top-level commands** today (73 files under
`src/cli/commands/`). Every one of them is surface an agent reads and may try to
use, and the surface is the agent's mental model of what a box *is*.

## Evidence it hasn't been reviewed

`cb show --raw` is documented as *"Show raw XML instead of pretty-printed"*
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

Then: where does everything else go? One `cb-admin`, several entry points, or
`pnpm` scripts — the [`cb serve` issue](2026-08-08-extract-cb-serve-from-the-box-cli.md)
raises the same question and they should be answered together.

## Constraints

- **Prod and the dev router call these.** `cb hub` runs the live server,
  `cb serve` is spawned per box, systemd units and `bin/router.ts` invoke them
  by name. Renames are deploy changes; sequence so prod is never mid-migration.
- **Box guidance references command names.** Box `CLAUDE.md`s, schema
  `instructions`, and the generated agent guide name commands in prose. A rename
  silently invalidates guidance the agent already absorbed — the knowledge-audit
  harness (`docs/knowledge-audits.md`) is the tool for catching that.
- Cheapest useful first step may be **hiding** non-agent commands from `cb
  --help` rather than moving them — it shrinks the agent's surface immediately
  with no deploy risk, and separates "what agents see" from "what exists."

Related: [extract `cb serve`](2026-08-08-extract-cb-serve-from-the-box-cli.md).
