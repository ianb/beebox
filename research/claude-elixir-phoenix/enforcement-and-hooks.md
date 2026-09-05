# Enforcement: Iron Laws and a 23-hook layer

**Snapshot date:** 2026-07-30. Companion to [README.md](README.md).

Their central bet is that **prose in a config file does not change agent
behaviour, and hooks do**. Everything below follows from that.

## Iron Laws — how much is actually enforced

26 numbered non-negotiables live as prose in their `CLAUDE.md`, grouped by
domain, each stated as an imperative with a one-line rationale. Two mechanisms
try to make them stick:

**Injection (`SubagentStart`).** A hook emits
`hookSpecificOutput.additionalContext` containing a condensed one-line
restatement of all 26 laws into *every* spawned subagent. The comment names the
motivation: "addresses #1 session-analysis finding: zero skill auto-loading in
subagents." Subagents don't inherit the parent's loaded skills, so this is the
only channel by which the laws reach a delegated task at all. It is advisory
text, not enforcement.

**Verification (`PostToolUse` on Edit/Write).** This is the real one, and it is
narrower than the framing suggests. **Six of 26 laws have detectors**: money-as-
float in schemas and migrations, `String.to_atom`, `raw/1` with a non-literal
argument, two-binding `from()` without `on:` (implicit cross join), unsupervised
`GenServer`/`Agent.start_link`, and `assign_new` on a hardcoded list of four
always-refresh keys. On a match it prints to stderr and `exit 2`s, which
genuinely halts the turn.

Two techniques in it are worth more than the laws themselves:

- **Blame-aware scanning.** It reads `tool_input.new_string // .tool_input.content`
  and scans *only what this edit introduced*, never the whole file. The comment
  dates the fix ("blame-unaware fires") — they got flooded by pre-existing
  violations and narrowed the scope. Good rule for any content check bolted onto
  Edit/Write.
- **Comment filtering** — matches inside `#` comments are dropped before
  reporting.

**Verdict: hybrid, oversold by its framing.** Real, blocking, false-positive-
resistant enforcement for a narrow syntactic slice; prose-and-hope for the other
20 laws, which are exactly the semantically harder ones (job idempotency,
authorize-every-event, conditional mount queries). The detectors are regex, not
AST — defeated by reformatting across lines, aliasing, or wrapping the call in a
helper. One exemption is loose enough to be near-decorative: the unsupervised-
process check exempts any file containing a `def start_link` *anywhere*.

This is why we reject a bespoke grep verifier (README R4). Our equivalent belongs
in `personal-vibe-check` as AST-aware ESLint rules, which is both more accurate
and where our culture already puts mechanical rules.

## The hook layer

23 scripts across 11 events. Most are Elixir-coupled (`mix format`, Tidewave/Ash
detection, hex dependency gating). The language-agnostic mechanisms:

| Script | Event | Mechanism worth noting |
|---|---|---|
| `route-intent.sh` | UserPromptSubmit | Content detection → one-line skill suggestion; see below |
| `error-critic.sh` | PostToolUseFailure | Escalating failure counter; see below |
| `freeze-gate.sh` | PreToolUse (Edit/Write/NotebookEdit) | Sentinel-file edit-scope lock |
| `block-dangerous-ops.sh` | PreToolUse (Bash) | `permissionDecision: deny` + `additionalContext`; fails **open** if `jq` is missing |
| `check-pending-plans.sh` | Stop | Fires only on rare signals (live background tasks / crons); silent otherwise |
| `precompact-rules.sh` / `postcompact-verify.sh` / `check-resume.sh` / `stop-failure-log.sh` | PreCompact / PostCompact / SessionStart / StopFailure | Crash-and-compaction survival |
| `log-progress.sh` | PostToolUse | Async JSONL edit metrics |

### `route-intent.sh` — the response to "prose doesn't route"

Runs on every prompt. Bails immediately on an explicit slash command. Truncates
to 4000 chars, then checks three regex categories in order, first match wins:
a GitHub PR URL or review phrasing → suggest their PR-review command; a Tidewave
`<context name="current-page">` block → suggest investigate; an Elixir stack
trace shape → suggest investigate. Dedup is one marker file per category under
a **session-scoped** state dir, so each category nags at most once per session.

The hard invariant, in both the code and its comments: **never `exit 2` here** —
a non-zero exit on `UserPromptSubmit` erases the user's prompt. Every path exits
0.

This is the "arrange context, don't automate judgment" shape: it detects and
nudges, it never acts. Which is exactly our own stated preference.

