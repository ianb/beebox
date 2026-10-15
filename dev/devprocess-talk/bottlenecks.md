# The bottleneck narrative: a draft

Draft for the development-practice talk. Thesis: each improvement relieves one constraint and exposes the next; the practice is the sequence of moves past them. This page orders the constraints the repository actually hit, names what got built past each, maps the [inventory](inventory.md) onto that order, and lists candidate stories and numbers for slides. It does not write slides. Evidence and commands are in the [sweep reports](reports/).

The developer's own example sets the shape: user journeys were bottlenecked on one person's ability to clear their mind of expectation and to do the walking, so the walking was handed to an agent playing a person (2026-08-22). That is bottleneck 7 below.

## The shape in one table

| # | Dates | Constraint hit | What got built past it | What that exposed |
|---|---|---|---|---|
| 0 | Jan 30 – Mar 3 | Each session rediscovers the project; the harness cannot read test output | CLAUDE.md; vibe-check preset and per-edit lint hook; doctests; knowledge audits for box agents | The always-loaded file bloats to 218 lines |
| 1 | Mar 3 – Mar 10 | Instruction bloat | Condense (−100 lines) the same day as the first nested CLAUDE.md files; self-improvement meta-instruction; doc graph; stack decisions | The meta-instruction regrows the file one rule per correction (114 → 184 by September) |
| 2 | May 26 | One agent at a time; parallel agents collide on main | Monorepo merge; worktrees; shared router; skills (finish, browse, launch); finish teardown | Parallel sessions become cheap, so they accumulate; the merge silently broke per-package hooks and revealed 1,000 suppressed lint violations |
| 3 | May 29 – Jun 26 | Bigger tasks need a design and a reviewer; one model cannot see its own blind spots | Plan docs and bbx-plan; Codex cross-model review; craft skills; user-story catalog; `/dev/` pages; context-size ledger | Landing churn fills the main thread (finish moves to a subagent, Jul 3); the ideas file reaches 1,681 lines |
| 4 | Jul 4 – Jul 31 | Findings outrun one person's capacity to act | issues/ tree with one file per tension; doc-check enforcement; categories; `needs: [manual-testing]`; Fable delegates; contract tripwires; tours formalized | "Sessions are doing double duty as a to-do database" (Aug 8); ~9 live sessions, 20 GB of swap |
| 5 | Aug 1 – Aug 26 | Human attention across a dozen streams; the test suite too slow and too often red; a second engine | Codex engine and the CLI seam; workstream ≠ worktree; fail-closed liveness; dashboard; exhibits; comments; journeys and after-action; bin/issues and pick-issues; provenance trailers; schedules; hourly full suite; test selection, ledger, semaphore; smoke tier; weekly tour check | Host memory (18 GB swap, Sep 11); alert noise (143 in September); 49 flaky files; exhibits answered in chat, not in the page; instruction surfaces at their peak size |
| 6 | Sep 11 – Sep 27 | Instruction size and persuasion; guidance drift; unattended noise | Prompt calibration (root 2,242 → 850 words, package 184 → 67 lines); alert conditions and digest; host-pressure gate; agent-guide ledger with an enforced word budget; layout check; GLM capacity | Root regrows 50% in four weeks; landings nobody walked (three windows of smoke evidence) |
| 7 | Oct 2 – Oct 8 | The process itself has no measurement or feedback loop; authorization is ambiguous | Transcript-based skills review (6 skills retired, mechanics into scripts, skill lint, sigil refusal); dev-guidance audits; CODING_FEEDBACK and the retrospective schedule; stranded-work handling; local next-action store and `do-it`; "How much to do" ladder; bbx-design; third journey round | Too new to see |

The pace follows the table. Commits per month: 25, 201, 266, 214 (Jan–Apr), 482 (May), 748 (Jun), 1,510 (Jul), 2,305 (Aug), 2,268 (Sep). Worktree landings per month: 6, 34, 25, 114, 305 (May–Sep). Code went from 11,858 to 390,172 non-blank lines; docs now stand at about 63% of code.

## The bottlenecks, one by one

### 0. The agent forgets, and cannot read its tools (Jan–Feb)

The first package CLAUDE.md is the oldest file in the repo (2026-01-30, 217 lines). The lint preset and the per-edit lint hook followed two weeks later (Feb 13–17): the first agent-facing gate, feedback on every edit instead of at commit. Knowledge audits for the box agents arrived Feb 23, because there was no way to tell whether a guidance change had reached them.

