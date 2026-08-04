# Codex worktree sessions

Let `bin/launch-worktree-session` spin up an OpenAI Codex CLI session in a fresh
worktree the same way it spins up Claude Code sessions today: new worktree,
cloned test box, installs, a briefing as the opening prompt — but `exec codex`
instead of `exec claude`.

Monorepo-level plan (targets `bin/` and `.claude/hooks/`, not `callback-box/src`).
It lives here because `docs/plans/` is the plans directory.

## Background / verified facts

- **Codex reads AGENTS.md, not CLAUDE.md.** Two layers, both verified against
  the installed `codex-cli 0.144.4`:
  - *Harness injection:* at session start Codex injects the chain global
    (`~/.codex/AGENTS.md`) → repo root → cwd, once, capped at
    `project_doc_max_bytes` (32 KiB default). Nothing below cwd is injected.
  - *Model behavior:* the binary's embedded system prompt instructs the model
    that AGENTS.md files "can appear anywhere within the repository", that
    their scope is the directory tree rooted at their folder, that it "must
    obey instructions in any AGENTS.md file whose scope includes" a touched
    file, and to "check for any AGENTS.md files that may be applicable" when
    working in subdirectories. So nested AGENTS.md files ARE honored —
    discovery is model-driven, like Claude Code's nested CLAUDE.md.
- **History:** a committed root AGENTS.md (blind find-replace of CLAUDE.md)
  rotted for a month and was removed in 872450eb. `.gitignore` already ignores
  `AGENTS.md`, `.agents/`, `.codex/` at every level. Drift-by-construction is
  the failure mode this plan designs against: generated fresh at spin-up,
  never committed.
- **CLI shape (0.144.4):** `codex [OPTIONS] [PROMPT]` starts the TUI with the
  prompt as the opening turn. `-m <model>`; `-C <dir>`; `-s
  read-only|workspace-write|danger-full-access`; `-a untrusted|on-request|never`;
  `--add-dir <dir>` for extra writable roots;
  `--dangerously-bypass-approvals-and-sandbox` as the blunt analog of
  `--dangerously-skip-permissions`. No `--name` analog (naming is in-TUI
  `/rename`; the resume picker filters by cwd, so the worktree path is the
  session identity). `codex remote-control` is an app-server pairing daemon,
  not per-session steering — the Claude `--remote-control` flag has no Codex
  equivalent and is dropped for Codex launches.
- **No `--worktree` in Codex.** Claude Code fires our `WorktreeCreate` hook;
  for Codex the launcher must invoke `.claude/hooks/worktree-create.sh`
  directly. The hook is already a clean contract: JSON `{name}` on stdin,
  worktree path on stdout (fd-3 dance), logs on stderr, idempotent on resume.
- **Teardown gap.** No WorktreeRemove/SessionEnd fires for a Codex session.
  Cleanup falls to `bin/worktrees sweep` (merged + clean + no active session),
  but sweep's active-session guard only looks for `claude` processes (argv +
  cwd via lsof). A live Codex session in a merged+clean worktree is currently
  sweepable out from under itself.
- **Account note:** the boxholder's ChatGPT-plan account throttled the default
  `gpt-5.6-sol` in a 2026-07-15 incident (`.claude/skills/codex/SKILL.md`);
  `-m gpt-5.5` was the known-good fallback. Interactive may behave differently;
  `--model` must be passable.

## Design

### 1. `bin/generate-agents-md.ts` — the generator

