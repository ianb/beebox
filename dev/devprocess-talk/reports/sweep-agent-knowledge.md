# Sweep: knowing what agents know, and seeing the product the way a user does

Worktree: worktree-devprocess-talk at e9ba5c2c8 (2026-10-09). All commands run from the worktree root unless noted.
Transcript aggregates: every `*.jsonl` (recursive, incl. subagents) under `~/.claude/projects/*beebox*` — 2,339 files, timestamps 2026-01-05..2026-10-09. Counts dated 2026-10-09 include this sweep's own parallel sessions. Scripts used for the aggregates: `scratchpad/tools/mdreads.py`, `scratchpad/tools/skillcounts.py` (Read/Skill/Bash tool_use blocks only; substring matches on Bash commands).

---

## Knowledge audits (box surface)
- **One line:** a YAML suite of prompts run through a real box agent against a box; each entry checks the answer and the tool use (`should_read`, `should_search`, matchers) to test what the agent learned from its loaded guidance.
- **Lives in:** `beebox/src/dev/knowledge-audit.ts` (`pnpm knowledge-audit run|list`), `beebox/src/dev/knowledge-audits.yaml` (suite + hand-written `# Status (date):` ledger comments), `beebox/src/dev/lib/audit-box.ts`, `audit-checks.ts`, `box-guard.ts`, `beebox/docs/testing/knowledge-audits.md`, `.claude/skills/knowledge-audit/SKILL.md`; reports in `beebox/src/dev/reports/` are gitignored.
- **Appeared:** 2026-02-23 2c69ec73e "Add knowledge testing framework and expand agent knowledge taxonomy" (same day 6780416fd "Move knowledge-tests.yaml into <old-package> repo"; taxonomy report `beebox/docs/reports/knowledge-taxonomy-catalog-2026-02-23.md` born 2026-02-22 10e321193). Doc 2026-05-05 627514059 "Add docs/box-layout, docs/maintenance, docs/knowledge-audits". Skill 2026-08-03 e52071dfb. Reshaping: 2026-07-03 full rerun (report `beebox/docs/reports/knowledge-audit-rerun-2026-07-03.md`); 2026-09-26 eef862615 "Knowledge audits record web lookups and check them with should_search"; 2026-09-24 0cdf6ae92 "freeze the 2026-02 knowledge-audit prompt catalog as a report"; 2026-10-08 8a75acc36 "refresh package docs through a box clone's link to the running engine".
- **Bottleneck relieved:** no way to tell whether a guidance change reached box agents. Skill text: "It tests what the agent knows after loading guidance, not code." (`.claude/skills/knowledge-audit/SKILL.md`). Commit e49de30e2 (2026-06-21): "fix(procedures): generated agent guide taught unimplemented gates; add audits".
- **New bottleneck exposed:** (a) audits go stale when the right answer changes — rerun report: "31 audits were stale" after an overhaul (`knowledge-audit-rerun-2026-07-03.md`); (b) box hygiene — runner resets the box, so `box-guard.ts` refuses nested/dirty boxes; 2026-09-28 cf575dae4 "fix: preserve audit box edits and isolate scan route tests"; (c) results live in gitignored reports, so the durable record is hand-typed status comments; (d) context size per audit needed its own ledger (next entry). skills-review recommends folding the skill into bbx-context (`dev/skills-review-2026-10.md`).
- **Evidence:**
  - 406 audit entries: `grep -cE '^\s*-?\s*id:' beebox/src/dev/knowledge-audits.yaml` → 406 (11 are `surface: dev`: `grep -c 'surface: dev' …` → 11).
  - 363 dated status comments: `grep -c 'Status (20' beebox/src/dev/knowledge-audits.yaml`; by month `grep -o 'Status (20[0-9-]*' … | cut -c9-15 | sort | uniq -c` → 2026-03:4, 04:1, 05:14, 06:14, 07:47, 08:30, 09:228, 10:25.
  - 1,042 recorded audit runs since 2026-06-21: `grep -c -- '- date:' beebox/src/dev/context-history.yaml`; per month 06:38, 07:460, 08:52, 09:429, 10:63.
  - 313 commits touch the suite: `git log --follow --format=%h -- beebox/src/dev/knowledge-audits.yaml | wc -l`; per month 02:4, 03:16, 04:6, 05:23, 06:37, 07:55, 08:34, 09:108, 10:30.
  - Transcripts: `pnpm knowledge-audit run` in 120 Bash calls across 40 sessions (2026-07-29..2026-10-09); Skill tool invoked 9 times (2026-08-18..2026-10-07).
- **Outcomes:** 2026-07-03 rerun of all 217 audits: "214/217 effectively passed… a follow-up fix pass then closed all 9 real gaps (8 prompt/doc fixes + 1 box-staleness bug fix)" (report). Recent audit-driven commits: 2026-10-08 aba6d8c01 (speech instructions check + harness crash filed), 2026-10-07 2ad2ef6af (schedule-writing agent ends runs with `bbx run-summary`), 2026-10-06 b275e1e2c / 71edf85fc (publishing card shape), 2026-09-29 14034db40 (schemas record specific facts), 2026-09-26 4efd59740 (notifications). The agent-guide ledger cites audit ids per rule (`audits:` field), so audits became the guard for each guide rule. Still in active use (63 runs in the first 9 days of October). Judgment: the instrument that every later box-guidance technique (ledger, budgets, bbx-context) points to as its proof step.
- **Prior-art mention:** dev/meta-practices.html yes (listed among "agent-native practices"); dev/skills-review-2026-10.md yes (skill 59 lines, "merge into bbx-context"); dev/agent-knowledge.html no; dev/workstream-story.md no.