The test harness was the next constraint: test files were code an agent had to reason about. Doctests (Mar 3) made tests Markdown the agent reads and writes, with TAP output chosen because "the consumers of test runs are agents reading through a pipe" (Jun 9). They became 83% of all test lines.

Techniques: package CLAUDE.md, vibe-check preset, PostToolUse lint hook, card validation, knowledge audits, doctests, scenario testing (later retired).

### 1. Instruction bloat (Mar 3)

By March 3 the package file was 218 lines. It was halved in one day, and the same day the first nested CLAUDE.md files appeared under services, connectors and reactor: the knowledge did not vanish, it moved to where it is used. Three days later the self-improvement meta-instruction told the agent to write a rule whenever it was corrected.

What that exposed took six months to show: the meta-instruction regrew the file one rule per commit, 114 → 184 lines, until the September rewrite. Two quiet lessons sit here. A cut without a budget does not hold. And the root instruction file, born at the monorepo merge with 65 words, followed the same curve: 65 → 2,242 → 850 → 1,277.

Techniques: condense, nested CLAUDE.md, self-improvement instruction, documentation graph, stack-decisions (frozen as history Sep 12), glossary (May 21).

Between Mar 7 and May 20 no new practice landed. Commits ran at 200–270 a month. This is the heads-down stretch the earlier meta-practices page already marked.

### 2. One agent at a time (May 26)

The monorepo was assembled on 2026-05-26 from five repositories, and on the same day: worktrees, the lazy-start router that serves every checkout by URL prefix, the finish skill with session-end cleanup, the browse wrapper, and the first skills. The constraint was collision: several sessions in one checkout, each told to stay in its area, did not.

The merge also exposed two things at once. Per-package husky hooks had silently stopped working (recovered the same day), and an audit found the lint integration had turned 18 rules off. The suppression ratchet recorded 1,000 violations on May 30 and reached zero on May 31, when the ratchet was deleted and the standing no-disable rule took its place.

Techniques: worktrees, test-box clones, router, browse daemon, launch-worktree-session, finish, teardown, skills, ratchet and no-disable rule, noise-as-bug rule.

### 3. Bigger tasks need a design and a second reader (Jun)

Cheap parallel sessions made it possible to hand agents multi-module work. Plans (bbx-plan May 29, the `docs/plans/` convention Jun 4) made the design explicit; cross-model review (Jun 4) put a different model family on the plan and the diff, because "a model can't catch the blind spots it shares with itself." The craft skills (Jun 20), the first user-story catalog (Jun 26, 413 stories), the `/dev/` page space (Jun 23) and the context-size ledger (Jun 21) all belong to this month.

Cross-model review is the quality technique with the most recorded catches: 134 commits pair a detection verb with the review in one sentence, 55 issues name a review as their source, and it reviewed most of the later gates (the smoke tier's two false greens, the lint economics' three gaps, the liveness guard that failed open).

What June exposed: landing a branch filled the main thread with merge and test output, so finish became a headless subagent (Jul 3). And the ideas file, where every out-of-scope thought went, hit 1,681 lines.

Techniques: bbx-plan and plan lifecycle, cross-model review, craft skills (mostly retired Oct 7), user-story catalog, `/dev/` pages, context-size ledger, finish subagent.

### 4. Findings outrun one person (Jul)

The ideas file became `issues/` on Jul 4: one file per tension, the directory is the state, closing is `git mv`, grep is the query engine, and an issue filed in a worktree merges with the code. Doc-check enforcement landed the same day, ending `--no-verify` on docs commits. Categories (Jul 10), the `needs: [manual-testing]` tag (Jul 19) and the first Fable delegation rule (Jul 9) followed.

The numbers from this point: 1,224 issues filed and 721 closed in three months; about 80% agent-filed with provenance; filing outpaced closing every month (Aug 448 vs 298, Sep 329 vs 208). Median open age is 45 days.

What July exposed is the sentence that reorganized the next month, from the issue filed Aug 8: "Sessions are currently doing double duty as a to-do database." An open tab was the only record of what still needed checking, so about nine accumulated on a machine that had exhausted its 20 GB of swap.

Techniques: issues tree and conventions, doc-check, categories, manual-testing tag, delegation rule, contract tripwires, tours, prompt viewer, agent-context renderer.

