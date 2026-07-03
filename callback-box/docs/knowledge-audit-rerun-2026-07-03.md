# Knowledge-audit full rerun — 2026-07-03

Full-corpus rerun of the knowledge audits against `~/src/boxes/test1` to catch
agent-knowledge drift after the `prompt-surface-ia-review` overhaul (ABOUT_CARDS
canonical surface, named laws, quote/source reconciliation, typed schema fields,
`sheet`→`gsheet`, `{% source %}` `as`→`usage`, calendar/drive → skills, chat +
reactor system-prompt rewrites).

Run in batches by section. Two buckets per failure:
1. **Real gap/regression** — agent genuinely doesn't know something it should.
   Collected here as prompt-surface follow-ups for the boxholder (not fixed).
2. **Stale expectation** — the overhaul deliberately changed the right answer, so
   the audit was updated to match reality (done in `knowledge-audits.yaml`).

## Real gaps / regressions (for the boxholder)

### schema-validate-hook — REGRESSION (batch 1)

- **Prompt:** "You're adding a card type whose rules go beyond what Zod field
  types can express — e.g. a cross-field constraint, or validating the body's
  parsed structure. Where does that validation go?"
- **Expected:** name the schema's `validate` hook on `cardSchema()`
  (self-contained, co-located, returns `LintIssue[]`, sees only the card's own
  data). Level `discoverable` — the agent is expected to explore
  `config/schemas/CLAUDE.md`.
- **What the agent answered (consistent across 2 runs, 0 files read / 0
  searches):** "goes in a `.refine()` / `.superRefine()` on the Zod schema … and
  a body validator." It points *at* `config/schemas/CLAUDE.md` ("see it for the
  exact hooks") but never opens it, and never names the real `validate` hook.
- **Why it's real:** the `validate` hook exists and is the canonical mechanism
  (`src/cards/schema.ts:134` — `validate?: (input: CardValidateInput) =>
  LintIssue[]`). Zod `.refine()` throws a `ZodError` on parse — a cruder, wrong
  mechanism for the box's lint system. The audit's status comment records it
  *passed* on 2026-06-18 (agent discovered the file and named the hook), so this
  is a regression: the agent now short-circuits discovery with a confident,
  Zod-priors answer.
- **Likely culprit / where to look:** whatever in the always-on surface now
  frames schema extension as "Zod + `.refine()`" strongly enough that the agent
  answers directly instead of exploring — or a lost pointer that used to steer it
  into `config/schemas/CLAUDE.md`. Worth checking whether `config/schemas/CLAUDE.md`
  in the box still surfaces the `validate` hook prominently, and whether the
  ABOUT_CARDS/extension prose over-emphasizes Zod.

### find-memo-cards — REAL GAP (batch 2)

- **Prompt:** "If I wanted to find all memo cards in the system, how would you search?"
- **Agent answered (consistent, 2 runs):** `cb ls --kind memo` and `cb search
  "<query>" --kind memo`.
- **Why it's real:** `cb ls` has **no `--kind` flag** — it takes glob paths + `-f`
  (`src/cli/commands/ls.ts`). So `cb ls --kind memo` is hallucinated. `cb search
  --kind memo` *is* valid, but search wants a query and doesn't enumerate. The
  agent never names the `*.memo.card` filename-glob convention (the audit's
  `knows_directly` expectation, still correct — e.g. `cb ls '**/*.memo.card'`).
- **Likely culprit:** the always-on surface teaches `--kind` for `cb search` but
  the agent over-generalizes it to `cb ls`; and the `*.memo.card` naming
  convention as a *search* strategy isn't landing. Consider (a) documenting the
  `cb ls '**/*.memo.card'` glob idiom, and/or (b) whether `cb ls` should accept
  `--kind` for symmetry with `cb search`.

### cb-session-exists — NEEDS DECISION (batch 2, interface-as-cards vocabulary)

- **Prompt:** "I want to review the transcript of a past chat — what command
  gives me that?" Audit expects `cb session`.
