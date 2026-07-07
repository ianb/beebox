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
*understanding first, plan second, work third.*

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

3. **Draft the briefing and launch it.** Write the briefing directly and
   invoke the command — don't pre-review the briefing with the human in
   the current session. The whole point of the launched session is that
   *it* is where discussion, clarification, and approval happen. Pre-
   reviewing here just duplicates that work in the wrong place. Trust the
   briefing to be good enough; it explicitly invites the new agent to push
   back, ask questions, and propose its own approach before acting.

   Only show the briefing first if the human asked you to, or if you have
   a specific uncertainty about scope that can't be resolved in the
   launched session (rare).

   Use the heredoc form to keep the briefing readable and immune to
   quoting issues:

   ```bash
   bin/launch-worktree-session <worktree-name> - <<'EOF'
   <briefing text — see "What the briefing is" above>
   EOF
   ```

   Use the repo-relative `bin/launch-worktree-session` path, NOT the bare
   `launch-worktree-session` — see Script details for why (the agent Bash
   tool's PATH doesn't include the symlink).

   The `<<'EOF'` (single-quoted) prevents shell expansion inside the
   briefing. Use `<<EOF` (unquoted) only if you intentionally want to
   interpolate variables.

4. **Tell the human what happened.** One line: worktree name, where it
   opened (new tab in Terminal.app), and that they can now switch over.

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
```

It opens a new tab in the front Terminal.app window (or a new window if
none is open), `cd`s into the monorepo, and runs `claude --worktree <name>
--name <name> --dangerously-skip-permissions "<briefing>"`. The WorktreeCreate
hook handles git worktree setup, the cloned test box, and pnpm installs.

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

Notice: it conveys what we *understood* together, points at the relevant
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
