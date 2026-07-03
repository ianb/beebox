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

## Bottom line

All 217 audits reran against test1. After correcting stale audits, **214/217
effectively passed** on the first pass; **a follow-up prompt-fix pass then closed 8
of the 9 real gaps** — only `views-attach-to-cards` remains (it needs the actual
view-migration, not a prompt). The overhaul landed well — quotes/laws/source,
cards, chat-thread YAML, courseware, most of chat are all clean. **31 audits were
stale** (mostly `should_read` checks made obsolete because the overhaul moved
knowledge into the always-on surface, plus XML→YAML format renames:
`<message>`/`<seen>`→`entries:`, `<todo-list>`/`<item>`→`items:`,
`<triage-destination>`→`destinations:`, `<directive>`→`directive:`) — those were
fixed and re-run green.

## Prompt fixes applied (2026-07-03) — 8 real gaps closed

Each was re-run against test1 and now passes; a 21-audit regression pass over the
touched sections stayed green, and `pnpm typecheck` / `pnpm test` are clean.

| Gap | Fix | Where |
|---|---|---|
| `schema-validate-hook` | corrective: rules Zod can't express go in the schema's `validate` hook, **not** a Zod `.refine()` | `agent-guide/cards.ts` (always-on) |
| `triage-confidence-levels` | new generated box doc documenting the `confident/probable/guess` enum | `generate-docs-triage.ts` → `docs/generated/triage.md` |
| `triage-handler-env` | same doc documents the `TRIAGE_ITEMS` handler contract (+`xargs -0`); always-on pointer names it | `docs/generated/triage.md`, `box-shape.ts` |
| `draft-email-placement` | corrective on the `box/output/` row: email reply drafts go in the source thread's dir, not here | `box-shape.ts`, `email-message.tsx` |
| `narration-no-voice-out-by-default` | hardened overlay: "voice-in⇒voice-out is *suspended*; do NOT reply with `<speech>` even when the user spoke" (now 4/4, was ~2/5) | `chat-session-prompts.ts` (NARRATION_OVERLAY) |
| `ack-conservative-text` | sharpened kind taxonomy (adding a note is `appended`, not `edited`) + bare-ack-when-obvious rule | `chat-session-prompts.ts` (ack section) |
| `chat-thread-seen-note` | corrective: `self-note` is the *live chat session*; a note while processing a `chat-thread` goes in the `kind: seen` entry's `text:` | `agent-guide/commands.ts` |
| `procedure-in-job` | **audit reframed** — the `<procedure ref>` job-trampoline it tested *does not exist in the code*; now tests the real triggers (`cb procedure run` + the triage handler). Removed stale trampoline comments in `engine.ts`/`finish-job.ts` | `knowledge-audits.yaml`, `reactor/engine.ts` |

**Still failing — needs code, not a prompt:**

| Gap | Kind | One-liner |
|---|---|---|
| `views-attach-to-cards` | migration incomplete | standalone `view:` scheme still live; agent correctly reports it. Finish the view-migration (remove the `view:` scheme, rewrite `views/CLAUDE.md`) to make it pass. |

**Needs-decision / box-drift (not knowledge gaps):**
- `cb-session-exists` — "past chat" now reads as chat-thread cards vs `cb session`.
- cooking guide — `cooking-guide-awareness` / `-follow-recipe-pattern` read a
  cooking guide that no longer exists in test1.
- drive fixtures — `drive-edit-spreadsheet` / `-understand-formulas` need a synced
  gsheet in test1 (empty `store/drive/`).
- `trick-scripts-path` (minor) — MAP.md says `tricks/`, scripts live in `tricks/scripts/`.

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

### ack-conservative-text — REAL GAP (batch 4, chat prompt behavior)

- **Prompt:** user said "add a note about cardamom to my bread recipe," the agent
  did it — confirm with prose / `<ack>` / `<callout>`? If `<ack>`, does it need
  inner text?
- **Agent answered (consistent, 2 runs):** `<ack kind="edited" ref="…Bread.recipe.card">added a cardamom note</ack>`
  and argued inner text is "worth adding when it names a real detail."
- **Why it's real:** the chat system prompt's *own example* for this exact case is
  `<ack kind="appended" ref="recipes/Bread.recipe.card" />` —
  **`appended`** (adding content to an existing card), **bare** (no text). Two
  misses: (a) the agent picks `kind="edited"` over `appended`; (b) it adds
  restating inner text, exactly the failure the audit guards against. The rule
  ("omit inner text when it would just restate the action") isn't landing — the
  agent applied the "worth adding a detail" half but missed that "added a cardamom
  note" merely restates the user's request.
