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

`--box` takes the box root (`~/src/boxes/test1`) — there is only the one root
to pass, and the context-history ledger keys off its basename
(`src/dev/lib/audit-box.ts`). Pass an absolute path (or `~/…`), never a bare
name like `test1`, which would resolve inside the monorepo and be refused by the
nested-box guard.

By default the runner uses the box's configured engine. `--engine` overrides
that choice for the audit only, so the same definitions can be exercised
against Claude and Codex without editing `_config/box.json`. Reports include the
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
- `should_read_any` — alternative files, at least one of which the agent should
  read. Use this when generated guidance and its installed skill are equivalent
  navigation outcomes.
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

## From testing.md (to reconcile)

**Location:** Tests in `src/dev/knowledge-audits.yaml`, runner in `src/dev/knowledge-audit.ts`, reports in `src/dev/reports/`
**Run:** `pnpm knowledge-audit run [--filter <id-or-tag>]`

Knowledge audits test what the agent _knows_ rather than what the system _does_. They run prompts against a Claude agent in a box and check whether the agent answered from loaded context (knows directly), followed a doc reference (knows about), or had to search (discoverable).

**When to use:** Verifying that documentation, agent guides, and conditional rules are working — that the agent has the right information at the right time. Not for testing system behavior.

The knowledge levels and prompt-style guidance are below; the 2026-02 prompt catalog is frozen in [a report](../reports/knowledge-taxonomy-catalog-2026-02-23.md).

### Test Definition

```yaml
tests:
  - id: box-structure-inbox
    prompt: "Where would you look for unprocessed incoming items?"
    expected_level: knows_directly
    watch_for: "Names _content/inbox/ directly without searching"
    correct_contains: ["_content/inbox"]
    should_read: ["node_modules/beebox/box-docs/card-memo.md"]   # optional
    should_not_read: ["some/file.md"]              # optional
    tags: [navigation]
```

### How It Works

1. Runs the prompt via `bbx prompt` in the test box
2. Parses the session transcript to extract: files read, searches, bash commands, response text
3. Automated checks: `correct_contains` (substring match), `should_read`/`should_not_read` (file access)
4. Generates a Markdown report with results + blank assessment field for human review

Reports go to `src/dev/reports/audit-report-<timestamp>.md`.

## From knowledge-taxonomy.md (to reconcile)

## Knowledge Taxonomy

When we talk about what the agent "knows," there are distinct phenomena worth naming. These categories mix together where information lives, what retrieval strategy is needed, and what failure modes look like — but that's because they describe the distinct behaviors agents actually exhibit. Some are about the knowledge architecture (knows directly, knows about), some about retrieval effort (discoverable, deducible, researchable), and some about what goes wrong when retrieval doesn't happen (guessable, improvised). They don't form a tidy linear spectrum — each is a phenomenon you might encounter when testing or observing an agent, and a starting point for further investigation.