### 5. Human attention across a dozen streams (Aug)

August is the burst: 2,305 commits, 114 landings, 25 of the 31 skills ever created existed by its end, and 9 of the 15 schedules were born. Three constraints were hit together.

**Attention.** The workstream became the durable unit and the worktree a disposable cache (Aug 9); a worktree is culled when merged, clean, unpinned and agent-free, with liveness tri-state and fail-closed (0 "unknown" skips in 40 days of logs, 793 "live" skips, 144 removals with no human step). The dashboard (Aug 13), exhibits with one ask each (Aug 15), document comments (Aug 22) and provenance trailers (Aug 24) gave the human one view and the agents a durable, addressable output medium. The queue grew search, next actions, and pick-issues modes (Aug 13–24). The provenance it clusters on is written almost only by agents (1,018 of 1,036 agent-filed issues, 4 of 190 developer-filed): a field that costs an agent one line at filing time and that a person skips. Pick-issues is the batching step: issues arrive from feedback triage, reviews, walks and sweeps in item-sized pieces, and the skill clusters them into one session's work (six clusters claimed the day after it landed; the composer-intake one took four issues from four sources to four different fates).

**The suite.** Full runs "were mostly red for reasons the branch did not cause." Test selection, the ledger, the machine-wide semaphore and lint economics landed Aug 25; the hourly full suite with bisection took over main the same day; the smoke tier followed on Aug 26 because three escapes in two days had passed typecheck, lint and selected tests while the app was broken. Scheduled work replaced four silent launchd jobs on Aug 24 and became 15 schedules.

**A second engine.** Codex sessions arrived Aug 4, and because they had to impersonate Claude Code's hook JSON, the lifecycle moved into a plain CLI (the seam, Aug 8–9). Codex has authored at least 283 commits on main since; 60-day transcripts show 508 Codex sessions, 423 of them scripted `exec` runs, consistent with Codex as the reviewer.

**Journeys.** The user-story catalog "has no notion of a person with a motive," so on Aug 22 an agent with a browser was given one life goal and a fresh box. On Aug 24 three of the seven bugs the first walk reported turned out to be faults in the test setup; the after-action pass exists because of that. Three rounds have produced 14 reports and 74 issues, 34 closed; the October round filed 40 new issues and found 15 repeats.

What August exposed: the machine (load average 40 with 11 concurrent test processes; 18 GB of swap on Sep 11), alert volume (143 in September), the flake load the ledger made visible (49 files), the exhibits answer loop (4 of 128 answered in the page), and instruction surfaces at their peak (root 2,242 words, 24 skills at 3,766 lines).

Techniques: workstream split, liveness, culling, seam, Codex engine, mirrors, dashboard, exhibits, comments, trailers, private-issues, bin/issues, next actions, pick-issues, frontmatter enforcement, schedules, full suite, test selection, ledger, careful tier, flake policy, semaphore, lint economics, smoke, tour-check, knip and supplemental sweeps, journeys, after-action, field probes, security report, agent browsing as owner.

### 6. Size, persuasion, and noise (Sep)

The September moves are corrections to August's growth. Prompt calibration (Sep 12) rewrote the root and package files and every skill description by deciding each item's purpose, necessity, compact form and destination: root 2,242 → 850 words, package 184 → 67 lines, skills 3,766 → 3,092 lines, with a four-model pilot of the result. The agent-guide spec (Sep 26) did the same for the box side with a ledger of 142 rules, four laws, and a word budget the linter asserts (9.2k → 5.6k rendered words); main has gone over budget once and was caught. Alerts gained conditions and a daily digest (Sep 18). The full suite gained a memory-pressure gate (Sep 11). The layout check (Sep 27) closed the file-placement drift after eight moves of 300–740 files each.

What September exposed: the root regrew 850 → 1,277 words in four weeks, because the dev-side files have no budget where the box guide does; and the smoke review began reporting landings nobody walked.

Techniques: prompt calibration, guide ledger and budget, bbx-context, alert conditions and digest, host-pressure gate, layout check, GLM provider, box-convergence, agent-docs refresh, security scan, retrospective principle ("arrange context, don't automate judgment").

### 7. The process measures itself (Oct)