A standalone TypeScript script (run via the workspace's `tsx`), callable by
hand and from the WorktreeCreate hook.

- Enumerate tracked `CLAUDE.md` files (`git ls-files '*CLAUDE.md'`) in the
  target checkout; for each, write a sibling `AGENTS.md`.
- **No prose transformation — verbatim content.** The July rot was caused by
  blind substitution (mangled commands, pointers to nonexistent files). Each
  generated file is: a short generated-file header comment ("generated from
  CLAUDE.md at worktree spin-up — edit CLAUDE.md, not this file") + the
  CLAUDE.md content untouched. `X/CLAUDE.md` cross-references remain valid
  because those files exist in the tree.
- **Root file additionally gets a Codex preamble** (static text in the script):
  - AGENTS.md files here are generated mirrors of sibling CLAUDE.md files;
    same content, either name resolves.
  - References to Claude Code harness features — the Skill tool / `/<skill>`
    commands, subagents/the Agent tool, the memory directory,
    `<system-reminder>` semantics, `/finish`, `claude --worktree`,
    Remote Control — don't apply to Codex; ignore them. The underlying
    conventions (issue queue, commit discipline, lint rules, router URLs) all
    still apply.
  - You are already inside a worktree (name, branch `worktree-<name>`, box
    clone at `~/src/box-worktrees/<name>/test1`, URLs
    `http://localhost:3210/<name>/...`). Parameterized via a `--worktree-name`
    flag; omitted → the worktree-specific lines are omitted (usable on the
    main checkout too).
- Overwrite unconditionally (regeneration is the point). Refuse to write any
  AGENTS.md that is *tracked* in git (safety: never clobber a committed file;
  none exist today).
- Unit test alongside (`bin/generate-agents-md.test.ts`): header present, root
  preamble present, nested file verbatim, tracked-file refusal.

### 2. Hook wiring

`worktree-create.sh` gains one step after the workspace `pnpm install`:
run the generator against the new worktree (via the worktree's own
`callback-box/node_modules/.bin/tsx`, which exists by then). Runs for Claude
worktrees too — harmless (gitignored files Claude never reads) and it means a
human can hand-launch `codex` in any existing worktree and get correct docs.
Failure is non-blocking for Claude sessions but the launcher's codex path
verifies the root AGENTS.md exists before exec'ing codex.

### 3. Launcher: `--agent codex` flag

A flag on `bin/launch-worktree-session`, not a sibling script — the arg
parsing, prompt tempfile + `<agent-continuation>` wrapper, repo self-location,
and AppleScript tab logic are all agent-agnostic; only the generated
`launch.sh` body diverges.

- `--agent claude|codex`, default `claude`. Claude path byte-identical to
  today.
- `--model` maps to `codex -m`. `--remote-control`/`--no-remote-control` with
  `--agent codex`: warn-and-ignore (no Codex equivalent).
- Codex `launch.sh` body:
  1. `wt_path=$(printf '{"name":"%s"}' "$wt" | .claude/hooks/worktree-create.sh)`
     (from the monorepo root; hook is idempotent, so relaunch = resume).
  2. Verify `$wt_path/AGENTS.md` exists.
  3. `cd "$wt_path"` and:
     ```
     exec codex \
       -s workspace-write -a never \
       --add-dir "$HOME/src/box-worktrees/$wt" \
       --add-dir "$HOME/.cache/callback-box" \
       -c 'sandbox_workspace_write.network_access=true' \
       -c 'projects."'"$wt_path"'".trust_level="trusted"' \
       $model_arg "$(cat prompt_file)"
     ```
- Sandbox choice: `workspace-write -a never` rather than
  `--dangerously-bypass-approvals-and-sandbox` — strict by default. Extra
  writable roots: the box clone (outside the workspace) and the router state
  dir (bin/browse logs, pidfiles). Network on (pnpm, localhost router, web).
  Escape hatch documented, not flagged: if the sandbox proves too tight in
  practice, the bypass flag is the fallback and we'd add `--yolo`-style
  opt-in then, not preemptively.
- Trust: the `-c projects...trust_level` override avoids a first-run trust
  prompt without persisting anything into `~/.codex/config.toml`.

### 4. Sweep learns about Codex

In `bin/worktrees` sweep: alongside the existing claude checks, collect
`pgrep -x codex` pids and their cwds via the same lsof pattern; a worktree
containing a live codex cwd is skipped ("active codex session (cwd)"). No argv
check (codex argv carries no worktree name). Same addition in
`process-cleanup.ts` is NOT needed — it only reclaims vite/fastify/agent-browser
orphans, keyed off claude sessions for agent-browsers; a codex-launched
agent-browser is out of scope for v1 (bin/browse is claude-session-keyed;
noted as a known limitation).

### 5. Docs

- `bin/CLAUDE.md`: worktree-lifecycle section gains the codex path (direct
  hook invocation, AGENTS.md generation, sweep-based cleanup, no auto-remove
  on exit).
- `.claude/skills/launch-worktree-session/SKILL.md`: document `--agent codex`
  (+ model guidance: `-m` values are OpenAI models here; `gpt-5.5` known-good).
- `.gitignore` comment updated: "generated at worktree spin-up by
  bin/generate-agents-md.ts" instead of "kept local for now".

## Verify live during implementation (cheap, before declaring done)

1. Generator on this worktree: correct file set, root preamble, no mangling.
2. `codex` launch in a scratch worktree: trust prompt suppressed? prompt
   auto-submitted as first turn? AGENTS.md chain actually loaded (ask codex
   what the repo layout is)?
3. Sandbox: can it write the box clone + run `bin/browse` + hit
   `localhost:3210`?
4. Sweep dry-run with a live codex process: worktree skipped.

## Codex review outcome (2026-08-04, gpt-5.5, plan mode + self-knowledge)

Adopted:
- **Resume-path gap (High):** the hook's early-exit resume path skipped
  generation; mirrors now regenerate on BOTH hook paths.
- **tsx path (High):** hoisted workspace puts tsx at the worktree ROOT
  `node_modules/.bin` — `callback-box/node_modules/.bin/tsx` doesn't exist.
  Fixed.
- **32 KiB cap (Medium):** `-c project_doc_max_bytes=131072` added to the
  launch (root + a large nested doc approaches the default cap if codex is
  pointed at a subdir).
- **Stronger verification (Medium):** a `CODEX-AGENTS-LOADED` sentinel baked
  into the root preamble; verified via headless `codex exec` and a real TUI
  launch (session rollout showed the sentinel + correct worktree URL,
  auto-submitted prompt, no trust prompt).
- **Model guidance is account-specific (Low):** documented as a dated
  observation, not a stable fact.

Declined: codex's single-most-important change — drop the per-level mirrors
in favor of `project_doc_fallback_filenames=["CLAUDE.md"]`. The fallback only
affects the harness-injected root→cwd chain; nested discovery is model-driven
and trained on the literal name AGENTS.md, so mirrors plug into trained
behavior where a preamble instruction to "read CLAUDE.md instead" would fight
it. Mirrors cost one script + zero commit surface; the settled per-level
decision stands.

## Out of scope (v1)

- Codex-side session-end cleanup (rely on sweep).
- Remote-control analog for Codex sessions.
- `.codex/hooks.json` / plugin config per worktree.
- Box-agent (product) Codex support — this is dev-session tooling only.
