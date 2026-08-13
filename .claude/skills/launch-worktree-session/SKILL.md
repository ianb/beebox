---
name: launch-worktree-session
description: Use when the human wants to spin off a separate Claude session in a new worktree to pursue an idea or piece of work that's distinct from the current conversation. Triggers include "spin this off", "do this in another worktree", "start a worktree on this", "launch a session for X", "kick off X separately". The new session gets the briefing we wrote together as context — not as a plan to execute, but as the shared understanding to start from.
allowed-tools: Bash
---

# launch-worktree-session

Spin off a separate Claude Code session in a fresh worktree, seeded with a
**briefing of what we discussed** — not a plan, not a task list, not
"implement X".

## When to invoke

Only after the human has explicitly said to spin this off / start a worktree
on it. Don't volunteer this on your own — many ideas surface in conversation
that the human wants to keep talking about, not fork. Wait for the cue.

Trigger phrases include: "spin this off", "do this in another worktree",
"start a worktree on this", "launch a session for X", "kick off X
separately".

## What the briefing is

The briefing is **the shared understanding the new session needs in order to
start thinking**. It captures:

- What we were talking about and why.
- What we've ruled out, considered, or learned through discussion.
- Constraints, preferences, and prior context the new agent wouldn't
  otherwise see.
- Any uncertainty or open questions we landed on without resolving.

The briefing is **not**:

- A step-by-step plan.
- A list of files to change.
- "Go implement X." The new agent forms its own plan after reading the code.

Default close to the briefing: a line that asks the new agent to confirm
understanding and propose its approach before touching anything. Something
like:

> Before doing anything else, read the relevant code and tell me what
> you think the right approach is. I want to hear your read before we
> commit to a plan.

Adjust the wording to fit the conversation, but the spirit is constant:
_understanding first, plan second, work third._

## How the briefing reaches the new session

`launch-worktree-session` automatically wraps the briefing in
`<agent-continuation>...</agent-continuation>` with a short preamble
explaining that the message is a handoff from a sibling agent (not
direct human input). You don't need to add that framing yourself in the
briefing text — write the briefing as if you were narrating what you and
the human discussed, and the wrapper handles the meta-context. Don't
duplicate the wrapper or the "this is a handoff" language inside the
briefing.

## Flow

1. **Confirm scope with the human.** Mirror back the idea in one or two
   sentences, ask anything you're unsure about. Don't fork until they've
   said yes.

2. **Pick a worktree name.** Short, kebab-case, descriptive. Examples:
   `fix-timezone-parsing`, `gcal-service-injection`, `chat-route-cleanup`.
   Ask the human if a good name isn't obvious from the discussion.

   If this work takes ownership of an existing public or private issue, pass its
   repo-relative path with `--issue`. The launcher updates that issue's
   `workstream:` field inside the new checkout, so the issue immediately appears
   as work owned by the workstream, and the assignment lands with the eventual
   work. This is responsibility, not discovery provenance. Omit `--issue` when
   the discussion is not taking on a specific filed issue.

3. **Pick a model, and say which.** Match the model to the scope of the work,
   and always pass `--model` explicitly — omitting it inherits whatever the
   boxholder's saved default happens to be, which decides this by accident.
   - **Fable** (`claude-fable-5`) — larger, more ambiguous, or harder work: a
     feature, a refactor with design choices left open, anything spanning
     several subsystems, anything where the right approach isn't settled yet.
     Security and data-shape changes usually land here.
   - **Opus** (`opus`) — unambiguous or clerical work: a known fix with a known
     shape, a mechanical pass, cleanup, a change whose scope the briefing can
     already state completely.

   Judge by how much is _undecided_, not by how many files move. A ten-file
   rename is clerical; a two-file change resting on an unresolved design
   question is not. When it's genuinely borderline, say which way you're
   leaning and why — the boxholder cares about reserving Fable for work that
   needs it.

4. **Draft the briefing and launch it.** Write the briefing directly and
   invoke the command — don't pre-review the briefing with the human in
   the current session. The whole point of the launched session is that
   _it_ is where discussion, clarification, and approval happen. Pre-
   reviewing here just duplicates that work in the wrong place. Trust the
   briefing to be good enough; it explicitly invites the new agent to push
   back, ask questions, and propose its own approach before acting.

   Only show the briefing first if the human asked you to, or if you have
   a specific uncertainty about scope that can't be resolved in the
   launched session (rare).

   Use the heredoc form to keep the briefing readable and immune to
   quoting issues:

   ```bash
   bin/launch-worktree-session --model <model> [--issue issues/<category>/<file>.md] <worktree-name> - <<'EOF'
   <briefing text — see "What the briefing is" above>
   EOF
   ```

   Use the repo-relative `bin/launch-worktree-session` path, NOT the bare
   `launch-worktree-session` — see Script details for why (the agent Bash
   tool's PATH doesn't include the symlink).

   The `<<'EOF'` (single-quoted) prevents shell expansion inside the
   briefing. Use `<<EOF` (unquoted) only if you intentionally want to
   interpolate variables.