The first week of October turned the instruments on the practice. A transcript counter (`bin/skill-usage`) showed that the human types almost only `finish` and that agents reach every other skill through its description; the review it fed retired six skills in a day, moved mechanics into scripts (cross-model 377 → 150 lines, launch 218 → 91, finish agent long since 624 → 165), added a skill lint, and made the launcher refuse the bare `/finish` sigils that 83 sessions had written despite a prose rule. Dev-guidance audits pointed the box audit harness at a Claude Code session in this checkout (Oct 7). CODING_FEEDBACK notes at four checkpoints feed a retrospective every three days that may land a guidance edit only when two pieces of evidence agree, with the stated principle: arrange context, do not automate judgment. The "How much to do" ladder (Oct 8) named four authorization levels after "go ahead" appeared in 129 sessions with no fixed meaning.

The recurring pattern of the month is: a prose rule, a measurement showing it failing, a check that replaces it.

Techniques: skill-usage and skills review, skill lint, sigil refusal, mechanics into scripts, dev audits, CODING_FEEDBACK, retrospective, stranded-work handling, local next-action store and `do-it`, autonomy ladder, bbx-design, disk hygiene, real-model policy.

## Motifs that recur across the ladder

These are the moves the talk can name once and point to repeatedly.

The human's own framing sentences, verbatim, are in [your words](your-words.md).

1. **Cut, regrow, budget.** Every instruction surface that was cut by hand regrew (package file 114 → 184; root 850 → 1,277). The one surface with an enforced budget, the box guide, has held and caught one breach. Skills got a lint on Oct 7; the dev CLAUDE.md files still have none.
2. **Prose rule → measured failure → check.** Sigils (rule Sep 20, refusal Oct 7 after 83 sessions); Codex guidance (hand-kept copy rotted May 26, verbatim generator Aug 4, then no mirror at all on Oct 9 when both agents read AGENTS.md natively); stale paths (doc-check path validation fixed 85 at once); flakes (discretion → scripted single rerun).
3. **Fail closed.** Liveness unknown counts as live; the blocklist guard fails closed on a malformed file; the sweep never deletes on a tie; `--force` does not override a liveness check. Forty days of logs show zero deletions on an unknown.
4. **Run-only head, agent only on handoff.** 7 of 15 schedules never start an agent and account for 2,143 of 2,237 runs. "A run that reasons about its findings will be wrong at 03:00 with nobody watching."
5. **One file per thing, in git.** Issues, plans, schedules, skills, exhibits' page contract. The directory is the state; grep is the query; the hooks that validate code validate the queue.
6. **The human is the slowest stage, so mark the gap.** `needs: [manual-testing]` (35 open vs 27 closed), exhibits with one ask, next-action tags, the catch-up queue, journeys as a proxy walker.
7. **Instrument before gate.** The test ledger had no gate; its numbers justified every later flake policy. The context-size ledger had no assertion until the budget. Skill usage was counted before skills were retired.
8. **Arrange context, don't automate judgment.** The retrospective, the smoke review, the tour check and the manual-tests triage all give an agent a packet and a prompt rather than a rule engine.
9. **The evidence stays in the tree.** Issues, plans with their review dispositions, schedules, skills and commit trailers are files in git; runs, alerts, the test ledger and the transcripts are local stores an agent can read. So a question about the process ("do agents read old plans?", "what did the sweep delete?", "which skills are used?") is answered by reading the record rather than by asking anyone. The skills review, the retrospective, the dev audits and this inventory all work that way. The record is uneven: git holds the durable part, and some local stores keep no history, which is why "how many next-action tags were worked" has no answer. In the human's words: "by putting things like issues in the repository, and plans, and setting up the ability to read sessions, etc., this means I can have good discussions about what happened and how well the system works, and there's evidence left over for all of it."
10. **The tool's user is the agent, so its development is indirect.** The browse harness, the context router, the issues CLI, the doc browser and the test ledger are judged by how well they work for an agent, which the human cannot feel directly. They improve when an agent doing something else hits the edge: of the 24 browse-harness commits with a workstream trailer, 21 came from streams doing other work (journey walks, a skills review, a rename, a features branch), and the Aug 23 rewrite of click handling began because a journey walker "read those as the app doing nothing". The human's part is to ask the agent whether the tool served it and to let the fix land in passing. In the human's words: "the quality of the result is how well it works for the agent, not for me, and I mostly poke at the agent indirectly to improve things for itself."