## Context-size history ledger (per-audit context baselines)
- **One line:** every audit run appends initial/peak/added tokens and turns per audit id, keyed by box, so prompt growth shows up as a number over time.
- **Lives in:** `beebox/src/dev/context-history.yaml` (auto-appended), `beebox/src/dev/lib/context-history.ts`, `context-usage.ts`.
- **Appeared:** 2026-06-21 e49de30e2 "fix(procedures): generated agent guide taught unimplemented gates; add audits". Later: 2026-09-26 b8b5b366e "Record audit context baselines from the box-guidance reruns".
- **Bottleneck relieved:** audits said pass/fail but not what the guidance cost. The closed issue `issues/closed/*/2026-07-04-instruction-surface-size-budget.md` cites "the measurement (knowledge-audit ledger)".
- **New bottleneck exposed:** a measurement with no assertion; resolved by the guide budget (below): "the measurement… is now paired with an assertion that acts on it" (same issue).
- **Evidence:** 1,042 entries (see above); 9 box keys incl. `dev-checkout` (`grep -E '^[a-z0-9-]+:$' beebox/src/dev/context-history.yaml`); file 7,728 lines (`wc -l`).
- **Outcomes:** fed the 2026-09-26 agent-guide-spec baselines (b8b5b366e). Still appended on every run. Judgment: its main use was as input to the budget decision; no separate consumer found.
- **Prior-art mention:** none of the four.

## Dev-guidance audits (`knowledge-audit --dev`)
- **One line:** the same audit harness pointed at a headless Claude Code session in this checkout, grading what the repo's CLAUDE.md files, skills, and docs taught a dev agent.
- **Lives in:** `beebox/src/dev/knowledge-audit.ts` (`--dev`, `--model`), `beebox/src/dev/lib/test-runner/dev-session.ts`, entries with `surface: dev` in `knowledge-audits.yaml`, ledger key `dev-checkout`.
- **Appeared:** 2026-10-07 6cd8fb1f6 "Design in the plan flow; dev-guidance audits; spirit and design docs refreshed" ("eight entries … all passing"). Reshaping 2026-10-08 9c464c073 "Dev audits: deny the answer key, count only successful reads, hard timeout"; 30516e30f "clean re-run with the answer key denied" ("Seven of eight passed on the first clean run").
- **Bottleneck relieved:** the dev repo's own guidance had no test; only box guidance did.
- **New bottleneck exposed:** answer-key leakage — the dev agent can read the audit file itself; fixed by denying it (9c464c073).
- **Evidence:** 11 `surface: dev` entries (`grep -c 'surface: dev' beebox/src/dev/knowledge-audits.yaml`); ids `dev-spirit-doc … dev-lesson-placement` (`grep -n 'surface: dev' -B3 … | grep id:`).
- **Outcomes:** 2 days old. First clean run 7/8; one audit relaxed after the agent grepped instead of Read (30516e30f). Judgment: too new to assess.
- **Prior-art mention:** none (skills-review predates it).