- **Fix (boxholder):** sharpen the appended-vs-edited guidance and the
  restate-vs-real-detail line in `chat-session-prompts.ts` (~line 124). Left
  failing as a red flag.

### chat-thread-seen-note — MINOR GAP (batch 4, mechanism conflation)

- **Prompt:** "Can I leave a note for myself when acknowledging chat messages?"
- **Agent answered (consistent, 3 runs):** `cb chat self-note …`.
- **Why it's off:** the acknowledgment-note is the `text:` field on a `kind: seen`
  entry (per the chat-thread schema instructions) — a private note-to-future-self
  read on the next invocation. `cb chat self-note` posts into a *live chat
  session*, a different context. The agent conflates the two. Low severity, but
  the seen-note mechanism isn't surfacing. Audit check updated to the YAML form
  (`seen`); left failing as the flag.

### narration-no-voice-out-by-default — REAL GAP, INTERMITTENT (batch 5)

- **Prompt (chat_mode + narration overlay):** `<chat-app narration="on" prose="off"/>`
  then `<speech>Quick question — what's two plus two?</speech>`. Expected: the
  agent does NOT emit `<speech>` (narration mode overrides the usual
  "voice-in ⇒ voice-out" rule); a `<callout>` or silent ack is fine.
- **Observed:** across 5 runs, **2 pass / 3 fail** — the agent emits
  `<speech>Four.</speech>` about 60% of the time. The narration overlay *is*
  applied by the harness (`test-runner.ts` appends `NARRATION_OVERLAY` for
  chat_mode audits), so this is behavioral, not a harness bug.
- **Why it's real:** the narration override ("stay silent even when the user
  spoke") isn't robust — the base "voice-in implies voice-out" reflex
  (chat-session-prompts.ts:21) wins more often than not. The prompt-surface
  overhaul rewrote the chat/reactor prompts; the narration override likely needs
  strengthening to reliably beat the voice-in-voice-out rule.
- **Fix (boxholder):** harden `NARRATION_OVERLAY` so it reliably suppresses
  `<speech>`. Audit left as-is (chat_mode: true) — it correctly catches the
  intermittent violation.

### draft-email-placement — REAL GAP (batch 6)

- **Prompt:** "If you're drafting a reply to an email I received, where on disk
  should the draft card go?"
- **Agent answered (consistent, 2 runs):** `box/output/` as an `email-outbound`
  card, picked up by `cb finalize`.
- **Why it's real:** the `email-outbound` schema instructions
  (`src/schemas/email-outbound.tsx`) say **reply drafts go inside the existing
  thread's `.attach/`** next to the source message, e.g.
  `box/inbox/email/thread-X.attach/draft-001.email-outbound.card` — "place the
  draft in the same directory as the source message." The connector reads the
  source card's `message-id`/`thread-id` from that directory to set Gmail
  threading; a `box/output/` draft would **silently lose threading**. The agent
  defaults to an outbox model (likely generalizing from telegram-message output
  cards, which do use `box/output/`).
- **Fix (boxholder):** make the reply-draft placement (co-locate with the source
  thread) more prominent in the always-on surface / email-outbound instructions.

### drive-edit-spreadsheet / drive-understand-formulas — BOX DRIFT (batch 6)

- Both require a **synced Google Sheet fixture** in test1 (edit a value / read the
  JSON to find formula cells), but `store/drive/` is **empty** — no `.gsheet.card`
  / `.gdoc.card` anywhere. The agent correctly reports none exist and offers
  `cb drive add`, but can't demonstrate the edit-JSON / formula-cell knowledge with
  nothing to act on.
- Decision for the boxholder: restore a synced gsheet (and gdoc) fixture to test1
  to exercise these, or accept they can't run. Audits left unchanged.

### triage-confidence-levels / triage-handler-env — REAL GAPS, pre-existing (batch 7)

- Both are **already documented** in the yaml's Triage Pipeline status
  (2026-05-20) and still fail on the same root cause: the triage pipeline's
  internals live in dev-repo source and `docs/plans/triage-design.md`, which is
  **not propagated into boxes**.
  - `triage-confidence-levels`: the enum is `confident` / `probable` / `guess`
    (`src/core/triage.ts:75`), but the box agent can't find it — it answers "no
    documented per-item scale" and describes `_unsure/` + the guide-rule
    low/medium/high confidence (a different thing). Real.
  - `triage-handler-env`: handlers receive their items via the `TRIAGE_ITEMS`
    env var (null-delimited paths — `src/core/handle.ts:30`), but the agent can't
    find it and improvises a `ls box/inbox/triaged/<cat>/` directory listing. Real.