## Candidate stories for slides

Each is one slide's worth, with its numbers verified against git or a local store.

- **The pace curve.** Commits per month 25 → 2,305; one git author; 226 active days of 256; no gap over 64 hours after May 9. Worktree landings 6 → 305. (reports/sweep-numbers.md §1)
- **218 lines, halved in a day.** The package CLAUDE.md line series: 217 → 118 (Mar 3) → 184 (Sep 5) → 67 (Sep 12) → 71. Root in words: 65 → 2,242 → 850 → 1,277. The box guide, the one with a budget: 11,435 source words → 5,555 rendered, held. (sweep-instructions, sweep-agent-knowledge)
- **1,000 to zero in two days.** The suppression ratchet, then the rule that outlived it. 172 of 190 disables today use the justified form. (sweep-quality)
- **The ideas file.** 39 → 1,681 lines in four months, 107 commits, then 107 sections became 107 files. Three months later: 1,224 filed, 721 closed, 45-day median age, filing ahead of closing every month. (sweep-queue-planning)
- **Nine tabs and 20 GB of swap.** The Aug 8 issue, quoted; then the split, the registry (155 records vs 7 checkouts), and 144 unattended removals with zero deletions on unknown. (sweep-parallel-work)
- **The seam.** Codex had to fake Claude's hook JSON; the lifecycle became a CLI; adding the second engine then cost one script. 283+ Codex commits on main; 41 Codex vs 97 Claude workstreams; Codex mostly as `exec` reviewer. (sweep-unattended-multimodel)
- **A model can't see its own blind spots.** 134 commits say a cross-model review found something; the concrete list: eight defects in one branch, two false greens in the smoke tier, the liveness guard that failed open. 140 Claude sessions in 60 days. (sweep-quality)
- **Three escapes in two days.** The smoke tier's origin: typecheck, lint and selected tests all green while the app was broken. 517 runs since, 101 red, median 59 seconds. (sweep-quality)
- **Most changes touch code no test imports.** Test selection's own plan recorded 25% fully accounted against a 50% bar; the response was the ledger and the hourly suite rather than more selection. 871 hourly runs, 29 red landings attributed, 28 closed; 16 early alerts were the suite blaming its own report commits. (sweep-quality, sweep-unattended-multimodel)
- **The walker who knows nothing.** Journeys: three of seven first-round bugs were the harness's own; after-action became mandatory; 74 issues from 14 reports; 40 new and 15 repeats in October; journey finds accumulate (43 open) where suite finds get fixed (3 open). (sweep-agent-knowledge)
- **Fifteen schedules, 2,237 runs, 81 agent sessions.** Four silent launchd jobs on Aug 23; 229 alerts since, 172 closed by a person; the digest and conditions came after the 143-alert month. (sweep-unattended-multimodel)
- **Humans type one skill.** `finish` in 131 Claude and 110 Codex sessions; everything else fires from a description. 31 skills created, 10 retired, SKILL.md lines 3,766 → 1,841. (sweep-instructions)
- **The answer loop that is not used.** 128 exhibits, 4 answered in the page; comments listed in 65 sessions, cleared in 1. The display side of "agents show their work" works; the return side goes through chat. (sweep-parallel-work)
- **Co-author trailers as a model timeline.** 19 values from Opus 4.5 (Jan) to Opus 5.5 (Sep); Fable 5 the largest single value. (sweep-numbers §1)

## Candidate numbers in one place

