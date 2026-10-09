---
name: launch-worktree-session
description: Start a separate session in a managed worktree when the human explicitly asks to spin off distinct work. Carry the conversation's shared understanding, decisions, and authorization into the new session.
allowed-tools: Bash
---

# Launch a worktree session

Use this skill only when the human explicitly asks to spin work off into a
separate worktree or session. That request authorizes the launch; do not ask
again unless a material choice is unresolved. The main-checkout session is for
small tasks and launches: feature work leaves through this skill, never through
`EnterWorktree` in place.

`bin/launch-worktree-session --help` documents the flags and what the launcher
checks. It refuses an existing workstream name and prints that workstream's
state and next step (resume, forward manually, or pick a new name), refuses a
briefing with a skill sigil, and notes uncommitted or unlanded work the new
branch will not see. `--check-briefing` runs those checks without launching.

Before you pick a name, read `bin/workstreams list` for a workstream that
already owns the subject under another name, and resume that one instead with
`bin/workstreams resume <name> -` and the briefing on stdin.

## Choose the agent and model

The human's explicit choice or standing preference always wins. With none
expressed, the executable's bare default applies (`--agent claude`; see
`--help` for each agent's default model). Ask when the choice is materially
ambiguous; it affects capability and quota.

- `--agent claude --model claude-opus-5-5`: most implementation and
  well-scoped design work. Whenever Opus is chosen, use 5.5.
- `--agent claude --model claude-fable-5-1`: difficult reasoning, unresolved
  architecture, or large multi-track work that will delegate heavily.
- `--agent codex` (`gpt-6-sol`, or `gpt-6-astra` for harder work): an
  independent model family for cross-model review or a second opinion, or when
  Claude quota is tight.
- Small models (`gpt-6-luna`, `sonnet`, `glm-*`): bounded mechanical work
  with a clear cause or a precise specification.

## Write the briefing

The new session does not inherit this conversation. Write for the agent that
receives it, with enough concrete context that a less capable worker can
rebuild the reasoning. Look the target up first: say what it is and how it
relates to this repo, not "go find out". Include what the human wants and why;
evidence and code or document locations; decisions, ruled-out alternatives,
and constraints; open questions and assumptions to verify; private/public
boundaries; and the exact authorization state. Do not invent prior discussion
or prescribe steps the agent should derive from the code.

Authorization must survive the handoff:

- Exploratory or design work: the session reads the material, reports its
  understanding, and proposes an approach before editing.
- Approved implementation: say so, and tell it to continue to completion
  without asking again. Name the remaining gates (external messages,
  destructive cleanup, merge, deploy, a reserved choice).
- Diagnosis, review, or planning only: do not broaden it.

Name skills without a sigil ("use the finish skill"); the launcher refuses
`/finish` or `$finish` in prose. Both agents read `AGENTS.md`. Pass handoff
notes inline or by absolute path, never
`@scratch/...`, which resolves in the receiving checkout. The launcher adds the
`Workstream:` line and the `<agent-continuation>` wrapper; do not repeat them.
When the work takes on a filed issue, pass `--issue`; name the other issues of
a cluster in the briefing, and keep private issue content out of public text.

## Launch

Use the repo-relative command, options before the name, and a single-quoted
heredoc. Launch sessions one at a time.

```bash
bin/launch-worktree-session --agent <claude|codex> [--model <model>] \
  --description "<one-line scope>" [--issue <path>] [--base-ref <branch>] \
  <worktree-name> - <<'EOF'
<briefing>
EOF
```

Do not pre-review the briefing with the human unless they asked to see it or a
material scope choice cannot be left to the launched session.

## Report

Tell the human the worktree name, the agent and model with the reason, how
many sessions you launched, and that each opened in a new Terminal tab. Say
whether the briefing was delivered or needs manual forwarding (resume of a live
workstream prints the note's path).
