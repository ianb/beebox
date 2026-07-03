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

## Stale audit expectations fixed (in knowledge-audits.yaml)

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

\* 24 raw; 29 after correcting the 5 stale audits (re-run confirmed passing). The
one remaining failure is the real regression above.
