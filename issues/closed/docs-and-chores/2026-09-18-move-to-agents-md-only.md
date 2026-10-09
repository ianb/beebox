---
title: "Move to AGENTS.md as the authored instruction file, in the repo and on boxes"
workstream: agents-md
resolution: implemented
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder wants one authored instruction filename once Claude Code reads AGENTS.md
---

**Closed 2026-10-09: implemented.** Repo half landed in `bee88d5d6`. Box half: registered migration `agents-md-2026-10` (plan `beebox/docs/implemented-plans/box-agents-md.md`), merged in this landing. Cleanup of the CLAUDE.md compat path is deferred (`issues/deferred/2026-10-09-retire-claude-md-box-compat.md`).

**Status 2026-10-09: the repo half is done** in `worktree-agents-md`. Boxes
remain open (see "What boxes would change" below). Findings from that work,
checked with headless `claude -p` sessions on Claude Code 2.1.296:

- The mod is on by default. A remote feature gate (`tengu_agents_md_mod`) can
  still turn it off.
- A nested `AGENTS.md` loads when the agent **reads** a file below it. A Write
  into an unread directory does not load it. A nested `CLAUDE.md` loads on
  Write and Edit too. Box agents write cards often, so this matters for the box
  half.
- When a session starts below a directory, `@` imports in that directory's
  instruction file are not expanded. `CLAUDE.md` behaves the same way.
- Repo changes: the 20 files were renamed. The generator became
  `bin/generate-codex-mirrors.ts` (skills, agents, hooks only). The Codex
  preamble moved to `bin/codex-preamble.ts`, passed as `developer_instructions`.
  `doc-check` rejects any `CLAUDE.md` in the repo.

Claude Code reads `AGENTS.md` through a built-in mod, `agents-md`
([source](https://github.com/anthropics/claude-code/tree/main/mods/agents-md)).
The boxholder wants one authored instruction filename once that lands, in the
monorepo and on boxes, instead of a Claude file plus a Codex mirror.

**Version and availability (verified 2026-09-18 against Claude Code docs):**
reading `AGENTS.md` directly requires **v2.1.277 or later**. It is generally
available, but not in every session: unavailable on Amazon Bedrock, Vertex AI,
Foundry, gateway sign-ins, telemetry-disabled clients, and the first session
after install. The documented workaround for those is to keep a `CLAUDE.md`
that imports the real file with the `@`-import syntax — which also means a hybrid is
possible if the all-or-nothing rule below is a problem. There is no
user-level `~/.claude/AGENTS.md`; personal instructions stay in
`~/.claude/CLAUDE.md`. `@path` imports work in `AGENTS.md` as in `CLAUDE.md`.

## What the mod actually does

One option, `instructionFiles`, default **`claude-md-or-agents-md`**:

- A project with **no instruction file of its own** gets its `AGENTS.md` files
  instead, "loaded exactly where and how `CLAUDE.md` would be": every
  `AGENTS.md` and `.claude/AGENTS.md` from the filesystem root down to the
  working directory, plus a nested one attached on `Read`, exactly as the
  engine attaches a nested `CLAUDE.md`.
- "Of its own" means any `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md`
  from the root down to the cwd. **One of those leaves the whole project to
  the engine and the plugin stays out.** So a half-migrated repo gets nothing:
  the switch is all-or-nothing per project.
- The organization's managed file, `~/.claude/CLAUDE.md`, and `.claude/rules`
  do not count and are unaffected.
- Other values: `claude-md-and-agents-md` (both, skipping a file already
  imported or linked), `managed-only`, and `claude-md` (today's behavior).

Downstream, an `AGENTS.md` loaded this way is a project instruction file in
every respect: same position in context, same framing, same omission rules for
agents that skip project instructions.

## What this repo would change

- **19 tracked `CLAUDE.md` files** become `AGENTS.md`. All of them, together,
  per the all-or-nothing rule above.
- `bin/generate-agents-md.ts` stops needing to mirror content — but it does
  three jobs, and only one goes away. It also embeds `.claude/rules` into the
  nearest AGENTS.md for Codex (Codex has no rules mechanism) and links
  `.claude/skills` into `.agents/skills`, plus the Codex agent TOMLs added
  2026-09-17. Keep the generator, drop the mirroring.
- `.gitignore` currently ignores `AGENTS.md` at every level as a generated
  mirror (see the comment there). That inverts: `AGENTS.md` becomes the
  tracked file, and the generator must stop writing over it.
- `doc-check`, the doc graph, and anything matching `CLAUDE.md` by name.

## What boxes would change

Boxes are not the same shape: `beebox/src/core/agent-instruction-files.ts`
says `CLAUDE.md` is authored and `AGENTS.md` is a **symlink** planted beside it
by `agent-context-mirrors.ts`. Moving a box to an authored `AGENTS.md` removes
the symlink and the two-name recognition helpers.

**Open question that gates the box half:** box agents run through the Claude
Agent SDK, not the Claude Code CLI. Whether the `agents-md` mod applies there
is unverified. If it does not, a box that drops `CLAUDE.md` loses its
instructions for its own agents — the failure would be silent and total. Verify
before touching a box.

## Sequencing

1. Confirm the mod's availability and whether it is on by default in the
   versions the boxholder and the box SDK actually run.
2. Repo first: rename all 19, invert the `.gitignore` rule, trim the
   generator, and check a Claude session and a Codex session both still see
   the right guidance (the generator's `CODEX-AGENTS-LOADED` sentinel already
   exists for that check).
3. Boxes second, and only with SDK behavior confirmed. A migration changes
   files inside every box, so it is a registered migration, not an edit.

Related: [Claude Code Mods](../../exploration/2026-09-18-claude-code-mods.md).
