# Authoring craft, and their own research corpus

**Snapshot date:** 2026-07-30. Companion to [README.md](README.md).

## The finding that applies to every skill we own

From their competitive review of another project (*Superpowers*), stated as a
"CSO" (Claude Search Optimization) discovery:

> A description that summarizes the workflow gets followed **instead of** the
> skill body being loaded. Descriptions must contain triggering conditions only.

That is a specific, mechanical failure mode, not style advice. If a description
reads like a summary of what the skill does, the model has enough to act on and
never opens the file — so the skill's actual content, the part with the
checklists and the gotchas, never enters context.

Their descriptions are built to avoid it, with a consistent two-clause shape:
**what triggers it** + **"Use for X. NOT for Y."** The negative clause is doing
real disambiguation work — their investigate / testing / pr-review skills each
explicitly carve out what they are *not*, to stop overlapping triggers.

Ours run 223–574 characters against their ~200-char target, and three of them do
precisely the anti-pattern. `cb-guide-api`:

> Explains how HTTP endpoints are added in callback-box and the
> tRPC-vs-raw-Fastify decision. […] Instructional (a cb-guide-\* skill) — full
> checklist in docs/adding-api-endpoints.md.

That description tells the model the skill explains a decision, and then names
the file with the real checklist. A model reading it has every reason to skip
the skill and go straight to the doc — or to answer from the description alone.
The other two `cb-guide-*` descriptions have the same shape. Filed as A1.

The length argument is separate and weaker for us: their ~200-char budget comes
from having ~40 skills competing for a shared skill-listing context budget, where
a long description crowds out siblings and degrades routing corpus-wide. With 16
skills we have more room. The *triggering-conditions-only* rule stands on its own
merits; the char count is a consequence of their scale, not a law.

## Frontmatter and progressive disclosure

Their schema: `name`, `description`, `effort: low|medium|high`, and for
auto-loading reference skills a `paths:` glob array plus `user-invocable: false`.
Notably **no `triggers:` field** — triggering is carried entirely by the
description prose plus path globs. Reference paths always use a
`${CLAUDE_SKILL_DIR}` prefix, never a literal path.

The stated rule is ~100-line SKILL.md with detail pushed to `references/*.md`.
It's followed rigorously in the auto-loaded reference skills (85–117 lines) and
stretched in the user-invoked workflow skills (124–185), which inline decision
tables, bash snippets and numbered workflows rather than pushing them out. The
extreme case inlines a condensed 8-row rule table in SKILL.md while
`references/` holds the full 35-rule catalogue — deliberate duplication of the
happy path.

### The constraint that distorts their design — and doesn't apply to us

Plugin skills install to `~/.claude/plugins/cache/`, and their agents **cannot
reliably `Read` a `references/*.md` at runtime** from there. Their own docs
tabulate it: agent system prompt → available; preloaded SKILL.md → available;
skill `references/*.md` → *not* reliably available.

So every Iron Law, decision table and common pattern is inlined in SKILL.md, and
references are strictly optional deep-dive material that a competent agent could
never load without breaking. Nothing load-bearing lives in a reference file.

**Our skills are in-repo and readable.** Their size limits and inline-everything
discipline are workarounds for a constraint we don't have, and copying them would
make our skills worse for no reason (README R3). Worth checking the converse:
whether any of our skills currently over-inline out of similar caution.

## Iron Laws as a section convention — mostly well-chosen

Judged on whether each is falsifiable and specific rather than padding, these
hold up better than the enforcement story behind them
([enforcement-and-hooks.md](enforcement-and-hooks.md)). Representative:

- "FACTORIES MATCH SCHEMA REQUIRED FIELDS — missing fields cause cascading test
  failures." Names the mechanism of harm, not just the rule.
- "LIVEVIEW EVENT PARAMS ARE UNTRUSTED — users can alter forms, hooks, and every
  `phx-value-*` in DevTools." Names the exact attack surface rather than
  "validate input."
- "NEVER install `mix_audit` / `osv-scanner` — **even if asked**. The audit skill
  is non-mutating; the manifest is off-limits regardless of consent." Pre-empts a
  specific failure mode: the agent complying with a user request that violates
  the skill's own contract.
- "Avoid confirmatory subagents… confirmed waste: session c135330a."