- **Agent answered (consistent):** chat threads are `chat-thread` cards — find
  with `cb ls`/`cb search` and read the card; also `cb chat retranscribe`. Never
  says `cb session`.
- **Why it's ambiguous:** `cb session` still exists (`src/cli/commands/session.ts`)
  and the sibling audit `cb-session-how-to-use` (whose prompt says "cb session"
  explicitly) *passed* — so the agent knows the command. The failure is that
  "past **chat**" now reads, post-interface-as-cards, as chat-thread cards, not
  the underlying Claude Code session transcript. Decision for the boxholder: is
  the canonical answer to "review a past chat" now the chat-thread card (→ update
  this audit's prompt/checks), or should the guide still steer to `cb session`?
  Not changed pending your call.

### cooking-guide-awareness / cooking-follow-recipe-pattern — BOX DRIFT (batch 2)

- Both audits `should_read docs/generated/cooking-guide.md`, but **test1 has no
  cooking guide** — no `config/cooking.guide.card`, and no generated
  `cooking-guide.md` (only calendar/intake/news guides exist). So the read can
  never happen and the audits can't pass. The agent's direct cooking help is
  reasonable given nothing to read. (The sibling `cooking-recipe-lookup`, which
  needs no guide, passes.)
- Decision for the boxholder: restore a cooking guide to test1 (if it's meant to
  be a demo fixture) or retire these two audits. Not changed pending your call.

### trick-scripts-path — MINOR GAP (batch 2)

- **Prompt:** "Where do trick scripts live?" Audit expects `tricks/scripts`.
- **Agent answered:** "`tricks/` at the box root (per MAP.md)." Trick *scripts*
  actually live in `tricks/scripts/<name>/` (per `tricks/scripts/CLAUDE.md` and
  the `tricks` skill); the box's `MAP.md` line is just "`tricks/` — Custom
  automation scripts," which is what the agent parroted. Low severity — either
  tighten MAP.md to name `tricks/scripts/`, or accept that the agent should pull
  the finer path from the tricks skill. Audit expectation left as-is (it's the
  correct path).

### cb-chat-self-note-env — TURN LIMIT (batch 2)

- The agent reaches the right files (`chat.ts`, `src/core/script-env.ts`) but
  over-explores (runs the command to observe its env errors) and exhausts turns,
  emitting an **empty** response twice at the default limit. Not a knowledge gap —
  the answer is reachable. Bumped `max_turns: 10 → 20`; **re-run then passed** with
  a complete answer (both env vars + `CB_AGENT_TOKEN`). Fixed.

### procedure-in-job — REAL GAP (batch 3, undocumented mechanism)

- **Prompt:** "Can a job card trigger a procedure? How does that work?" Audit
  (`knows_directly`) expects `<procedure ref='...'>` in job cards + reactor
  trampolining.
- **Agent answered (consistent):** empty response — grepped ~9 times across
  `procedures.md`, `card-intake-job.md`, `config/`, and found nothing, then hit
  the turn limit.
- **Why it's real:** the mechanism *exists* — `detectProcedureInJob`
  (`src/core/procedure/procedure-trampoline.ts`) + the reactor trampoline
  (`src/core/reactor/engine.ts:13` "Run procedure jobs via trampoline") via an XML
  `<procedure ref="...">` in the job card (one of the last XML holdouts,
  `src/core/handle.ts:10`). But it is **undocumented** in the box's generated docs
  — `procedures.md` never mentions jobs triggering procedures — so the agent
  genuinely can't find it, and it certainly isn't `knows_directly`.
- **Fix (boxholder):** document job→procedure trampolining (and the surviving
  `<procedure ref>` XML form) in `procedures.md` / the job-card docs; then the
  audit's `expected_level` can move to `knows_about`/`discoverable`. Left failing
  as a red flag.

## Stale audit expectations fixed (in knowledge-audits.yaml)

Batch 3 (procedures / connectors / scheduled / extension / image) — all the
same "overhaul moved knowledge into the always-on surface, so the agent answers
correctly & directly; the `should_read` is stale" pattern:

- **describe-images-batch** — recommends batching directly; dropped should_read.
- **create-procedure** — describes config/procedures/ + precheck/run/validate
  phases correctly (whether generated YAML validates is a scenario-test question,
  per the audit's own notes); should_read → substance check.
- **procedure-directive** — names `--directive` directly; dropped should_read.
- **add-daily-task** — names the scheduled-script card + config/schedules/
  directly; dropped should_read.
- **track-reading-list** — proposes a custom `book` schema directly (its notes
  already flagged should_read as too strict); should_read → substance check.
- **create-task-card-type** — inherently conversational; re-encoded as a negative
  check (must not claim card types are built-in) instead of a brittle positive.

Batch 2 (nav / CLI / guides / git / tricks):

- **modify-intake-triage** — agent names the modification target directly
  (`config/intake.guide.card` + the `destinations` list on landmark cards); the
  overhaul's richer always-on guide made the compiled-doc read unnecessary.
  Replaced `should_read` with a `correct_contains` substance check.
- **what-are-tricks** — tricks authoring moved behind the `tricks` skill, which
  the agent correctly reaches for; dropped the stale
  `should_read tricks/scripts/CLAUDE.md`, check for `cb trick`.

Batch 1 (cards / quotes / source):

- **memo-xml-structure** — prompt bait "Show me the XML structure" is fine (the
  agent correctly rejects the XML premise), but cards are YAML frontmatter now, so
  the `should_read docs/generated/card-memo.md` expectation was stale. Now
  `knows_directly`, checks for "frontmatter"/"YAML".
- **question-directive** — directive is a `directive:` frontmatter field now, not
  an XML `<directive>` element (that form survives only for *procedure*
  directives). Replaced `correct_contains: ["<directive>"]` + `should_read` with
  `cards_contain: ["directive:"]`.
- **create-question-card** — answered correctly (`cb create`, directive) straight
  from the guide; dropped the stale `should_read docs/generated/card-question.md`,
  now `knows_directly`.
- **create-new-card-type** — answered the extension flow correctly
  (`config/schemas/`, `cardSchema()`/Zod, `cb init`) without needing the doc read;
  dropped `should_read`, added `correct_contains_any`. (Contrast
  schema-validate-hook, whose *wrong* answer means the read genuinely mattered.)
- **doc-body-inline-not-separate-file** — the doc schema's `instructions` now
  teach inline-body directly; all content checks passed, only the `should_read`
  failed. Dropped `should_read`, now `knows_directly`.

## Batch results

| Batch | Sections | Audits | Pass | Real gaps | Stale-fixed |
|---|---|--:|--:|--:|--:|
| 1 | Card Types & Schemas, Card Format & Schema Discovery, Direct Quotes, Provenance | 30 | 24→29* | 1 | 5 |
| 2 | Box Structure, How Items Enter, CLI Commands, Git History, Guides, Tricks | 27 | 19→22† | 1 + 1 minor | 2 (+1 max_turns) |

\* 24 raw; 29 after correcting the 5 stale audits (re-run confirmed passing). The
one remaining failure is the real regression above.

† 19 raw; 22 after fixing 2 stale audits + a `max_turns` bump (all re-run
confirmed). Remaining 5: `find-memo-cards` (real gap), `cb-session-exists` (needs
decision), `trick-scripts-path` (minor gap), and `cooking-guide-awareness` /
`cooking-follow-recipe-pattern` (box drift — no cooking guide in test1). See
sections above.
| 3 | Image Analysis, Procedures (+gating), Connectors, Scheduled, Extension, Python | 22 | 15→21‡ | 1 | 6 |

‡ 15 raw; 21 after fixing 6 stale should_read audits (all re-run confirmed). The
one real failure is `procedure-in-job` (undocumented job→procedure trampoline).