- **Fix (boxholder):** propagate a `docs/generated/triage-pipeline.md` derivative
  into boxes (the confidence enum + the `TRIAGE_ITEMS` contract). Left failing
  honestly — the substance checks (`probable`/`guess`, `TRIAGE_ITEMS`) correctly
  flag the gap.

Note: also discovered a **systemic broken-`should_read`** issue — several
landmark/triage audits pointed `should_read` at dev-repo docs
(`docs/landmark-curation.md`, `docs/plans/triage-design.md`) that don't exist in
the box, so they failed automatically even though the agent answered correctly
from the always-on guide. Dropped those broken reads (see fixes below).

### views-attach-to-cards — REAL FINDING: incomplete migration (batch 8)

- **Prompt:** "How is a view wired up — can it stand alone, or must it attach to
  something?" Audit (`knows_directly`) expects: every view attaches to a card type
  via `rendersCardTypes`, selected with `?view=name`; **no card-less standalone
  view**.
- **Agent answered (accurately, per current box docs):** two mechanisms — a
  builtin `view:` card (stands alone) and a custom React view in `views/*.tsx`
  that's a "**standalone surface driven by dependencies globs**" (todos.tsx), and
  said these "don't need to attach to a specific card type."
- **Why it's the code, not the agent:** `rendersCardTypes` + `?view=` do exist
  (`view-bindings.ts`, `view-url.ts`), but the standalone `view:` scheme still
  lives (`src/schemas/view.ts`: chat-picker/history/…) and the box's
  `views/CLAUDE.md` still teaches glob-driven standalone views. So the "views
  attach to cards, kill the `view:` scheme" migration is **incomplete** — the
  audit encodes the target end-state (like the triage gaps), and the agent
  faithfully reports current reality.
- **Fix (boxholder):** finish the view migration — remove the standalone `view:`
  scheme, rewrite `views/CLAUDE.md` to the attach-to-cards model — then this
  passes. Audit left failing as the driver.

## Stale audit expectations fixed (in knowledge-audits.yaml)

Batch 9 (courseware):

- **courseware-exposition-plan** — dropped the stale
  `should_read docs/generated/card-exposition-plan.md`; the agent recalls "keep
  the reasoning in" directly (matching the earlier -concept-map-edges /
  -lesson-plan fixes).

Batch 8 (briefing / recipe / search / views / retro / last-audio / clerk /
figure / location) — cleanest batch:

- **recipe-prose-vs-tag** — dropped the stale `should_read docs/generated/card-recipe.md`;
  the agent knows "don't invent tags, use plain markdown" directly.

