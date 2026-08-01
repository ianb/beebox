# Measurement: how they score a skill corpus

**Snapshot date:** 2026-07-30. Companion to [README.md](README.md).

The part of `claude-elixir-phoenix` with no analogue on our side at all. Two
layers: a cheap deterministic structural scorer that gates CI, and an expensive
LLM trigger eval that runs on demand.

## Layer 1 — structural scoring (`lab/eval/`)

Eight dimensions, dispatched from `scorer.py`, each a thin loop over `EvalCheck`
assertions resolved by ~24 matchers in `matchers.py`. **Zero LLM calls** — it is
all regex, line counts, YAML parsing, and filesystem existence checks. Composite
is a weighted mean; CI fails below 0.95.

| Dimension | What it mechanically checks |
|---|---|
| completeness | Named headings exist; an "Iron Laws" section contains ≥N bullet/numbered items; required frontmatter fields parse |
| accuracy | Every `/phx:foo` reference, `subagent_type:` name, and `references/*.md` path resolves to a real file on disk |
| conciseness | Raw line counts vs target±tolerance; per-section line caps |
| triggering | Description char-length window; domain-keyword hits; "starts with a verb" + contains "Use when…" regex |
| safety | Iron Laws present; a dangerous-pattern regex list; an `AskUserQuestion` ≤4-options check |
| clarity | Ratio of imperative/numbered/table lines to prose lines; cross-section 5-gram duplication; `Step N` numbering gaps |
| specificity | Ratio of concrete tokens (backticks, tables, file paths, CLI flags) to vague phrases ("consider", "it depends", "might want to") |
| behavioral | **Neutral 1.0 by default** — only reads a cached trigger-eval result when explicitly enabled |

That last row is the design decision worth noting: the free, fast, always-on CI
gate deliberately refuses to fold in a stale paid-LLM number. The expensive
signal is opt-in and separately cached.

**Portability.** The mechanics are ~80% drop-in for any corpus — the matchers
only need a `{name: description}` map and section headings. What is 100%
Elixir-specific is the *payload*: a 46-word domain-keyword list, a
dangerous-pattern list (`String.to_atom`, `raw/1`, `MIX_ENV=prod`), per-skill
classification rules naming their own 51 skills, and an agent-roster set. All of
those are already parameterisable via check options, so replacing them is
config, not code.

Two mechanically interesting checks worth stealing independent of everything
else:

- **`askuserquestion_option_limit`** — encodes a Claude Code UI limit (≤4
  options), not a domain fact. Portable as-is to any corpus whose skills call
  that tool.
- **`valid_file_refs`** — every `references/…` path in a skill must resolve.
  We have the same class of check for docs (`doc-check`), but it does not cover
  `.claude/skills/`.

## Layer 2 — trigger accuracy (`lab/eval/trigger_scorer.py`)

The measurement that matters. Per skill, a hand-authored JSON fixture lists
`should_trigger` and `should_not_trigger` prompts. The scorer shells out to
`claude -p --model claude-haiku-4-5`, hands it *every* skill's name and
description plus one test prompt, and asks which skill it would route to (≤3
names, or "none"). Hit = the skill appears for a `should_trigger` prompt and is
absent for a `should_not_trigger` prompt — so it measures **recall and precision
against the whole corpus**, catching the case where a skill triggers on things
that belong to a sibling.

Pass bar: 0.75 accuracy, 0.80 precision, 0.60 recall. Cost: ~$1.50 and ~60
minutes for 51 skills on Haiku.

Two design choices worth copying:

- **Fixture-set validation hard-fails** if the fixture set doesn't exactly match
  the skill set — no missing files, no orphans. Cheap way to stop a corpus and
  its tests silently diverging.
- **Per-model result caches** so a Haiku baseline and a Sonnet baseline never get
  conflated when comparing judges.

We already own a better version of this. `.claude/skills/skill-creator/` ships
`scripts/run_eval.py`, `scripts/improve_description.py`, a grader subagent, an
analyst pass that flags non-discriminating and high-variance assertions, and a
trigger-eval query generator. We have never run it on our 16 skills. **That gap
is a routine, not a tooling problem** — see disposition A2.

## The description tournament (`lab/tournament/`)

Targets skills that pass structural eval but sit under 75% trigger accuracy. It
optimises the frontmatter `description` **only** — not the body.

Per pass: a critic (finds routing weaknesses, forbidden from proposing fixes) →
an author (rewrites under constraints: ≤250 chars, starts with a verb, contains
"Use when…") → a synthesiser (given both as neutral randomised X/Y, merges) →
a 3-judge panel ranking a randomised proposal set → Borda count, ties breaking
toward the incumbent. Converges when the incumbent wins twice consecutively;
hard ceiling 20 passes. **The winner is re-validated against the structural
checks and reverted if it fails** — a real safety net against the tournament
producing something unusable.

Caveat: all four roles run on Haiku. The "panel of judges beats one big model"
framing implies model diversity they don't actually have — only prompt-role
diversity and sampling variance.

Evidence it worked is the best in the repo: per-skill before/after deltas in the
CHANGELOG, plus a disclosed contamination bug (209 routing-hint annotations
leaking answers into their own eval prompts, inflating scores; average held ~91%
after stripping). The self-catch is the credible part.

## Session analytics — sophisticated, and entirely manual

Three tiers of slash command, all `disable-model-invocation: true`, reading
Claude Code session data (via a third-party `ccrider` MCP for the main pipeline;
a later mode reads `~/.claude/projects/*.jsonl` directly). Scoring lives in a
1766-line `compute-metrics.py`.

Metrics that are genuinely non-obvious:

- **Friction score** — a sigmoid over six weighted signals: error/tool ratio,
  retry loops (same Bash command prefix 3+ times consecutively), user corrections
  (regex for "no,", "wrong", "instead", "actually", "that's not"), approach
  changes (dominant-tool shifts across session quarters), compactions,
  interrupted requests.
- **Token/context economics** — parses `message.usage` blocks, splits
  cache_creation vs cache_read by TTL, and *infers* compaction events (prompt
  drop >40%) and cache-decay events (cache_read drop >50% not explained by
  compaction).
- **Skill effectiveness** — for each skill invocation, look at the next ≤50 tool
  calls until the next invocation; classify as effective / friction / no_action /
  mixed based on subsequent edits, test runs, errors, and corrections.
- **Auto-load gap detection** — `proactive_trigger_rate == 0` while
  `invocation_count >= 5` and the skill is model-invocable, i.e. *a skill that
  only ever fires when a human types its name*. Requires OTel
  `skill_activated` events with an `invocation_trigger` field; when unavailable
  it records `"unknown"` and explicitly refuses to guess, on the grounds that
  bucketing unknowns as user-slash would hide the very gap being measured.

`skill-monitor` scores effectiveness as
`action_rate − (0.3 × avg_post_corrections)` with **type-aware thresholds** —
a checking skill like `verify` is *expected* to have a low action rate, since
success means "confirmed nothing needs doing." Flagging without that distinction
would be noise. Their analyzer agent is read-only by construction: "you do NOT
modify skills or agents," recommendations only.

**Reality check:** grep across their workflows and Makefile confirms none of
this runs automatically. The always-on, CI-enforced discipline is only the cheap
structural scorer. The interesting findings come from a research instrument a
human has to remember to run.

## What this means for us

The auto-load-gap question is the one to answer first (README C1). Our
complication: `project_claude_code_jsonl_drop_bug` means blocks in the live
stream sometimes never land in the `.jsonl` we'd be reading, so a naive
activation count under-reports by an unknown amount. Validate the method against
a session with known-good ground truth before trusting any number it produces.