5. **Tell the human what happened.** One line: worktree name, **which model**,
   where it opened (new tab in Terminal.app), and that they can now switch
   over. Naming the model lets them redirect before the session gets far.

## Script details

**Invoke it as `bin/launch-worktree-session` from the monorepo root** — a
repo-relative path that works regardless of PATH. The bare
`launch-worktree-session` is symlinked onto PATH from `~/.local/bin` for the
human's interactive shell, but the agent's Bash tool runs a non-interactive
shell that does NOT have `~/.local/bin` on PATH, so the bare command fails there
with `command not found` (this recurs — always use the `bin/` path). The tracked
script is `bin/launch-worktree-session`; edit that copy. (The `~/.local/bin`
symlink is machine-local and can dangle after a repo move/rename — repoint it
with `ln -sfn "$PWD/bin/launch-worktree-session" ~/.local/bin/` if the human's
own shortcut breaks.)

Signature (all forms take the repo-relative path):

```
bin/launch-worktree-session <worktree-name> "<briefing>"
bin/launch-worktree-session <worktree-name> -            # stdin (heredoc)
bin/launch-worktree-session <worktree-name> @<file>      # from a file
bin/launch-worktree-session --model <model> <name> @<file>   # run on a specific model
bin/launch-worktree-session --no-remote-control <name> -     # opt out of Remote Control
bin/launch-worktree-session --agent codex [--model gpt-5.5] <name> -  # OpenAI Codex session
```

**`--agent codex`** launches OpenAI's codex CLI instead of Claude Code: same
worktree + box clone + installs (both launch paths call the agent-neutral
`bin/workstreams create` command), plus generated AGENTS.md
mirrors of every CLAUDE.md so codex gets the repo docs (mechanism:
`bin/CLAUDE.md` → "Codex worktree sessions"). With codex, `--model` takes
OpenAI names (`gpt-5.5` was the known-good pick when the account throttled the
default model, 2026-07 — see the `cross-model` skill); Remote Control doesn't exist
for codex and the flag is ignored; the briefing wrapper works the same. Only
use this when the human asked for a Codex session. Cleanup also differs: no
hook fires on codex exit, so the worktree lingers until `bin/workstreams sweep`
collects it once merged + clean.

**Remote Control is on by default** — the launcher passes
`claude --remote-control <worktree-name>`, so a launched session can be steered
from elsewhere (these run unattended in background tabs, and much of the
manual testing they generate happens on a phone). The session is named after the
worktree so concurrent ones stay tellable apart. `--no-remote-control` opts out.

Pass `--model <model>` (e.g. `claude-fable-5`, `opus`, `sonnet`) to spin the
worktree up on a specific model. **Always pass it** — see "Pick a model" in the
Flow. Omitting it silently inherits the boxholder's saved default, which is how
a big ambiguous task ends up on a clerical-work model.

A Fable session then follows the delegate-and-Codex-review guidance in the root
CLAUDE.md, so `claude-fable-5` buys orchestration and cross-model review, not
just a stronger single pass.

It opens a new tab in the front Terminal.app window (or a new window if none is
open), calls `bin/workstreams create <name>`, `cd`s into that checkout, and runs
`claude --name <name> --dangerously-skip-permissions "<briefing>"`. The launcher
deliberately omits Claude's native `--worktree`: the repository's SessionEnd
hook and sweep own cleanup, so exiting a named session does not ask the human to
keep or remove the worktree.

First-time macOS will prompt for Accessibility permission for Terminal
control. Mention that to the human if it happens.

## Example briefing (for a real fix)

```
We were tracing why the gmail connector misses some messages when
labels get added retroactively to old mail. Together we figured out:

- The connector uses both a seenMessageIds cap (5000) AND a Gmail
  `after:` date filter. Labeling an old message doesn't pull it in
  unless the box explicitly configured `labels` or `query`.
- issues/ already has a filed item ("Gmail sync improvements") capturing
  three options: drop the seenMessageIds cap, widen the `after:` window,
  or use the Gmail history API. The history API is the right long-term
  answer but is a bigger change.
- For this session we want to start with whichever option turns out
  to be cleanest in the actual code — that may not be obvious until
  you look at how buildQuery + seenMessageIds interact today.

Don't pick an option from the list before reading the code. Tell me
what you see and which approach the existing structure prefers; then
we'll decide together.
```

Notice: it conveys what we _understood_ together, points at the relevant
prior thinking (an issues/ entry), and explicitly invites the new agent to
think first, not act.

## Common mistakes to avoid

- **Inventing the briefing from thin air.** It should reflect what was
  actually discussed. If the human and I haven't talked through an idea,
  there's no briefing to write — say so and discuss first.
- **Writing a task list.** "1. Change X. 2. Add Y. 3. Test Z." defeats the
  whole point. The new agent should arrive at the steps, not receive them.
- **Forgetting the "don't start implementing yet" close.** Without it the
  new agent treats the briefing as a go-signal.
- **Launching before the human confirms.** Even if the discussion clearly
  pointed at "spin this off", wait for the explicit cue.
- **Omitting `--model`.** The launched session then inherits whatever default
  is saved, so the scope-to-model match happens by luck. Choose, pass it, and
  name it in the handoff line.