That last one is the standout technique: **an Iron Law citing a specific prior
session as the evidence it earns its keep.** Several of their rules carry dated
provenance or an issue number. It's the same instinct as our `**Why:**` line in
memory files, applied to prompt text — and it makes a rule much harder to
casually delete later, because the cost of having learned it is written next to
it.

Other recurring prose moves: decision tables in every skill (2–4 columns,
"when X, use Y"); `Wrong | Right` anti-pattern pairs at code level rather than in
prose; workflow-halting "STOP — show the diff, get confirmation" steps as
numbered items rather than passive laws; and an explicit "Next Steps" section
ending each workflow skill naming 2–3 specific follow-on commands, justified
inline as "findings without follow-up get lost."

## A skill with a real test suite

Their dependency-audit skill ships a CI-grade harness, and this is the single
most structurally interesting artifact in the repo for us:

- `fixtures.d/<NN_name>/{setup.sh,expected.txt}` — one directory per case, 16 of
  them. `setup.sh` materialises a minimal source tree exercising exactly one
  detection rule (the bidi case writes a literal U+202E override byte sequence,
  reproducing Trojan Source). `expected.txt` is a three-token assertion DSL:
  `rule:1 op:>= count:1`.
- `runner.sh` sources the rule implementations, runs each `setup.sh` into a
  `mktemp -d` sandbox, and diffs actual against expected via the DSL's comparator.
- `corpus.d/` — a **second fixture tier** of real historical incidents drawn from
  actual published advisories, plus a benign-100 corpus. Held out from the
  synthetic unit-style fixtures.
- `test-assets/*-cassettes/` — recorded HTTP responses so the network-dependent
  rules stay deterministic and offline.

Four choices worth stealing independent of the domain: one directory per case
with `setup.sh` + `expected.txt` as the entire contract; a tiny assertion DSL
rather than a general test framework; **splitting synthetic/adversarial fixtures
from a corpus of real past incidents**; and cassettes for anything that touches
the network.

Crucially, none of this puts an LLM in the loop. It tests the *deterministic
subroutines* a skill depends on — which is the part of "does this skill work"
that's cheapest to pin down and easiest to regression-test on every change. That
is recognisably the same instinct as our doctests, pointed at agent tooling
rather than library code. We have no obvious immediate target for it (our skills
are mostly prose, not scripts), which is why it's recorded here rather than
filed — but it's the right shape to reach for the moment a skill of ours grows a
script with rules in it.

## Their own research corpus

They keep `.claude/research/` and `.claude/plans/competitive-analysis/` — the
same instinct as our `research/` tree. Two observations.

**The "verification initiative"** argues they have strong code-level verification
(laws + compile + test) and zero *output*-level verification: a review agent
asserts "no N+1 queries" and nothing checks whether that's true. It cites real
papers with correct venues and arXiv IDs — CoVe, SELF-RAG, FActScore, FIRE,
Self-Refine, Reflexion, Model Collapse.

What makes it worth reading is the self-critique section, which stress-tests its
own citations: CoVe's numbers are from factoid QA, not software engineering;
FIRE's cost reduction is for news fact-checking; and — the sharpest point —
"writer/reviewer independence is theoretically ideal but practically
constrained," since their verifier agent is another Claude instance sharing the
generator's training biases. That limitation applies squarely to our own
adversarial-review patterns, and it's an argument for cross-model review (our
`codex` skill) over same-model self-critique.

The document also carries an explicit **anti-recommendations** list — don't build
dynamic model routing (not enough volume to amortise), don't add provenance to
every output type (only where trust beats speed), don't implement verification
via hooks (fragile), don't over-structure the scratchpad. A roadmap that names
what it has decided *not* to build is a practice worth copying into our own
plans.

**Their competitive analysis** covers six external projects. Beyond the CSO
finding above, the ideas they rank highest are all in review intelligence: a
meta-gate against over-recommendation; selecting reviewer personas dynamically
from the diff's content rather than always spawning the full set; structured JSON
findings so dedup is deterministic instead of an LLM judgment call; and a
conventions loop where accepted and rejected findings are written back so future
reviews respect prior triage decisions. That last one is the strongest — it's the
structural version of the prior-findings dedup in
[workflow-and-orchestration.md](workflow-and-orchestration.md), and it's what
would stop our `codex` skill re-raising things we've already dismissed.

Their headline scope lesson, aimed at themselves: a general-purpose framework at
90k lines of TypeScript versus their own ~5k domain-specific plugin, cited as "a
cautionary tale about scope." They have 51 skills and are already worried. We
have 16.
