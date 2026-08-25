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

## If YOU are in a worktree: land what the new session needs first

**A new worktree branches from `main`** — `--base-ref` defaults to it, and every
launch path uses that default. So the child cannot see your branch's work. If
the thing you are spinning off builds on code, a plan doc, or an issue that
exists only in your worktree, the new session starts without it and will either
re-derive it or contradict it.

Before launching, check what you are sitting on:

```bash
git status --porcelain          # uncommitted here
git log --oneline main..HEAD    # committed here, not on main
```

Anything the new session needs must be **committed and merged to main** first
(`bin/land`, or `/finish` if the work is done). Committing alone is not enough —
the commit still lives on your branch.

Two honest alternatives when merging isn't right yet:

- **Branch the child from your work** with `--base-ref <your-branch>`. Use it
  when the two are genuinely one line of work; understand that the child then
  starts from an unmerged base and both branches have to land in order.
- **Put what they need in the briefing.** For a decision, a finding, or a file
  path, prose is often enough and needs no merge at all.

What does *not* work is assuming they will see it. This is silent: the launch
succeeds, the session opens, and the missing context only surfaces later as
duplicated or conflicting work.

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

2. **Route before creating.** Run `bin/workstreams list` and inspect the name,
   description, state, action, and age. If a recent live or dormant workstream
   already covers the subject, prefer it. A workstream marked `stale` has been
   dormant for roughly 14 days; prefer a new stream unless the boxholder wants
   that old context specifically.

   To hand new context to an existing workstream, use the same briefing forms
   as launch:

   ```bash
   bin/workstreams resume <name> - <<'EOF'
   <briefing>
   EOF
   ```

   Use `--` before literal briefing text that begins with `-`.

   A dormant workstream opens with the briefing. A live workstream cannot be
   injected from a sibling CLI session: the command focuses its tab when it can
   and prints `manual forwarding required: <path>`. Tell the human to paste that
   file. Never describe that outcome as delivered. Multiple new workstreams may
   be launched concurrently: their Git attachment queues briefly, while the
   independent setup work continues in parallel.

3. **Pick a worktree name.** Short, kebab-case, descriptive. Examples:
   `fix-timezone-parsing`, `gcal-service-injection`, `chat-route-cleanup`.
   Ask the human if a good name isn't obvious from the discussion.

   If this work takes ownership of an existing public or private issue, pass its
   repo-relative path with `--issue`. The launcher updates that issue's
   `workstream:` field inside the new checkout, so the issue immediately appears
   as work owned by the workstream, and the assignment lands with the eventual
   work. This is responsibility, not discovery provenance. Omit `--issue` when
   the discussion is not taking on a specific filed issue. The flag takes one
   path; when the work is a cluster (see `cb-pick-issues`), pass the anchor
   issue here and list every other member's path in the briefing so the new
   session's plan names the full set and `/finish` reconciles all of them.

4. **Pick an agent and model — and when it isn't clear, ASK rather than
   assume.** This is the boxholder's call, not a scope calculation you perform
   on their behalf. Getting it wrong wastes a launch and, on the Claude side,
   quota they may be conserving.

   **Codex is the default.** `--agent codex`, no `--model` (the launcher pins
   `gpt-5.6-sol` rather than inheriting stale CLI state). It is the option
   least likely to run into quota trouble, so it is where work goes unless
   there's a reason otherwise.

   - **Opus** (`--model opus`) — for somewhat harder work. The boxholder will
     usually ask for this explicitly; don't reach for it on your own.
   - **Fable** (`--model claude-fable-5`) — genuinely hard work, big
     architecture questions, and decisions that need user empathy to get right.
     Usually specified directly. **If you think something deserves Fable, ask
     — don't just launch it there.**

   **The rule when you're unsure: ask.** A one-line question ("Codex, or does
   this want Fable?") costs nothing. The exception is a standing instruction
   already given in this conversation — e.g. "I'm low on Claude quota, open
   everything in codex" — which you follow without re-asking until it's
   withdrawn.

   Judge difficulty by how much is _undecided_, not by how many files move: a
   ten-file rename is clerical; a two-file change resting on an unresolved
   design question is not. But use that to shape the question you ask, not to
   decide silently.

5. **Draft the briefing and launch it.** Write the briefing directly and
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
   # The default: Codex.
   bin/launch-worktree-session --agent codex --description "<one-line scope>" [--issue issues/<category>/<file>.md] <worktree-name> - <<'EOF'
   <briefing text — see "What the briefing is" above>
   EOF

   # When the boxholder has asked for a Claude model.
   bin/launch-worktree-session --model <model> --description "<one-line scope>" <worktree-name> - <<'EOF'
   …
   EOF
   ```

   Write the briefing for the agent that will read it. A Codex session reads
   AGENTS.md mirrors rather than CLAUDE.md, and its cross-model review command
   is `$cross-model`, not `/cross-model`.

   Use the repo-relative `bin/launch-worktree-session` path, NOT the bare
   `launch-worktree-session` — see Script details for why (the agent Bash
   tool's PATH doesn't include the symlink).

   The `<<'EOF'` (single-quoted) prevents shell expansion inside the
   briefing. Use `<<EOF` (unquoted) only if you intentionally want to
   interpolate variables.

6. **Tell the human what happened.** One line: worktree name, **which agent and
   model**,
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
bin/launch-worktree-session --agent codex [--model gpt-5.6-sol] <name> -  # OpenAI Codex session
```

Pass `--description "<one-line scope>"` on every skill-driven launch. It is
shown by `bin/workstreams list` and the workstreams app so later clerical
sessions can route related work without reconstructing the full briefing. It
is explicit rather than inferred from Markdown and is limited to 160
characters.

**`--agent codex`** launches OpenAI's codex CLI instead of Claude Code: same
worktree + box clone + installs (both launch paths call the agent-neutral
`bin/workstreams create` command), plus generated AGENTS.md
mirrors of every CLAUDE.md so codex gets the repo docs (mechanism:
`bin/CLAUDE.md` → "Codex worktree sessions"). With codex, `--model` takes
OpenAI names. If it is omitted, the launcher explicitly uses `gpt-5.6-sol`
rather than inheriting potentially stale Codex CLI state; an explicit model
still wins. Remote Control doesn't exist for codex and the flag is ignored; the
briefing wrapper works the same. **This is the default agent** — see "Pick an
agent and model". Cleanup also differs: no
hook fires on codex exit, so the worktree lingers until `bin/workstreams sweep`
collects it once merged + clean.

**Remote Control is on by default** — the launcher passes
`claude --remote-control <worktree-name>`, so a launched session can be steered
from elsewhere (these run unattended in background tabs, and much of the
manual testing they generate happens on a phone). The session is named after the
worktree so concurrent ones stay tellable apart. `--no-remote-control` opts out.

Pass `--model <model>` (e.g. `claude-fable-5`, `opus`, `sonnet`) to spin a
Claude worktree up on a specific model — never omit it on the Claude path,
where omitting silently inherits the boxholder's saved default. On the Codex
path omitting `--model` is correct: the launcher pins `gpt-5.6-sol` itself.

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
- **Deciding the model yourself when it isn't obvious.** Codex is the default;
  Opus and Fable are the boxholder's calls. Ask — don't infer one from how hard
  the work looks and launch on it.
- **Omitting `--model` on the Claude path.** The session then inherits whatever
  default is saved. (On the Codex path, omitting it is correct.)
- **Launching a Claude session by habit.** The old default was Claude; it is
  now Codex. A session opened on the wrong agent has to be closed and redone.