## Agent guide ledger, laws, and word budget
- **One line:** the always-loaded box agent guide is a hand-written `guide.md` backed by `ledger.yaml` — one row per rule with a bin (law/core/indirect/delete), a reason, and the audits guarding it — plus a word budget the linter asserts.
- **Lives in:** `beebox/src/core/agent-guide/{guide.md,ledger.yaml,ledger-schema.ts,lint.ts,render.ts}`, `beebox/src/dev/lint-guide.ts` (`pnpm lint:guide [--box] [--report]`), `beebox/docs/agent-guide.md`, plan `beebox/docs/implemented-plans/agent-guide-spec.md`.
- **Appeared:** guide generation 2026-02-09 e564d6199 "Add agent documentation generation, prompt logging, and DOCID markers"; `src/core/agent-guide/` first commit f2da8f5f2 (2026-04-27, per the plan). Spec: plan 2026-09-26 567a6e8f6; Track 1 94545e091 "ledger, handle registry, and spec"; Track 2 e38a04ea6 "The agent guide is a hand-written document with a renderer and a linter"; ~20 "binned and rewritten" commits 2026-09-26 (e.g. 7ab23b850 ABOUT_CARDS); laws e98c8ae7a "THE_LAWS sharpened and THE_LAW_OF_CHECKING added"; landed 5d1bbbf36 (2026-09-27).
- **Bottleneck relieved:** guide growth: "Its source grew from 3,355 words at f2da8f5f2 (2026-04-27…) to 11,435 at 35964e981 (2026-09-26…), one justified paragraph per feature, because nothing asked each paragraph to earn its place on the always-loaded tier." (`agent-guide-spec.md`). bbx-context: "Past a few thousand tokens, models drop instructions".
- **New bottleneck exposed:** every feature now has to fit the budget; the budget is raised by hand with a recorded reason (ledger header lists raises on 2026-09-27, 2026-10-06 +89, 2026-10-07 +28). Main went over budget once: 2026-10-02 0e653763d "Issue: agent guide over its word budget on main", fixed 061d2a8a2 "Trim agent-guide markdown pointer to fit word budget". "A new law needs a failure someone has seen" (`docs/agent-guide.md`).
- **Evidence:** budget `guide_words: 5595`, `always_loaded_words: 10330`, `uncited_words_per_section: 60` (`sed -n 19,25p beebox/src/core/agent-guide/ledger.yaml`). Measured now on a fresh bare box: `cd beebox && pnpm -s lint:guide --report` → "guide: 5555 words; always-loaded: 10289 words", 0 uncited words in 21 of 22 sections (ABOUT_CARDS 37). Before: rendered guide 9,234 words on the test1 clone (plan; different box than today's bare-box measure). Ledger 142 rows: law 11, core 82, indirect 32, delete 17 (`grep -E '^\s+bin:' ledger.yaml | sort | uniq -c`). Four laws: QUOTING, SAVING, CARDS, CHECKING. `lint:guide` in 99 Bash calls / 13 sessions since 2026-09-27 (transcripts).
- **Outcomes:** guide roughly 9.2k → 5.6k rendered words (different boxes; judgment: direction is reliable, exact ratio is not). Closed issue 2026-07-04-instruction-surface-size-budget. Budget caught one over-budget main (0e653763d → 061d2a8a2). Ledger rows link rules to audits.
- **Prior-art mention:** none of the four by name; dev/agent-knowledge.html section 4 covers the analogous dev-side CLAUDE.md being "caught at 218 lines, halved in a single day".

## Box CLAUDE.md design and placement tiers (bbx-context)
- **One line:** a skill and docs that route each piece of box-agent guidance to the lightest surface that loads when needed: root CLAUDE.md, nested CLAUDE.md, `.claude/rules/` path globs, schema `instructions` (emitted as `card-<type>.md`), box docs, procedures.
- **Lives in:** `.claude/skills/bbx-context/SKILL.md`, `beebox/src/core/init-rules.ts`, `beebox/docs/box-guidance.md` (registry of box guidance), `beebox/docs/prompts/review.md` ("layering model"), `beebox/src/core/docs-gen/package-docs/reducing-claude-md-doc.ts` → `box-docs/reducing-claude-md.md`, `claude-md-size` lint.
- **Appeared:** schema instructions + init-rules 2026-02-07 1c4aa2f6f "Add schema instructions and cb init-rules command"; size lint 2026-06-17 227fe6582 "feat(validate): soft size warning for oversized box CLAUDE.md"; strategies doc 2026-06-20 f31ca4cd1; skill 2026-06-20 684932e71 "feat(skills): add cb-context, box-side context-engineering skill (G1)"; registry 2026-09-26 e3ffeb729 "One registry for box guidance; generated files carry a DOCID marker and prune by it"; trimmed 2026-10-07 368b5a774 "bbx-context is the 38-line routing core".
- **Bottleneck relieved:** "When an agent ignores a written rule, suspect file length first." / "Default suspicion: before adding a paragraph to the root CLAUDE.md, ask whether it is relevant on every turn." (`bbx-context/SKILL.md`).
- **New bottleneck exposed:** generated guidance files orphan and park: closed issues `2026-09-26-maps-finalizer-shims-over-tracked-guides`, `2026-09-19-guide-card-template-updates-park-forever`; open `issues/bugs/2026-09-30-docs-refresh-misses-box-local-schema-changes.md`.
- **Evidence:** 12,000-char warn threshold (skill text); skill 14 commits (`git log --follow --format=%h -- .claude/skills/bbx-context/SKILL.md | wc -l`); Skill tool invoked 5 times (2026-09-26..10-07, transcripts).
- **Outcomes:** skill reduced to 38 lines (368b5a774). The placement table is the basis for the guide ledger's `indirect` bin. Judgment: low direct invocation; its rules live on mainly through the ledger bins and `docs/prompts/review.md`.
- **Prior-art mention:** dev/skills-review-2026-10.md yes ("shrink to ~80 and absorb knowledge-audit"); dev/agent-knowledge.html yes (3 mentions, as a skill).

## Agent-context renderer (`pnpm agent-context`)
- **One line:** renders the full assembled context a box agent sees for a situation (chat, chat-thread, reactor, procedure), layer by layer with loading class and word counts.
- **Lives in:** `beebox/src/dev/agent-context.ts`, `beebox/src/dev/lib/context-assembly/`, `beebox/docs/prompts/review.md`.
- **Appeared:** 2026-07-01 d3a8f0d6a "feat(dev): pnpm agent-context — render an agent's full context per situation".
- **Bottleneck relieved:** "Review the *assembled stack*, not the source files: judge what an agent actually reads, end to end." (`docs/prompts/review.md`).
- **New bottleneck exposed:** "Boxes go stale. The box-side layers … are what `bbx init` last wrote" (same doc).
- **Evidence:** substring `agent-context` in 320 Bash calls / 79 sessions (2026-08-09..10-09; includes paths like `agent-context.ts`, so an upper bound).
- **Outcomes:** its "always-loaded total" is the second number the guide budget asserts (`always_loaded_words`). Judgment: the most-used of the prompt-inspection tools by session count.
- **Prior-art mention:** none.

## Prompt viewer and prompt report (dev/prompts/)
- **One line:** `pnpm prompt-viewer` writes data for a browsable page of every agent prompt: static inventory, three assembled contexts, a duplication report, and a size ledger; `pnpm prompt-report` is the older flat inventory.
- **Lives in:** `beebox/src/dev/prompt-viewer.ts`, `beebox/src/dev/lib/prompt-viewer-data/{data,duplication,naming}.ts`, `dev/prompts/index.html`, `dev/prompts/size-ledger.jsonl`, `beebox/src/dev/prompt-report.ts`, `beebox/src/dev/lib/prompt-inventory.ts`.
- **Appeared:** prompt-report 2026-03-16 cb1fa8f71 "Add prompt-report dev tool for reviewing all system prompts"; viewer 2026-07-12 9145f23f2 "feat(dev): prompt viewer — browsable prompt surface at dev/prompts/", dae77a80c "address codex review of the prompt viewer".
- **Bottleneck relieved:** prompts scattered across generators (`src/core/agent-guide/`, `chat/session/prompts.ts`, `reactor/prompts.ts`, schema `instructions`, skills-content) with no single view (`docs/prompts/review.md`).
- **New bottleneck exposed:** the size-over-time ledger never accumulated (one line); size tracking moved to the audit context ledger and the guide budget.
- **Evidence:** `wc -l dev/prompts/size-ledger.jsonl` → 1 (2026-07-12, chat always-loaded 9,821 words / 16,760 tokens). Viewer code 3 commits (`git log -- beebox/src/dev/prompt-viewer.ts beebox/src/dev/lib/prompt-viewer-data | wc -l`); prompt-report 19 (`git log --follow`). Transcripts: `prompt-viewer` in 22 Bash calls / 11 sessions.
- **Outcomes:** the 2026-07-12 snapshot is the only "before" number for always-loaded chat context (9,821 words) to compare with today's 10,289 always-loaded on a bare box (different boxes). Judgment: low ongoing use; superseded in practice by agent-context and lint:guide.
- **Prior-art mention:** none.

## Prompt lenses and prompt-surface review
- **One line:** a written review procedure and lens catalog (overlap, redundancy, staleness, contradiction) for auditing the assembled prompt stack, plus "Writing rules that get followed".
- **Lives in:** `beebox/docs/prompts/review.md`, `beebox/docs/prompts/lenses.md`, `beebox/docs/prompts/logging.md`.
- **Appeared:** lenses 2026-05-19 fd3460380 "docs: prompt audits + idea entries from Reddit-tips discussion"; review doc 2026-07-01 d3a8f0d6a; regrouped 2026-09-26 89514ecc1.
- **Bottleneck relieved / exposed:** not stated separately from agent-context.
- **Evidence:** 3 files under `beebox/docs/prompts/`.
- **Outcomes:** the July 2026 prompt-surface review overhaul that the audit rerun measured. Judgment: procedure doc, no run record.
- **Prior-art mention:** none.

## Instruction placement rule: "altitude"
- **One line:** a recurring rule that a doc or instruction should sit at the altitude its importance earns (pointer in the prompt, details in docs).
- **Lives in:** cited in plans, e.g. `beebox/docs/plans/document-comments.md:636`, `implemented-plans/doc-structure.md:72`, `bbx-agent-surface.md:412`; dev/agent-knowledge.html calls the root CLAUDE.md "a new altitude".
- **Appeared:** not traced to one commit; first `git grep altitude` hits are in plans.
- **Evidence:** `grep -rn -i altitude beebox/docs .claude/skills --include=*.md | wc -l` (10+ plan mentions).
- **Outcomes:** Judgment: a vocabulary item that shaped tier decisions; no instrument of its own.
- **Prior-art mention:** dev/agent-knowledge.html yes (section 5).

## Documentation graph and doc-check (orphans, undescribed, broken refs)
- **One line:** `pnpm doc-graph` regenerates a cross-reference report of every doc (orphans, broken refs, descriptions); `doc-check` is the commit-time enforcement twin.
- **Lives in:** `beebox/src/dev/doc-graph.ts`, `beebox/docs/doc-graph.md` (generated, tracked), `beebox/docs/doc-graph.html`, `beebox/src/dev/doc-graph-html/`, `beebox/src/dev/doc-check/`.
- **Appeared:** 2026-03-04 1a45afb09 "Add documentation graph tool, fix doc orphans and descriptions"; 2026-05-05 e22736475 "Restore src/dev/doc-graph.ts"; enforcement 2026-07-04 efad24c61 "feat(docs): doc-check enforcement — broken refs + live-area orphans fail commits".
- **Bottleneck relieved:** docs no agent could reach by following links.
- **New bottleneck exposed:** shipped plans are orphans by design — 98 `[ORPHAN]` entries, most under `docs/implemented-plans/`; doc-check enforces only "live-area" orphans. Issue `issues/closed/docs-and-chores/2026-08-22-doc-check-skips-untracked-docs.md`.
- **Evidence:** `head -5 beebox/docs/doc-graph.md` → "Total documents: 510"; `grep -c '\[ORPHAN\]' beebox/docs/doc-graph.md` → 98; doc-graph.md in 165 commits (`git log --format=%h -- beebox/docs/doc-graph.md | wc -l`).
- **Outcomes:** regenerated with ordinary doc commits (165 commits); doc-check blocks broken refs at commit. Judgment: the graph is a by-product now; the enforcement half does the work.
- **Prior-art mention:** dev/meta-practices.html yes (1 mention); others no.

## Living docs vs. the dead tail (doc-read census)
- **One line:** a one-time census of which tracked Markdown files agents ever opened, from transcripts.
- **Lives in:** `dev/agent-knowledge.html` section 6.
- **Appeared:** 2026-06-23 0c180c857 "feat(dev): add the /dev/ visualization space + markdown doc browser".
- **Bottleneck relieved:** no data on which docs carry weight.
- **New bottleneck exposed:** not visible; not repeated.
- **Evidence:** original: "Of 333 tracked .md, only 176 distinct names were ever opened by an agent." Recomputed 2026-10-09: `git ls-files '*.md' | wc -l` → 3,008 (1,823 excluding `issues/`). Read-tool census (`python3 -I scratchpad/tools/mdreads.py <worktree>`): 577 distinct repo-relative .md paths read; 318 of 3,008 tracked files read under their current path (230 of 1,823 non-issue); 475 of 2,339 transcript files contain a .md Read. Caveats: counts only the Read tool (not `cat`/`sed` in Bash), files that moved since being read count as unread, and transcript retention is incomplete.
- **Outcomes:** Judgment: the ratio has fallen (176/333 → ~318/3,008 by a stricter measure); the tracked-doc count grew 9× in 3.5 months, mostly issues and plans.
- **Prior-art mention:** dev/agent-knowledge.html yes (it is the source).

## User-story capability catalog
- **One line:** a multi-agent workflow reads the source, writes "the product can do X" stories, adversarially verifies each against code and the running app, panels the flags, and renders a dated catalog; the developer annotates it and agents triage the annotations.
- **Lives in:** `beebox/docs/user-stories/README.md`, `beebox/docs/user-stories/catalog/{2026-06-26.md,2026-08-21.md,.jsonl,.meta.json,.id-map.json}`, `beebox/src/scripts/user-stories/*.workflow.ts`, `validate-discovery.ts`, `freeze.ts`, `render.ts`, `stale.ts`, `recheck.workflow.ts`, `apply-recheck.ts`; issue frontmatter `stories: [<id>]`.
- **Appeared:** 2026-06-26 36ac65226 "docs(<old-package>): add auto-generated user-stories catalog" (413 stories; "12 route-reachable frontend stories additionally verified by driving the live app with bin/browse (9/12 confirmed)"); same day c609de642 "resolve user-story catalog for buckets A4 + C" ("clear the IAN: notes … Catalog 404->400") and fcc5bc720 "park unbuilt bucket-D features in ideas.md; clear catalog IAN annotations". Second run 2026-08-21 6cdf4ccf8 "regenerate the user-story catalog", 2fa2b8647 "give it one home, and make the catalog reproducible", 25f9f94c7 "make the catalog maintainable, and file the gaps that were missed".
- **Bottleneck relieved:** dev/workstream-story.md (branch worktree-workstream-story), "Fifth ask": "confirming changes one at a time never answers whether the product does its job." README: "nothing in the document is asserted by the agent that wrote it".
- **New bottleneck exposed:** (a) panel voting bug: "shipped three stories with a ✅ directly above their own panel note… Fixing the rule flipped 21 of 28 results" (README); (b) cost: "~420 agents, ~30M tokens" on the inherited model; (c) rot: "starts rotting the day it is committed", answered by `stale.ts` and per-story recheck; (d) provenance ids broke citations → `rekey.ts`; (e) the catalog "has no notion of a person with a motive" (`docs/plans/user-story-journeys.md`) → journeys.
- **Evidence:** 2026-08-21 run: discovered 1,024 → retained 667 (`head beebox/docs/user-stories/catalog/2026-08-21.meta.json`; `wc -l …jsonl` → 667). Issues: 50 with `discovered-in` naming user-stories/catalog (`git grep -l -i 'discovered-in:.*\(user-stor\|catalog\)' -- issues | wc -l`), 39 of them closed (same, `-- issues/closed`); 33 of the 50 are not journey-derived (`… | xargs grep -L -i 'discovered-in:.*journey' | wc -l`). `stories:` frontmatter: 0 issues use it (`git grep -l '^stories:' -- issues | wc -l`).
- **Outcomes:** two full runs (2026-06-26, 2026-08-21); first run's developer annotations resolved the same day (deleted stories for removed features, parked bucket-D features into ideas). Second run filed ~33 non-journey issues, 39 of 50 user-stories issues now closed. No full run since 2026-08-21; the recheck loop's `stories:` link is unused. Judgment: produced a large one-time batch of issues; the maintenance loop exists but has no recorded use; workstream-story calls the fifth ask "Started; not settled."
- **Prior-art mention:** dev/workstream-story.md yes ("Fifth ask, in progress: review at the story level"); others no.

## User-story journeys (simulated-person walks)
- **One line:** an agent with browser access plays one person with one life goal, knowing only "an AI-powered app for organising your life", walks a freshly provisioned box, and writes loose in-character notes.
- **Lives in:** `beebox/test/user-stories/journeys/{README.md,walker-prompt.md,prepare/core.ts,collect.ts,provisioning.ts,clock.ts,agent-time.ts}`, five journeys `A-lending B-inventory C-reconnecting D-chemistry F-newcomer` (`journey.yaml`, `assets/`, `reports/`), doctest `beebox/test/user-stories/journey-provisioning.doctest.md`, plan `beebox/docs/plans/user-story-journeys.md` (status draft).
- **Appeared:** 2026-08-22 696109c42 "docs(plans): propose the journey-shaped user stories, and file an exhibits gap"; 92294ea1c "feat(journeys): make a journey a definition and a script, not a conversation"; ec6e43bf8 "the get-to-know run becomes a mission, not a wander". Later: 2026-09-20 2014c37b6 "Walk reconnecting journey and repair the journey harness", c796cc666 "Fix journey browser guards and exclude microphone testing"; 2026-10-08 700c5c24e / ffaaea8f5 harness fixes; 7df3bd4d9 "Journey walks 2026-10-08: six reports, 40 new issues, 15 re-encounters".
- **Bottleneck relieved:** "Nothing in it starts from someone who wants to stop losing track of what they lent out and has never heard the word 'card'." (plan). README: "this answers 'can someone actually use it for something they wanted', which is a different question and the catalog is structurally blind to it."
- **New bottleneck exposed:** the walk's evidence is unreliable on its own (→ after-action, next entry); harness leakage — `issues/bugs/2026-10-08-box-agent-can-read-journey-walk-notes.md` (box agent can reach walk notes via the linked engine), b09d73cfd "journey boxes must not inherit test1's conversations", 936612249 "Keep publication build trees out of box walkers"; journey E (mail arriving while away) not built (no `E-*` directory).
- **Evidence:** 14 committed reports: `ls beebox/test/user-stories/journeys/*/reports/*.md | wc -l`; by date 2026-08-23:2, 08-24:1, 08-25:1, 09-21:4, 10-08:6. 74 issues with `discovered-in` naming a journey (`git grep -l -i 'discovered-in:.*journey' -- issues | wc -l`), 34 closed (`… -- issues/closed`). Transcripts: `journeys/prepare` in 112 Bash calls / 14 sessions (2026-08-23..10-09).
- **Outcomes:** three walk rounds (Aug 23-25, Sep 20-21, Oct 8). Oct 8 round: "six reports, 40 new issues, 15 re-encounters" (7df3bd4d9). 34 of 74 journey issues closed. Plan still `status: draft`. Judgment: the largest single issue source in this area; re-encounter counts give a crude measure of what did not get fixed between rounds.
- **Prior-art mention:** none of the four ("journey" 0 hits each).

## Journey after-action pass
- **One line:** a documented procedure that turns a walk's notes into verified findings: collect box commits and screenshot timestamps first, read whole notes, split every claim, verify each against box, logs, and source, then write `reports/<date>.md`.
- **Lives in:** `beebox/test/user-stories/journeys/after-action.md`, `collect.ts`; reports under `<journey>/reports/`; `prepare.ts` "refuses to run if an earlier walk has notes but no nonempty report".
- **Appeared:** 2026-08-24 42a74680b "feat(journeys): after-action reports, and prune a run once it has one". 4 commits total (`git log -- …/after-action.md | wc -l`). Cross-model review of reports: 2026-10-08 2500abb76 "Journey reports: apply cross-model review adjudication", da2ceaf3f "(review round 2)".
- **Bottleneck relieved:** "On 2026-08-24, three of the seven bugs a walk reported were ours … Filing them unexamined would have put three false bugs in the queue" (`after-action.md`). Rule: "Nothing from a walk becomes a finding until it has been separately verified."
- **New bottleneck exposed:** agent time per walk (reports now go through cross-model review rounds); "Timing currently reads only Claude root-chat transcripts" (journeys README).
- **Evidence:** 14 reports (above); 2 review commits on the Oct round.
- **Outcomes:** 3 of 7 claims in the 2026-08-24 walk identified as harness faults before filing; the report is the only tracked artifact of a walk and is enforced by `prepare.ts`. Issue counts as in journeys entry. Judgment: the pass is what makes journey issue counts trustworthy.
- **Prior-art mention:** none.

## Field probes
- **One line:** for bugs only reproducible on the boxholder's phone or prod, ship default-off, bounded, content-free instrumentation, hand the boxholder a ≤5-step script under a fixed "FIELD PROBE — your move" headline, pull the trace from the box's client debug log, and decide the probe's fate.
- **Lives in:** `.claude/skills/field-probe/SKILL.md`; house pattern `beebox/src/frontend/src/lib/scroll-diagnostics/diagnostics.ts` + `/scrolldebug`; `beebox/docs/client-debug-log.md`; `beebox/src/frontend/public/probe-boot.html`.
- **Appeared:** 2026-08-12 367aaa785 "Add /scrolldebug: flag-gated scroll-controller trace", c64c96b9f "Add field-probe skill: deploy-instrumentation debugging protocol", 7651259df "document /scrolldebug trace". Later: 2026-08-28 5a1203fac "probe(frontend): static boot-sequence diagnostics page for the phone outage"; 2026-09-25 worktree-admin-hang-probe (62c8ff444, e02ab03af).
- **Bottleneck relieved:** "The boxholder is part of the loop, so the protocol optimizes for their time" / "A probe that reaches the device broken wastes a boxholder round-trip, the most expensive resource here." (skill).
- **New bottleneck exposed:** "A green desktop scenario plus a deployed probe is still an unverified fix until the boxholder's trace … confirms it" (skill); chat scroll still open: `issues/bugs/2026-09-04-chat-scroll-still-bad-after-rewrite.md`.
- **Evidence:** 4 probe episodes visible in git (scroll 08-12, boot 08-28, admin hang 09-25, iOS clear-message race referenced in `issues/bugs/2026-08-30-ios-clear-message-race.md`) — from `git grep -l -i 'field.probe'` and `git log -i --grep='probe'`. Skill invoked once in transcripts (2026-08-28); `scrolldebug` in 37 Bash calls / 15 sessions.
- **Outcomes:** one closed bug cites it (`issues/closed/bugs/2026-08-13-chat-cannot-stay-at-bottom-while-growing.md`); `/scrolldebug` kept as a documented keeper. Judgment: rarely triggered by design; scroll remained unresolved after probing.
- **Prior-art mention:** dev/skills-review-2026-10.md yes ("keep; fix content/.beebox/ to .beebox/").

## Manual-testing catch-up queue (`needs: [manual-testing]`)
- **One line:** an issue tag meaning "landed, and nobody has looked at it yet", forming the developer's catch-up list; `verify-without-me` lets an agent release the gate.
- **Lives in:** `issues/CLAUDE.md` (lines ~95-155), `.claude/skills/bbx-issue-actions/`.
- **Appeared:** 2026-07-19 7bf895a48 "issues: add needs: [manual-testing], and de-XML the card-prominence issue".
- **Bottleneck relieved:** workstream-story "The developer is the slowest test stage": "Code lands faster than one person can try it."
- **New bottleneck exposed:** the queue itself; the fifth ask (story-level review) is framed as "Same shape as the manual-testing queue, one level up".
- **Evidence:** 35 open / 27 closed issues mention `manual-testing` (`git grep -l 'manual-testing' -- issues ':!issues/closed' | wc -l`; `… -- issues/closed`).
- **Outcomes:** 27 gated issues closed. Judgment: the queue is larger open than closed.
- **Prior-art mention:** dev/workstream-story.md yes (6 mentions, "The developer is the slowest test stage").

## Manual-tests schedule (weekly manual suite triage)
- **One line:** weekly run of the manual test suite; on failure an agent diagnoses and appends to issues only (append-only enforced by `check`).
- **Lives in:** `schedules/manual-tests/{schedule.yaml,run.ts,check.ts,prompt.md}`.
- **Appeared:** 2026-08-24 00bbd508d "schedules: enroll manual-tests (Track F)".
- **Bottleneck relieved / exposed:** not stated beyond the prompt. Distinct from the needs:[manual-testing] queue despite the name.
- **Evidence:** 7 runs 2026-08-25..2026-10-07 (`ls ~/src/schedule-runs/manual-tests/runs | sed -E 's/^([0-9]{8}-[0-9]{6}).*/\1/' | sort -u | wc -l`), 4 with handoffs.
- **Outcomes:** Judgment: runs weekly; last run clean (`bin/schedules list`).
- **Prior-art mention:** none.

## CODING_FEEDBACK checkpoint notes
- **One line:** at four checkpoints (plan-reviewed, implemented, review-adjudicated, landed) a dev agent writes a four-question retrospective note (what was slow, what guidance was wrong, what tracked-file change would help, what codebase change would help), stored outside git.
- **Lives in:** `bin/coding-feedback.ts`, `bin/lib/coding-feedback.ts`, `bin/lib/coding-feedback-session.ts`; store `<parent of main checkout>/workstream-exhibits/<workstream>/coding-feedback/`.
- **Appeared:** 2026-10-07 b8fc4b1aa "CODING_FEEDBACK: retrospective notes at plan, implement, review, and landing".
- **Bottleneck relieved:** dev-agent friction was only visible by reading transcripts.
- **New bottleneck exposed:** needs a reader → retrospective schedule (same day).
- **Evidence:** 54 entries across 12 workstreams (`find ~/src/workstream-exhibits -path '*coding-feedback/*' -type f | wc -l`; `ls -d ~/src/workstream-exhibits/*/coding-feedback | wc -l`); `coding-feedback add` in 37 Bash calls / 28 sessions (2026-10-08..10-09).
- **Outcomes:** 2 days old; feeds the retrospective. Judgment: too new to assess.
- **Prior-art mention:** none.

## Retrospective schedule ("arrange context, don't automate judgment")
- **One line:** every three days an unattended agent gets a packet (CODING_FEEDBACK notes, recurring human instructions and tool failures from transcripts, skill use, escaped bugs, its prior watch list) and lands guidance edits backed by two or more pieces of evidence, after cross-model review.
- **Lives in:** `schedules/retrospective/{schedule.yaml,prompt.md,run.ts,lib.ts}`.
- **Appeared:** 2026-10-07 3cf3c3965 "schedules/retrospective: every 3 days, turn CODING_FEEDBACK into guidance changes"; 10e7c1466 "a run ignores its own session's output"; 0deb7b9ad "the schedule lands its own reviewed edits; exhibits are fyi"; merged 41f067de7.
- **Bottleneck relieved:** guidance repair depended on the developer noticing repeats. Principle: "Arrange context, do not automate judgment" — 20 tracked .md cite it (`git grep -il "rrange context" -- '*.md' | wc -l`); earliest `git log -S'rrange context'` → 2026-06-27 40f226d43 "plan: procedure validation completion (D5)" and cc929eca3. Prompt: "Make no edit you cannot point at evidence for." and "In any skill or agent file, remove more lines than you add."
- **New bottleneck exposed:** 3 open alerts on the schedule (`bin/schedules list`).
- **Evidence:** 2 runs, both 2026-10-07 (`ls ~/src/schedule-runs/retrospective/runs`); 3 landed commits with `Workstream: retrospective` trailer (`git log --grep='Workstream: retrospective'`): 0626aeb18, e0e01bf16, 7fd7718fa (cross-model skill edits).
- **Outcomes:** 3 skill edits landed in its first day. Judgment: too new to assess beyond that.
- **Prior-art mention:** none ("retrospective" 0 hits in all four).

## Agent-docs refresh schedule
- **One line:** weekly unattended agent maps `main` commits to public agent-facing docs (`site/docs/`, `site/docs-manifest.yaml`), verifies against code, edits, builds, and hands off.
- **Lives in:** `schedules/agent-docs-refresh/{schedule.yaml,prompt.md,run.ts}`; design `beebox/docs/plans/agent-docs.md`, `site/docs-authoring.md`.
- **Appeared:** 2026-09-16 a41536f24 "Schedule agent-docs-refresh: weekly review of main's changes against the public docs".
- **Bottleneck relieved:** public docs drifting from the code; prompt: "change the page to match the code, never the other way round".
- **New bottleneck exposed:** 1 open alert (`bin/schedules list`).
- **Evidence:** 4 runs 2026-09-16..2026-10-08 (`ls ~/src/schedule-runs/agent-docs-refresh/runs | … sort -u | wc -l`); 3 commits with `Workstream: agent-docs-refresh` (a5c808ada 09-23, 8695512c5 10-01, 5ea1a7219 10-08).
- **Outcomes:** one refresh commit per week after the first run. Judgment: working as scheduled.
- **Prior-art mention:** none.

## Session critiques
- **One line:** `bbx session <id> --tool-report` extracts a transcript with full Bash output, and a critique subagent grades whether CLI tools served the agent (unhelpful output, missing commands, wrong tool…).
- **Lives in:** `beebox/src/dev/lib/session-report/`, `beebox/docs/testing/session-critiques.md`.
- **Appeared:** 2026-03-05 865655555 "Add session critique tool for evaluating CLI output quality".
- **Bottleneck relieved:** "Unlike knowledge audits (which test what the agent knows), session critiques test whether the tools the agent used gave it good output." (doc).
- **New bottleneck exposed:** not visible.
- **Evidence:** doc says the subagent is in `.claude/agents.json`; that file does not exist (`ls .claude/agents.json` → No such file). `--tool-report` appears in 13 top-level transcripts (`grep -l -- '--tool-report' ~/.claude/projects/*beebox*/*.jsonl | wc -l`).
- **Outcomes:** Judgment: low use; the doc's subagent reference is stale.
- **Prior-art mention:** none.

## Instruction experiments and prompt calibration pilots
- **One line:** small, pre-registered offline runs testing how models respond to instruction wording: dev-side skill routing/authority cases across four models; box-side triage instructions on a small model.
- **Lives in:** `beebox/docs/reports/prompt-calibration-pilot-2026-09-12.md` (+ `.results.json`), `beebox/docs/implemented-plans/prompt-calibration.md`, `beebox/docs/reports/jev-instruction-experiment-2026-09-28.md`, `beebox/test/fixtures/triage-evaluation/instructions/protocol.json`.
- **Appeared:** 2026-09-12 880f9d4d0 "Complete instruction calibration and record decision pilot"; 2026-09-28 2f021c00a "Evaluate household triage and plan replayable document routing".
- **Bottleneck relieved:** pilot found "copying of invented task details from a worked briefing example; the example was replaced with explicit fill-in fields".
- **New bottleneck exposed:** reports disclaim scope: "not native skill activation rates, end-to-end execution evidence, or proof of improvement".
- **Evidence:** pilot 12 routing cases + 5 authority scenarios × 4 models; experiment 192 calls, 0 errors (reports).
- **Outcomes:** one worked example rewritten (pilot); triage instruction design adopted as proposal (experiment). Judgment: one-off.
- **Prior-art mention:** none.

## Smoke walks and tours (cross-reference only)
- **One line:** scripted agent walks of the app's pages; weekly `smoke-review` and `tour-check` schedules review their shape. Mechanics belong to the quality sweep.
- **Lives in:** `beebox/docs/testing/tours.md`, `beebox/docs/testing/smoke.md`, `schedules/smoke-review/`, `schedules/tour-check/`.
- **Appeared:** tours 2026-07-10 88bb0526c "tours: formalize"; schedules 2026-08-26 a5e8e624c (smoke-review), 2c9d75eed (tour-check).
- **Knowledge link:** smoke review produced repeated evidence of landings nobody walked: 2026-09-30 27d4e239a "second window of evidence for unwalked landings", 2026-10-07 d61941575 "third window"; open `issues/features/2026-09-23-smoke-gate-skipped-by-scheduled-and-direct-landings.md`.
- **Evidence:** smoke-review 8 runs, tour-check 7 runs (`~/src/schedule-runs/<name>/runs`, distinct run ids).
- **Outcomes:** see quality sweep.
- **Prior-art mention:** none ("tour" 0 hits).

## Agent browsing as the box owner
- **One line:** the browse key acts as the owner on boxes whose `config/box.json` sets `agentBrowsing: "owner"`, so walkers and catalog browser passes see owner-gated pages.
- **Lives in:** `beebox/docs/implemented-plans/agent-browsing-owner.md`.
- **Bottleneck relieved:** 2026-08-21 catalog run: owner-gated surfaces returned 403 — "most of the 57 inconclusive checks, a third of the browser pass" (user-stories README); 2026-08-24 walk's 401 harness bug (`after-action.md`).
- **Appeared:** 2026-08-26 2af357ca0 "auth: a box opts in to agent browsing as its owner" (`git log --follow --diff-filter=A -- beebox/docs/implemented-plans/agent-browsing-owner.md`).
- **New bottleneck exposed:** not visible.
- **Evidence:** not counted.
- **Outcomes:** Judgment: removed the owner-403 class of harness false findings for later walks; the catalog README tells the next run to check the box setting.
- **Prior-art mention:** none.

---

## Summary
- Box-side knowledge measurement is the most built-out: 406 audits, 363 dated status records, 1,042 recorded runs since 2026-06-21, a 142-row guide ledger with an asserted word budget (5,555 / 10,289 words now vs 9,234 rendered before the 2026-09-26 spec, different boxes).
- Dev-side measurement started 2026-10-07: 11 dev audits, CODING_FEEDBACK (54 entries), retrospective (2 runs, 3 landed commits).
- "Seeing as a user": two capability-catalog runs (413 → 667 stories), 14 journey reports in three rounds, 74 journey-filed issues (34 closed), ~33 catalog-filed issues; the after-action pass exists because 3/7 early walk claims were harness faults.
- Gaps/abandoned: prompt-viewer size ledger has 1 line; catalog recheck loop's `stories:` link used by 0 issues; journey E not built; session-critique doc references a missing `.claude/agents.json`.

## Not verified
- "Altitude" origin commit.
- The doc-read recount uses Read-tool calls only and current paths; not comparable 1:1 with the 333/176 figure, whose method is not recorded.
- Transcript retention: transcripts start 2026-01-05 in the scanned dirs but may be incomplete; Codex sessions (~/.codex) not counted.
- Knowledge-audit run counts before 2026-06-21 (no ledger then).
- Did not run any audit or anything against a box; `lint:guide` ran on a temporary bare box only.
