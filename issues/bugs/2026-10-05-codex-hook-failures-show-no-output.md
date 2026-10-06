---
title: "Codex sessions report \"hook failed, exit code 1\" with no output the agent can see"
workstream: codex-plugin-hooks
area: dev-tooling
labels: [codex]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder saw it in Codex dev-session transcripts
---

Codex sessions in this repo show "hook failed, exit code 1". The agent
cannot see the hook's output, so it cannot fix the cause. Example: the
`secret-field-masking` session (rollout
`2026-10-05T18-52-33-01a10e7b…`) was asked why its hook failed, and answered
that it had no output from the hook. The hook may be reporting a real problem,
such as a validation failure, in a form Codex drops.

This issue is about dev sessions. Also check whether box sessions (box agents
running on Codex, with the box's own validation hooks) have the same problem.

## Workstream update (2026-10-05)

The source plugin already had the `.beebox` guard from commit `98523aef7` on
main. The globally installed plugin still held the older August snapshot.
Removing and adding `beebox-codex@beebox` refreshed the cache from the
registered main checkout; the cached `run-bbx.sh` then matched main. Future
plugin source changes need the same refresh after landing:
`codex plugin remove beebox-codex@beebox`, then
`codex plugin add beebox-codex@beebox`. Do not repoint the global marketplace
to a worktree. Box-generated `.codex/hooks.json` also calls the copy of this
script in that box's installed `node_modules/beebox`; those boxes need a
package update to receive the readable-error change. A trusted box hook can
therefore run alongside the global plugin hook, yielding duplicate validation
feedback after both copies update. Resolve that duplication separately.

This workstream also makes the Codex plugin runner translate nonzero box
validation results into `PostToolUse` JSON `additionalContext` with exit 0.
The shared CLI's exit-2/stderr contract remains for Claude. Codex's current
PostToolUse implementation otherwise discards that stderr, as observed in
openai/codex#46455. Worktree lint-hook trust and apply_patch payload handling
remain separate work under fix direction 3.

## Root cause (2026-10-05)

The failing hook is the **Bee Box Codex plugin's box-validation hook**, not
the repo's lint hook.

- `beebox-codex@beebox` is installed globally (`~/.codex/config.toml`,
  marketplace `beebox` sourced from the main checkout's `beebox/`, cached
  2026-08-31 under `~/.codex/plugins/cache/beebox/beebox-codex/`). Its
  `hooks/hooks.json` adds SessionStart (`bbx agent-context --hook`) and
  PostToolUse on `apply_patch|Edit|Write` (`bbx validate --hook`) to **every**
  Codex session, including dev worktrees.
- Its `scripts/run-bbx.sh` walks up from the cwd and runs the first `bbx` it
  finds. In a dev worktree that is `<worktree>/beebox/bin/bbx`, which runs the
  worktree's in-progress source through tsx.
- Reproduced in `secret-field-masking`: the agent's edit made
  `beebox/src/webapp/trpc/routers/secrets.ts` import
  `../../../lib/box-time.js`, which does not exist. Every later edit's hook
  run crashed at import with `ERR_MODULE_NOT_FOUND` and exit 1. Codex showed
  only "hook exited with code 1" and gave the model none of the stderr. (The
  import is a real bug in that branch; typecheck will also catch it.)
- A throwaway `codex exec` project reproduced "SessionStart Failed" and
  "PostToolUse Failed" from the same plugin with no project hooks involved.

### Also found

- Codex runs a hook only after its file is trusted by hash
  (`[hooks.state]` in `~/.codex/config.toml`). The only trusted project hook
  is `~/src/beebox/.codex/hooks.json`. The generated
  `<worktree>/.codex/hooks.json` files are at new paths, so the
  `vibe-check lint --hook` hook probably never runs in worktree sessions.
  A probe project's untrusted hooks did not run. Verify in a real worktree.
- The plugin cache is a 2026-08-31 snapshot; it does not follow repo changes.

## Fix directions

1. The box plugin's hooks must not act in a dev checkout: `run-bbx.sh` or
   `bbx validate --hook` should exit 0 silently when the cwd is not a box.
2. A hook crash must not be silent to the model. Find Codex's hook output
   contract and report failures in a form the model sees (and for box
   sessions, make validation failures readable).
3. Make worktree lint hooks trusted, or run lint another way under Codex, and
   make the lint hook read `apply_patch` payloads.
4. Decide how the plugin cache is refreshed when the plugin source changes.

## Earlier findings (2026-10-05)

- Codex runs two hook sets in a dev worktree:
  - The generated project hook `<worktree>/.codex/hooks.json`, written by
    `bin/generate-agents-md.ts`: PostToolUse on `apply_patch|Edit|Write` runs
    `vibe-check lint --hook` (`personal-vibe-check/bin/vibe-check.ts:34-98`).
  - The global `~/.codex/hooks.json`: Stop runs `~/.claude/hooks/notify.sh`
    and Adrafinil `release`; UserPromptSubmit and SubagentStart/Stop run
    Adrafinil `acquire`/`release`.
- Run by hand with sample payloads, every one of them exits 0.
- `vibe-check lint --hook` is written for Claude Code's payload: it reads
  `tool_input.file_path` and exits 0 when it is missing. A Codex
  `apply_patch` payload probably carries the patch, not a `file_path`. If so,
  the lint hook silently lints nothing under Codex, which is a second bug.
  Verify with a real Codex payload.
- In the example, the edit that preceded the failure was to
  `beebox/docs/security-report.md`, which the lint hook skips. So a different
  hook, or the lint hook on a different file, failed.
- Codex's log (`~/.codex/logs_2.sqlite`, table `logs`) shows two hooks
  started at 23:56:56 and completed at 23:56:59 UTC in that turn, but records
  no command, exit status, or output for them.

## To investigate

1. Capture the real hook payloads and results. Wrap each hook command so it
   tees stdin, stdout, stderr, and the exit status to a file, then reproduce
   in a Codex session (edit a `.ts` file with a lint error, edit a `.md` file,
   end a turn).
2. Find the hook that exits 1, and why.
3. Find what Codex does with a hook's stdout, stderr, and exit status, and
   what it passes to the model (Codex's hook protocol may differ from Claude
   Code's `hookSpecificOutput.additionalContext` and exit-2 convention). Make
   our hooks report to Codex in a form the model sees, or document that it
   cannot.
4. Make the lint hook understand Codex `apply_patch` payloads (the files the
   patch touches).
5. Repeat for box sessions on Codex.