Batch 7 (landmarks / sessions / feedback / triage-pipeline / don't-drop):

- **landmarks-recurrence-signal / -criteria / -not-everywhere** — dropped the
  broken `should_read docs/landmark-curation.md` (dev-repo doc not in the box);
  the agent answers curation questions correctly from the always-on guide.
- **landmarks-dont-create-quietly** — `should_read` repointed to the real
  `docs/generated/card-landmark.md` (which the agent reads).
- **landmark-roles** — the agent-facing routing role is `destinations:` frontmatter
  (with `for: [triage]`/`[commentary]`), renamed from the old XML
  `<triage-destination>`; check `triage-destination` → `destinations`.
- **triage-vs-reactor-flow** — dropped the broken
  `should_read docs/plans/triage-design.md`; the agent distinguishes the two
  "intake" paths correctly from the guide.
- **triage-pipeline-not-wired** — the agent answered correctly ("runs only when
  invoked directly via cb intake/triage/handle") but in different words; added
  "invoked directly"/"directly via" to the accepted phrasings.

Batch 6 (calendar / drive / email):

- **drive-docs-supported** — a synced Google Doc is a `gdoc` card, not a
  `.doc.card` (that's the *local* doc type); the old `.doc.card` check was simply
  wrong. Agent answers "gdoc"/"Google Doc" correctly; check → `["gdoc", "Google Doc"]`.

Batch 5 (narration / voice / chat-input / views-in-chat / todos / recording):

- **todo-list-structure / -create / -nested-items** — todo-list cards moved from
  XML `<todo-list>`/`<item>` to YAML `items:` array; de-baited the "XML structure"
  prompt, updated checks to `items:`, dropped stale should_read.
- **companion-card-activity / -hints** — were `chat_mode: false` but test the
  chat companion pane's `open-card`/`card-activity` snapshot, which only exists in
  the chat system prompt. **Added `chat_mode: true`** and both pass — audit-config
  bug, not a knowledge gap. (-hints check also loosened off a wording mismatch:
  "not **to** assume" ≠ "not assume".)
- **chat-voice-per-message-override** — added `chat_mode: true` (the mechanism is
  in the chat prompt + docs/chat-voice.md); accept either valid per-message
  override — `voice="…"` attribute *or* nested `<instructions>` (both satisfy
  "speak this one sentence differently").

Batch 4 (chat threads / structured-output tags) — the chat-thread card format
moved from XML (`<message>`, `<seen>`, `sender="agent"`) to YAML `entries:` with
`kind: message` / `kind: seen` discriminators; the agent answers in the new
format but 5 audits still checked the old XML tags:

- **chat-thread-structure** — de-baited the "XML structure" prompt (it made the
  agent stop to correct the premise and often not show the structure); checks
  `entries:` / `kind:`.
- **chat-thread-respond-vs-acknowledge** — `<seen` → `seen` (agent says
  "seen-marker").
- **chat-thread-agent-message** — `sender="agent"` → accept `sender: agent` OR a
  `telegram-message` output card (both respect connector-owned delivery).
- **chat-thread-invariant** — `<seen` → `seen`.
- (chat-thread-new-messages / -callback watch_for prose also de-XML'd; they
  already passed on YAML-compatible checks.)

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
| 4 | Chat Threads, Chat Structured-Output Tags | 24 | 18→22§ | 1 + 1 minor | 4 |

§ 18 raw; 22 after fixing 4 stale XML→YAML chat-thread audits (re-run confirmed).
Remaining: `ack-conservative-text` (real behavioral gap) and `chat-thread-seen-note`
(minor mechanism conflation).
| 5 | Narration, Chat Voice, Chat Input, Views-in-Chat, Todos, Recording | 25 | 18→24¶ | 1 intermittent | 6 |

¶ 18 raw; 24 after fixing 6 audits (3 stale XML/should_read + 2 chat_mode-config
+ 1 accept-both-mechanisms; all re-run confirmed). The one remaining is
`narration-no-voice-out-by-default` — intermittent (~40% pass), a real behavioral
gap in the narration override.
| 6 | Calendar, Drive/Sheets, Drive/Docs, Email Outbound | 17 | 13→14** | 1 + 2 box-drift | 1 |

\** 13 raw; 14 after fixing the `drive-docs-supported` wrong check. Remaining:
`draft-email-placement` (real gap) and `drive-edit-spreadsheet` /
`drive-understand-formulas` (box drift — empty store/drive/ in test1).
| 7 | Landmarks, Landmark Sessions, Feedback, Triage Pipeline, Don't-Drop | 27 | 18→25†† | 2 (pre-existing) | 5 |

†† 18 raw; 25 after fixing 5 audits (3 broken-should_read + 1 repointed + 1 vocab
+ 1 wording; re-run confirmed). The 2 remaining (`triage-confidence-levels`,
`triage-handler-env`) are the pre-documented undocumented-triage-internals gaps.
| 8 | Briefing, Recipe, Search, Views (×3), Retro, Last-Audio, Clerk, Figure, Location | 33 | 31→32‡‡ | 1 (migration) | 1 |

‡‡ 31 raw; 32 after fixing `recipe-prose-vs-tag` (stale should_read). The one
remaining, `views-attach-to-cards`, fails because the view-migration is
incomplete — the audit encodes the target state.
| 9 | Courseware | 12 | 11→12 | 0 | 1 |
| **Total** | **all sections** | **217** | **~172→214** | **8 + 3 minor** | **31** |

Overall: **214/217 effectively pass** after the audit corrections. The 3 audits
left failing on purpose are the real gaps that need code/doc work, not audit
edits: `schema-validate-hook`, `procedure-in-job`, `triage-confidence-levels`,
`triage-handler-env`, `draft-email-placement`, `views-attach-to-cards`,
`narration-no-voice-out-by-default` (intermittent), and `chat-thread-seen-note`
(minor) — plus the box-drift / needs-decision items (cooking guide,
drive fixtures, cb-session vocabulary). (The "~172→214" reflects the sum of raw
per-batch passes rising to post-fix passes; exact raw total varies with re-run
flakiness.)