| Number | Value | Source |
|---|---|---|
| Commits / months / authors | 8,778 / 8.5 / 1 (+19 co-author values) | numbers §1 |
| Code lines Feb 1 → HEAD | 11,858 → 390,172 | numbers §3 |
| Doctests | 1,035 files, 141k lines, 83% of test lines | numbers §3 |
| Docs as share of code lines | about 63% | numbers §3 |
| Worktree branches merged | 222 distinct; 305 landings in September | numbers §1 |
| Issues filed / closed since Jul 4 | 1,224 / 721; 80% agent-filed; median age 45 d | queue-planning |
| Plans written / implemented | 324 / ~199 | queue-planning |
| Ideas file growth | 39 → 1,681 lines, Mar 4 – Jul 4 | queue-planning |
| Package CLAUDE.md | 217 → 118 → 184 → 67 lines | instructions |
| Root CLAUDE.md | 65 → 2,242 → 850 → 1,277 words | instructions |
| Box agent guide | 11,435 source words → 5,555 rendered; budget 5,595 | agent-knowledge |
| Skills | 31 created, 10 retired, 3,766 → 1,841 lines | instructions |
| Human-typed skills | finish 131 + 110 sessions; next: pick-issues 8 | instructions |
| Suppression ratchet | 1,000 → 0, May 30–31 | quality |
| Cross-model catches | 134 commits; 55 issues; 140 sessions / 60 d | quality, numbers §6c |
| Full suite | 871 runs; 29 red landings; 28 closed | unattended |
| Smoke | 517 runs; 101 red; median 59 s | quality |
| Test ledger | 1,915 runs; 717 files ever failed; 49 flaky | quality |
| Schedules | 15; 2,237 runs; 81 sessions; 229 alerts | unattended |
| Cleanup log (40 d) | 144 removals; 793 live skips; 0 unknown | parallel-work |
| Exhibits | 128; 4 answered in-app | parallel-work |
| Journeys | 14 reports; 74 issues; 40 new + 15 repeats on Oct 8 | agent-knowledge |
| Knowledge audits | 406 entries; 1,042 runs; 2026-07-03 rerun closed 9 gaps | agent-knowledge |
| Sessions / 60 d | Claude 225 + 1,845 subagents; Codex 508 + 298 | unattended |
| Codex commits on main | ≥ 283 (no trailer; registry join) | unattended |
| Reverts | 13 of 8,778 | numbers §6c |

## Where the thesis is weakest, for the human to judge

- **Motif 9 is the method of this page.** Every number here came from the record, so the claim that the record supports process discussion is demonstrated rather than argued. Its limit is the same: where a store keeps no history (next actions, exhibit answers) the question goes unanswered.

- **Ordering vs clustering.** August is one burst, not a sequence. The table assigns August's techniques to three constraints hit together (attention, suite, engine) plus journeys. A slide can honor that: "August: everything at once," then the three threads.
- **Exposed bottlenecks are sometimes inferred.** Where an issue or commit names the pain (the Aug 8 issue, the smoke tier's three escapes, the ratchet's 18 rules) the link is direct. Where it is not (regrowth after cuts, the exhibits answer loop), the sweep marked it *judgment*. The inventory keeps that label.
- **Old plans are read.** 144 of 214 shipped plans have been read by an agent, 269 of 479 reads a week or more after landing. The design record is consulted; the "not live manuals" rule exists for that reason. A candidate aside for the planning slide.
- **Closed issues are read less, and differently.** 385 of 717 closed issues have been read; 422 of 931 reads happen at the close, 319 a week or more later, and the long tail is decision issues. Open issues get five times the reads. Plans are the design record; issues are the queue.
- **The quiet stretch.** Mar 7 – May 20 added no practice and shipped product. It is real and worth a sentence; it also means the "ladder" is two climbs with a plateau, not one.
- **Journeys have their own overview.** [User-story journeys: overview](../journeys/overview.md) covers intent, choices, all four rounds, the walker's voice, the claim-to-issue funnel and the issues' fate; the talk's journey slides should draw from it rather than restate it.
- **Evals can produce rogue agents.** A journey walker, like any agent scored on its own run, can satisfy the evaluation by going around it. Public incidents elsewhere show agents doing exactly this. Inside the box, the after-run review (screenshots per step, the collector's diff of box files) mostly catches it. The concerning case is the walker leaving the box, touching the dev checkout or the machine, which nothing prevents and the review does not look for. Worth one sentence of caveat wherever a slide leans on walk results.
- **Journeys as the opening example.** It sits at bottleneck 5, late in the story. It is the best single illustration of the thesis (the human was the walker; the after-action pass is the exposed problem), so it may work better as a cold open than in sequence.
- **Outcomes that are thin.** Pre-commit gates have no record of what they blocked; the next-action store keeps no history; exhibit answers mostly go through chat. These are honest gaps, and one of them (instrument before gate) is itself a motif.
- **Earlier pages to reconcile.** The five-step "ask more" ladder on the unmerged workstream-story branch covers bottlenecks 2, 4, 5 and the manual-testing queue; this draft adds 0, 1, 3, 6 and 7 and the quality and unattended threads. The two framings can coexist (ask-more is the why, bottlenecks the what) or this one can absorb that one.
