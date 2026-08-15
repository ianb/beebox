# Knowledge Audits

Tests that verify what agents in a box actually know — by prompting a real box agent, watching its tool use, and checking its response. Periodic execution catches knowledge drift as schemas, prompts, and conventions evolve.

The harness lives in `src/dev/`:

- `knowledge-audit.ts` — CLI entry
- `knowledge-audits.yaml` — test definitions
- `lib/test-runner.ts`, `lib/report.ts`, `lib/session-report.ts` — internals
- `reports/` — gitignored output

## When to run

- **Immediately after adding or editing audit entries** — filtered to the
  new entries (`--filter <tag-or-id>`). A never-run audit is unverified in
  both directions: the agent may fail it, or the audit itself may be
  broken (bad `correct_contains`, wrong `should_read` path). Running is
  part of authoring, not a follow-up.
- After touching CLAUDE.md, schemas, prompts, or anything that changes what an agent should know.
- On a periodic cadence (monthly is probably enough) to catch slow drift.

`docs/maintenance.md` lists this alongside the other periodic tasks.

See `docs/reports/knowledge-audit-rerun-2026-07-03.md` for the latest full-corpus rerun record.

## Running

```bash
npx tsx src/dev/knowledge-audit.ts run --box ~/src/boxes/test1 [--filter <tag-or-id>] [--engine claude|codex]
npx tsx src/dev/knowledge-audit.ts list
```

`--box` accepts either a box package root (`~/src/boxes/test1`) or its
operational `content/` root (`~/src/boxes/test1/content`) — both resolve to the
same box, and the context-history ledger keys off the package name either way
(`src/dev/lib/audit-box.ts`). Pass an absolute path (or `~/…`), never a bare
name like `test1`, which would resolve inside the monorepo and be refused by the
nested-box guard.

By default the runner uses the box's configured engine. `--engine` overrides
that choice for the audit only, so the same definitions can be exercised
against Claude and Codex without editing `config/box.json`. Reports include the
engine and use engine-qualified default filenames. Codex behavior is captured
from the validated live app-server event stream; private rollout files are not
parsed. Codex does not expose Claude-equivalent per-turn context snapshots on
that surface, so Codex reports deliberately omit the context baseline rather
than presenting incomparable usage as parity.

## Recording results

After running audits, **update the status comments in `knowledge-audits.yaml`** with the date and results. Each test section (e.g., `# === Don't Drop Important Information ===`) should have a `# Status (YYYY-MM-DD):` comment noting:

- How many tests pass/fail
- Any notable failure patterns (turn limits, tool issues, knowledge gaps)
- What fixed previous failures (if relevant)

The status comment is the durable record. Reports in `reports/` are gitignored and ephemeral — they're a working artifact, not a result log.

## Context size

Each report entry shows a **Context** line — the loaded-context size the box
agent carried during that audit, read from the session log's per-turn `usage`
(summed across `input + cache_creation + cache_read`, since prompt caching
leaves raw `input_tokens` tiny). The *initial* number is the always-on baseline
the box pays every turn (system prompt + agent-guide + box CLAUDE.md + tool
schemas); *peak* and *added* show how much answering grew it. A `knows_directly`
/ 0-read audit doubles as a baseline gauge: trim a box's always-on context, re-
run, watch *initial* drop. Logic lives in `lib/context-usage.ts`.

Every run also appends these numbers to **`src/dev/context-history.yaml`** — a
committed ledger keyed by box → audit id → entries, each stamped with the date,
the box's HEAD, and the monorepo's HEAD. The file's git history is the trend
line: a CLAUDE.md trim that drops the baseline shows up as a diff. (`boxCommit`
is the box's HEAD *before* the harness regenerates docs — stable for a current
box, but the throwaway worktree box clone is behind upstream templates, so its
hash moves each run.) Logic lives in `lib/context-history.ts`.

## Test structure

Each entry in `knowledge-audits.yaml` has these fields:

- `prompt` — what to ask the agent.
- `expected_level` — one of:
  - `knows_directly` — should answer without reading any files.
  - `knows_about` — should know which docs to read, then answer.
  - `discoverable` — should be able to find the answer by exploring the filesystem.
- `correct_contains` / `correct_contains_any` — strings that must appear in the response.
- `correct_matches` — case-insensitive regexes that must match the response; use
  when the required relationship has legitimate wording variation that a list
  of exact substrings would overfit.
- `cards_contain` — strings that must appear in card files created by the agent.
- `should_read` — files the agent should read before answering.
- `max_turns` — override the default 10-turn limit (use for tests requiring multi-step card creation).
- `tags` — for filtering with `--filter`.
- `context_dir` — box-relative subdirectory to run the agent from. Sets the SDK's `cwd` there and adds the box root to `additionalDirectories`, mirroring how a chat session bound to a landmark is spawned. Use to audit that the subdirectory's `CLAUDE.md` (and its `@MAP.md` import) actually load into the agent's context at session start.
- `fixture` — map of box-relative path → file content, written before the test and removed afterward. Used to stage a `CLAUDE.md` (or any other file) without checking it into the box. Combined with `context_dir`, this lets a single audit set up its own landmark-style scratch directory.
- `chat_mode` — when true, the agent runs with `CHAT_SYSTEM_PROMPT` instead of the default working-directory prompt. Use for tests that audit chat-mode knowledge — the agent in a chat session sees the chat prompt's tag descriptions (`<speech>`, `<chat-app>`, `<ack>`, `<callout>`, `<schedule>`, etc.), so a non-chat-mode audit can't legitimately expect direct knowledge of those. If the test prompt declares `narration="on"` via a `<chat-app>` snapshot, `NARRATION_OVERLAY` is also appended — mirroring what `ChatSession.resolveSystemPrompt` does when narration is enabled on the session.
- `response_not_contains` — list of substrings that must NOT appear in the agent's response. Useful for testing prompt overrides: e.g. the narration overlay tells the agent not to emit `<speech>` even when the user spoke; the audit can assert this directly.

## Interpreting failures

Common failure patterns and what they mean:

- **Hits `max_turns`** — the agent didn't converge. Either the prompt is ambiguous, the right docs aren't loadable from the agent's perspective, or the task is too multi-step for the default 10-turn limit. Try `max_turns: 20` first; if that doesn't help, the prompt or the underlying knowledge is the problem.
- **Tool issues** — the agent tried to use a tool that's not available in this box, or used an available tool wrong. Usually means a CLAUDE.md or rule file is misleading.
- **Knowledge gap** — the agent answered confidently but wrong. The doc that should have taught the right answer either doesn't exist, isn't loaded into the agent's context, or contradicts itself.
- **Reads wrong files** — `should_read` is wrong, or the doc structure changed and the agent is following a stale pointer.

When fixing failures, prefer changing docs/prompts to changing the test — the test is asserting an expectation about agent behavior, and silently weakening it defeats the point.
