# Claude runner (Codex driving)

You are Codex. Your cross-model reviewer is Claude Code in headless print mode.

## Invocation

Capture the intended review state: `main...HEAD` covers committed branch
changes only. Include working-tree changes and new files when they are part
of the work being reviewed; name those artifacts/files in the read-list.

```bash
mkdir -p scratch
git diff main...HEAD > scratch/cross-model-review.diff   # committed branch changes; review/diff-target challenge only

cat > scratch/cross-model-prompt.txt <<'PROMPT_EOF'
…full prompt here…
PROMPT_EOF

claude -p \
  --model opus \
  --effort high \
  --setting-sources user \
  --no-session-persistence \
  --tools Read Grep Glob \
  --output-format text \
  < scratch/cross-model-prompt.txt > scratch/cross-model-out.md 2>&1
```

The shell command above is a normal foreground command. **When launching it
through Codex's exec tool, a yielded tool call is not process completion.** If
`exec_command` returns a `session_id`, Claude is still running even when
`output` is empty. Preserve that ID and poll it with `write_stdin` until the
result no longer has a `session_id` and reports an exit code. If the outer tool
wrapper yields a `cell_id`, wait on that cell too. Discarding either ID detaches
the review and makes a healthy, still-running Claude process look like a blank
review.

Use this orchestration shape in Codex API sessions (field names may be exposed
by the local exec wrapper rather than directly):

```javascript
let result = await tools.exec_command({
  cmd:
    "claude -p --model opus --effort high --setting-sources user " +
    "--no-session-persistence --tools Read Grep Glob --output-format text " +
    "< scratch/cross-model-prompt.txt",
  workdir: repoWorktree,
  yield_time_ms: 30000,
});
let review = result.output;
while (result.session_id) {
  result = await tools.write_stdin({
    session_id: result.session_id,
    chars: "",
    yield_time_ms: 30000,
  });
  review += result.output;
}
```

Do not launch a replacement merely because the first yield had no output.
First inspect exact processes:

```bash
ps -axo pid,etime,command | rg '[c]laude -p'
```

If a prior wrapper really orphaned a run, terminate only its exact PID; never
use a broad `pkill` that could kill other Claude sessions.

Run from the current worktree's repository root, so the diff and cited paths
resolve to this checkout.

**Keep `--setting-sources user`.** Without it, the nested reviewer loads
`.claude/settings.json` and fires its SessionEnd hook, which can remove a
merged, clean worktree, its cloned box, and branch. The hook also checks for
other live agents and fails closed on uncertainty; keep this flag to prevent
project hooks from registering at all.

> ⚠️ **`--tools` is variadic, so it eats a positional prompt.** `claude -p
> --tools Read Grep Glob "my prompt"` fails with *"Input must be provided
> either through stdin or as a prompt argument"* — the prompt was parsed as
> another tool name. Pipe from a file, as above.

Flag by flag:

- **`--model opus`** — default and diff reviewer. Use **`--model fable`**
  for plan mode. Honor an explicit human model override within this family.
- **`--effort high`** — the mirror of codex's `model_reasoning_effort="high"`.
- **`--no-session-persistence`** — no transcript written for a throwaway review.
- **`--tools Read Grep Glob`** — read-only by construction. No Bash means no
  permission prompt can hang a non-interactive run, and it structurally prevents
  recursion: the reviewer loads a CLAUDE.md that tells it to get a cross-model
  review, and without Bash it cannot act on that.
- **Give it the diff as a file, don't grant it git.** `git diff main...HEAD >
  scratch/cross-model-review.diff`, then name that path in the read-list. Same
  "point at the path" rule as plan mode, and it keeps the tool set read-only.

Other notes:

- **It runs fine inside Codex's `workspace-write` sandbox** — verified 2026-08-04
  via `codex exec -s workspace-write` with the launcher's flags: exit 0, macOS
  keychain auth reaches through. No extra `--add-dir` grant is needed.
- **Do NOT relocate `CLAUDE_CONFIG_DIR`** to keep writes inside the workspace.
  A fresh config dir loses auth entirely (`Not logged in · Please run /login`),
  and copying credentials into a worktree is not an option.
- **Timeout: foreground, ~5 min is typical, not a completion signal.** A real
  3-finding review of one file took 27s, but larger reviews can run longer than
  an exec tool's first yield window. Follow the session-ID polling rule above.
- Once the process actually exits, stdout is the clean final message — no
  `tokens used` tail to hunt for and no double-printing. A yielded empty stdout
  chunk is not the final message.

## Modes

Use this invocation for every mode; construct the prompt from the shared
[skill](../SKILL.md).