Verification status of the "~0% prose routing" claim that motivated it: see
README. The system that could produce that number exists; the number's
supporting artifact does not ship.

### `error-critic.sh` — Critic→Refiner escalation

Fires on a failing `mix` command. Keeps a per-command counter and an appended
failure log.

- **Attempt 1** — silent; a sibling hook supplies generic hints.
- **Attempt 2** — injects "REPEATED FAILURE", asks the model to diff this error
  against the previous one.
- **Attempt 3+** — injects "DEBUGGING LOOP DETECTED" with a **consolidated error
  history** grepped from the log, plus a fixed 7-step recovery instruction: stop
  retrying, re-read the *first* error, distinguish identical from cascading
  failures, fix only the first if cascading.

No LLM call in the hook — it's shell state plus templated text; the reasoning is
deferred to the model reading the injected context.

This is `bbx-debug`'s 3-fix circuit-breaker made mechanical. Ours is prose asking
the agent to notice its own loop, which is precisely the thing a looping agent is
bad at.

**Do not copy their state design.** It lives in bare `/tmp`, keyed only by the
mix subcommand string — not by session or project. Two unrelated projects both
running `mix test` share a counter, so a stale count from yesterday's session can
trip "DEBUGGING LOOP DETECTED" on your first real failure today. Their own
`route-intent.sh` gets this right by folding in the session id; the critic hook
just didn't.

### Sentinel-file gates — honest about being advisory

`freeze-gate.sh` reads `.claude/.freeze`: absent → dormant; present and empty →
all edits denied; present with path lines → only edits under a listed prefix
allowed. Denials use `permissionDecision: "deny"` plus `additionalContext`
telling the model not to retry and to ask the user instead.

The `/phx:freeze` skill toggles the sentinel **via Bash, never Edit/Write**,
specifically so the gate can't block the skill from lifting its own lock. That
same escape hatch means an agent can `rm` the file. The dependency gate has the
same shape: a `PHX_SKIP_DEPS_AUDIT=1` env prefix in the same Bash call bypasses
it entirely, with no distinction between "the human authorised this override"
and "the agent routed around a block it disliked."

Both are guardrails against *drift*, not boundaries against misbehaviour. Worth
adopting on those terms and not oversold — the value is catching an agent
wandering outside an intended blast radius, which is a real and common failure.

### Compaction and crash survival

Nothing survives in hook memory; what survives is **the on-disk plan tree**, and
the hooks are readers and writers around it at the right lifecycle points:

- `StopFailure` — Claude Code ignores this hook's exit code and output entirely
  (their earlier version emitted `exit 2`; it was a no-op). Its whole job is the
  *write*: append an "API Failure" block with a resume hint to the most recently
  modified plan's scratchpad.
- `SessionStart` — read the plan tree back, count `- [ ]` vs `- [x]`, print
  "Plan X has N remaining tasks. Resume with: …".
- `PreCompact` — detect which phase is active and reinject phase-specific rules
  via `systemMessage` (this event has no `hookSpecificOutput` context channel),
  including the scratchpad's "Dead Ends" section so failed approaches aren't
  re-attempted post-compaction.
- `PostCompact` — re-scan for unchecked items; `exit 2` + stderr telling the
  model to re-read the plan and scratchpad.

The whole design only works because their plans carry execution state as
checkboxes. Ours don't — which is the open question in README D1.

## Hook output semantics — hard-won, not documented

Their `CLAUDE.md` carries a table of which events' stdout reaches the model,
which need `exit 2` + stderr, and which are ignored outright. Every claim in it
matches an inline comment in the corresponding script, several with dated
provenance and issue numbers. There is no citation to any Anthropic doc
anywhere. This reads as knowledge accumulated by getting burned once per event
and then hard-coding the workaround with an explanation.

Useful to us as a map of where the sharp edges are. Two caveats: several claims
are pinned to specific point releases we can't verify from a checkout, and
anything version-dependent should be checked against the Claude Code we actually
run before porting logic that relies on it.

## What to take

Ordered by value, all in README's disposition tables:

1. Mechanical failure-loop detection (B1) — session-scoped, unlike theirs.
2. Verify whether our subagents inherit CLAUDE.md at all (C2) before deciding
   whether we need an injection hook.
3. Scoped edit-locks (C3), sold honestly as drift-catching.
4. Blame-aware scanning as a standing rule for future content checks (B3).

And explicitly not: their formatter/debug-statement/security-reminder hooks
(superseded by our ESLint hook, which is more precise), the dependency gate
(pnpm supply-chain auditing is a different problem with better-suited tools), and
a bespoke Iron Law verifier (R4).
