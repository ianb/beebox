---
name: launch-worktree-session
description: Start a separate session in a managed worktree when the human explicitly asks to spin off distinct work. Carry the conversation's shared understanding, decisions, and authorization into the new session.
allowed-tools: Bash
---

# Launch a worktree session

Use this skill only when the human explicitly asks to spin work off into a
separate worktree or session. That request authorizes the launch; do not ask for
a second confirmation unless a material choice is unresolved.

The new session does not inherit this conversation. Give it a briefing that
preserves the shared context and the human's actual authorization without
turning your own guesses into instructions.

## Prepare the launch

1. Run `bin/workstreams list` before creating anything. Inspect each matching
   workstream's description, state, action, and age.

   - Resume a recent dormant workstream that already owns the subject:

     ```bash
     bin/workstreams resume <name> - <<'EOF'
     <briefing>
     EOF
     ```

   - A live workstream cannot receive injected context from a sibling CLI
     session. `resume` focuses its tab when possible and prints
     `manual forwarding required: <path>`. Tell the human to paste that file;
     do not say the briefing was delivered.
   - `stale` means roughly 14 days without trustworthy activity. Prefer a new
     workstream unless the human wants that earlier context.
   - Use `--` before literal briefing text that begins with `-`.

2. Choose a short descriptive name using letters, numbers, `_`, or `-`. Pass
   `--description "<one-line scope>"` on every skill-driven launch. Descriptions
   appear in the workstream inventory and are limited to 160 characters.

3. If the work takes ownership of a filed public or private issue, pass its
   repo-relative path with `--issue`. This updates the issue's `workstream:`
   field inside the new checkout. For a cluster, use one anchor issue and name
   every other issue path in the briefing. Omit `--issue` when no filed issue is
   being taken on. Do not copy private issue content into public files or
   briefings that may leave its authorized context.

4. Check what source context the child needs:

   ```bash
   git status --porcelain
   git log --oneline main..HEAD
   ```

   A normal launch branches from `main`, so it cannot see uncommitted changes or
   commits that exist only on the current worktree branch. If the child needs
   those files, either land them first, describe the relevant decisions and
   findings in the briefing, or deliberately base the child on this branch.

   `bin/launch-worktree-session` does not accept `--base-ref`. For the last
   option, create the checkout first and then let the launcher reattach to it:

   ```bash
   bin/workstreams create <name> --base-ref <branch>
   bin/launch-worktree-session <launch options> <name> - <<'EOF'
   <briefing>
   EOF
   ```

   Use a branch base only when both workstreams are genuinely one line of work;
   the child then depends on an unmerged branch and both branches must land in
   order.

## Choose the agent and model

For launches driven by this skill, the default is Codex: `--agent codex`.
With no `--model`, the Codex launcher pins `gpt-5.6-sol`. Do not confuse this
skill policy with the executable's bare default, which is Claude.

The human's explicit choice or standing preference always wins. Ask when the
agent or model is materially ambiguous; model selection affects capability and
quota. Do not silently promote a task because it looks difficult.

- Claude requires an explicit `--model`; otherwise it inherits the human's
  saved CLI default. `opus` is the usual harder-work option.
- `claude-fable-5-1` and Codex `gpt-6-astra` are the top choices for genuinely
  difficult architecture, unresolved design, or judgment-heavy work. Use them
  when the human selected them, or ask first.
- Preserve model diversity where it matters. A top-model worker follows the
  repository's delegation and cross-model-review guidance.
- Remote Control is enabled by default for Claude and can be disabled with
  `--no-remote-control`. Codex has no equivalent; the flag is ignored there.

## Write the briefing

Write for the particular agent that will receive it. Preserve enough concrete
context that a less capable worker can reconstruct the reasoning rather than
guessing from a terse task label.

Include:

- what the human wants and why;
- relevant discussion, evidence, and code or document locations;
- decisions made, alternatives ruled out, and constraints;
- unresolved questions and assumptions that need verification;
- private/public boundaries and other permission limits;
- the exact authorization state.

Authorization must survive the handoff:

- For exploratory or design work, say that the session should read the relevant
  material, report its understanding, and propose an approach before editing.
- If the human already approved implementation, say so explicitly and tell the
  session to carry the work through without asking for approval again. Preserve
  any remaining gates, such as sending external messages, destructive cleanup,
  deployment, or a choice the human reserved.
- If the human authorized only diagnosis, review, or planning, do not broaden
  that into implementation.

The briefing is shared context, not a generic task list. Do not invent prior
discussion, prescribe steps that the new agent should derive from the code, or
erase useful reasoning just to make the prompt short.

The launcher adds a `Workstream:` line and wraps the briefing in
`<agent-continuation>`, identifying it as a sibling-agent handoff whose
assumptions must be verified. Do not duplicate that wrapper or claim the text is
a direct human message.

For an exploratory handoff, a useful close is:

> Before doing anything else, read the relevant code and tell the human what
> you think the right approach is. Confirm your understanding before committing
> to a plan or editing files.

For already approved implementation, use a close such as:

> The human has already authorized this implementation. Verify the briefing
> against the repository, make the change, test it in proportion to risk, and
> continue to completion without asking for renewed approval. Stop only at the
> permission boundaries stated above or if the evidence changes the scope.
> Commit in the worktree; merge to main or deploy only if the human has also
> authorized that action, as recorded in this briefing.

Example of shared context for an exploratory handoff:

> We traced missing messages to the connector's date filter: applying a label
> to older mail does not make it newer than the filter. The existing issue
> considers widening the window or using the provider's history API. We ruled
> out removing deduplication, because repeated messages would be processed again.
> The human asked for an approach, not implementation. Read the query builder
> and cursor handling, verify this diagnosis, and explain which option fits the
> current structure. Preserve the bounded scan and identify any migration need
> before proposing a change.

Use actual paths and findings from the conversation in a real briefing; do not
copy this example's diagnosis or choices into unrelated work.

Codex reads generated `AGENTS.md` files and `$skill` names; Claude reads
`CLAUDE.md` and `/skill` names. Use the vocabulary the receiving agent will
recognize.

## Launch

Use the tracked repo-relative command. The bare command may be unavailable in
an agent's non-interactive shell. Put every option before the worktree name and
use a single-quoted heredoc so shell syntax inside the briefing is not expanded.

Default Codex launch:

```bash
bin/launch-worktree-session \
  --agent codex \
  --description "<one-line scope>" \
  [--issue issues/<category>/<file>.md] \
  <worktree-name> - <<'EOF'
<briefing>
EOF
```

Claude launch after the human selects its model:

```bash
bin/launch-worktree-session \
  --agent claude \
  --model <model> \
  --description "<one-line scope>" \
  <worktree-name> - <<'EOF'
<briefing>
EOF
```

The command opens Terminal.app and creates or reattaches the managed worktree,
its isolated test box, installs, and generated agent guidance. First use may
trigger macOS Accessibility permission for Terminal control.

Do not pre-review the complete briefing with the human unless they asked to see
it or a material scope choice cannot safely be left to the launched session.

## Report the result

Tell the human the worktree name, agent and model, and that it opened in a new
Terminal tab or window. State whether the briefing was delivered or requires
manual forwarding.

Codex normally runs teardown after it exits: merged and clean work is removed;
otherwise it offers a keep/remove choice and defaults to keeping. Closing the
Terminal tab can prevent that teardown, in which case a later
`bin/workstreams sweep` handles eligible worktrees. See `bin/CLAUDE.md` for the
canonical lifecycle, resume, liveness, and cleanup behavior.