1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CLAUDE.md` → `.beebox/agent-guide.md`, plus any `.claude/rules/` files triggered by the current task. These answers should be immediate and accurate.

2. **Knows about** — Knows *that* something exists and *where to learn more*. The agent guide references docs or files by path (e.g., "see `node_modules/beebox/box-docs/card-memo.md`"), so the agent can follow the pointer to get details. May require multiple hops of file reading (e.g., guide → table of contents → specific doc), but each hop is straightforward traversal — the agent knows where to go next without searching or guessing. Reliability depends on whether the agent actually follows the references vs. guessing from the name alone.

3. **Discoverable** — Information is available locally but requires search or exploration to locate. For example, grepping docs for a keyword, listing directory contents, or reading config files. The agent isn't told where to look — it has to figure that out. Success depends on search strategy and how discoverable the information is.

4. **Deducible** — Requires investigation and reasoning from local artifacts. For instance, reading beebox source code to understand how a feature works, or examining multiple files to piece together a procedure. The agent may not always succeed, and different agents might reach different (plausible) conclusions from the same evidence.

5. **Researchable** — The information exists somewhere on the internet but not locally. The agent would need to use web search to find it. Examples: how a third-party API works, what format a particular standard uses, best practices for something the codebase doesn't document. Distinct from deducible because the answer can't be found by reading local files — it requires going outside the environment.

6. **Guessable** — Appears to be answerable from general knowledge, but the correct answer for beebox may differ from the common/default answer. Dangerous because the agent will sound confident. Example: guessing how the agentic loop works based on general knowledge of agent systems, when beebox has specific conventions.

7. **Improvised** — The agent constructs a plausible approach without checking if there's an established one. Unlike guessing (which is about facts), this is about strategy: the agent builds something that works but misses patterns or tools it should have used. Example: hand-parsing frontmatter with string splitting when `beebox/cards` already has a parser, or hand-rolling a card file instead of using `bbx create`. The result may actually function, which makes it harder to catch than a wrong guess — the problem is that it's not the *right* way, and it'll diverge from conventions. Often a fallback when the agent decides it can figure things out as it goes rather than looking up how things are done.

8. **Knows it doesn't know** — The agent is aware of the gap. Something is acknowledged to exist but the agent genuinely lacks access to the information. Better than guessing — the agent can say "I don't have that information" or ask. Example: connector auth secrets live in `_config/connectors/*.secret.*` — ideally these would be inaccessible to the agent (not just forbidden), so the agent knows connectors need credentials but can't read the actual values. (Today the agent *can* read these files, which makes this "deducible" rather than true "doesn't know" — a gap in the access model.) Relatedly, a box's `.claude/settings.json` permission rules don't gate engine-spawned agents at all — `runAgent` hardcodes `permissionMode: "bypassPermissions"` (`src/core/agent/run.ts`) — so those rules only shape a human's interactive Claude Code session in the box, not the wakeup/procedure/chat runs the engine drives.

9. **Does not know** — Beyond the agent's knowledge boundaries. Pursuing the question yields no answer. The agent may have given up while the information was still deducible.

### Context shifts knowledge levels

The same information can sit at different levels depending on what the agent is currently doing. In Claude Code, this happens concretely through conditional rules:

- `src/schemas/CLAUDE.md` is **knows directly** when the agent is editing files in `src/schemas/` (Claude Code auto-loads directory CLAUDE.md files). But when the agent is working on something unrelated, the same information is only **discoverable** — the agent would have to navigate to that directory and find the file.

- `.claude/rules/card-memo.md` is **knows directly** when the agent reads or edits a `*.memo.card` file (the `paths:` glob triggers loading). When working on other card types, memo-specific knowledge is **discoverable** at best.

- A guide card's compiled rules (e.g., `_content/docs/generated/intake-guide.md`) are **knows directly** when processing an intake job (the job-specific rule file references them). Outside that context, the same information is **knows about** (referenced in the agent guide's card type list) or **discoverable** (via directory listing).

This means testing should consider: what was the agent *doing* when it answered? A question about memo card structure might be "knows directly" mid-procedure but "knows about" in a cold prompt.

### How the knowledge chain works in Claude Code

The agent's context is built in layers, each corresponding to a knowledge level:

- **Always loaded** → *knows directly*: `CLAUDE.md` → `.beebox/agent-guide.md` (~128 lines of operational overview, directory layout, command summaries, card type catalog with doc references)
- **Conditionally loaded** → *knows directly, in context*: `.claude/rules/*.md` (~28 rules, triggered by `paths:` glob patterns when the agent reads/edits matching files — e.g., `card-memo.md` loads when touching `*.memo.card`). Also, directory-level `CLAUDE.md` files (e.g., `src/schemas/CLAUDE.md`) are loaded when the agent works in that directory.
- **Referenced but not loaded** → *knows about*: engine reference docs in `node_modules/beebox/box-docs/*.md` (full card type specs, command reference, procedure authoring guide, domain guides — see its `README.md` index) and box-compiled docs in `_content/docs/generated/*.md` (guide compilations, personality, box-local card type specs). The agent guide points to these by path.
- **Present but not referenced** → *discoverable*: config files, procedure definitions, guide cards. Available in the box but the agent has to find them by exploring.
- **Outside the box** → *deducible*: beebox source code (`src/cards/`, `src/schemas/`, etc., or `node_modules/beebox` from inside the box). Accessible if the agent knows where to look, but outside the box.
- **On the internet** → *researchable*: Third-party API docs, standards, libraries the codebase depends on but doesn't document locally.

## Prompt Style Effects

How you phrase a prompt changes which knowledge level the agent actually operates at. The same question can produce different behavior depending on whether the prompt encourages speed or thoroughness:

- **No qualifier** (default) — The agent decides how much effort to spend. Fine for "knows directly" and usually fine for "knows about" — the agent will typically follow a reference when it has one. Less predictable for discoverable or researchable questions, but that's not purely a downside — it also gives the agent room to judge what level of effort the specific prompt warrants. Sometimes the agent correctly decides a quick answer is fine; sometimes it correctly decides to dig deeper.

- **"Give me a quick answer"** / **"Be brief"** — Pushes the agent toward answering from what it already has in context. Lower latency, which matters for interactive experiences. Also good for testing whether something is truly "knows directly" — if the agent gets it right without reading files, the knowledge is well-placed. But increases guessing: the agent may confidently answer a "knows about" question without reading the doc, getting details wrong.

- **"Think it through"** / **"Take your time"** — Encourages the agent to follow references and reason more carefully. "Knows about" questions should reliably get doc reads. But may still not trigger exploration for discoverable questions — the agent thinks harder about what it already has rather than going looking for new information.

- **"Research this"** / **"Investigate thoroughly"** — Most likely to push the agent into exploration mode. Discoverable and even deducible questions have a better shot. But also the most expensive in tokens and time, and may lead the agent down irrelevant paths.

When testing, try the same question with different styles to see where the boundary is between "knows directly" and "knows about" — does adding "be brief" cause the agent to guess instead of looking things up? That reveals which knowledge is genuinely in context vs. just referenced.

## Test Prompt Guide

Each test prompt below is annotated with its **expected knowledge level** — what level the agent *should* be at for that question. This tells us what to look for in the response: an immediate answer (knows directly), a file read then answer (knows about), or exploration (discoverable).

When running `bbx prompt`, watch for:
- **Knows directly**: Agent answers directly without reading files → good
- **Knows about**: Agent reads the right referenced doc, then answers → good
- **Knows about but guesses**: Agent answers without reading the doc → risky, may be wrong on details
- **Discoverable**: Agent searches/explores, finds the answer → good but slow
- **Guessable**: Agent answers confidently but incorrectly → bad, indicates a documentation gap
