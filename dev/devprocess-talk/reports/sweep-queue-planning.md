# Sweep: the work queue and planning

All commands run from the worktree root. "Today" = 2026-10-09. Repo first commit: 2026-01-27 feb42fed4 "first commit".

Shared evidence commands referenced below:
- OPEN = `find issues -path issues/closed -prune -o -name '20*.md' -print`
- CLOSED = `find issues/closed -name '20*.md'`
- Unique issues first filed per month (dedupes moves by basename): `git log --reverse --no-renames --diff-filter=A --name-only --format='@%ad' --date=format:%Y-%m -- issues | awk '/^@/{d=substr($0,2);next} /^issues\/.*\.md$/ && !/CLAUDE.md|AGENTS.md|README/ {n=split($0,a,"/"); b=a[n]; if(!(b in seen)){seen[b]=d; c[d]++}} END{for(k in c) print k, c[k]; print "total", length(seen)}'` -> 2026-07: 336 (includes 107 migrated from ideas.md), 2026-08: 448, 2026-09: 329, 2026-10 (9 days): 111; total 1224 distinct basenames.
- Unique issues first closed per month (same awk over `-- issues/closed`): 2026-07: 112, 2026-08: 298, 2026-09: 208, 2026-10: 103; total 721.
- Raw `--diff-filter=A` counts (with rename detection, excluding closed/) are inflated by category moves: 322 / 426 / 327 / 109.

## Single ideas file (predecessor: <old-package>/docs/ideas.md)
- **One line:** One Markdown file with one section per idea/issue, appended by the developer and agents.
- **Lives in:** `<old-package>/docs/ideas.md` (deleted); no TODO.md ever existed (`git log --all --diff-filter=A -- 'TODO*' '*/TODO*'` returns nothing; `beebox/docs/todo*` only matches `beebox/docs/todo-security.md`, a security checklist).
- **Appeared:** 2026-03-04 1a45afb09 "Add documentation graph tool, fix doc orphans and descriptions" (first commit touching the path via `git log --follow -- <old-package>/docs/ideas.md`). Split into issues/ on 2026-07-04 2c6c497c2 "feat: replace ideas.md with issues/ — one file per idea, in-tree tracking".
- **Bottleneck relieved:** Gave agents and the developer one place to put out-of-scope ideas instead of chat.
- **New bottleneck exposed:** Size. Lines at sampled commits (`git show <c>^:<old-package>/docs/ideas.md | wc -l`): 2026-03-04 39; 2026-04-17 170; 2026-05-19 470; 2026-05-28 919; 2026-06-09 1065; 2026-06-18 1232; 2026-06-30 1587; 1681 at deletion. 107 commits touched it (`git log --follow --format=%h -- <old-package>/docs/ideas.md | wc -l`). Split commit body: "Migrated all 107 sections ... (95 open, 11 closed, two previously headingless orphan entries recovered)". dev/workstream-story.md:50 describes the before state as "one giant unevenly-detailed TODO file". dev/agent-knowledge.html lists `beebox/docs/ideas.md` reads: 58 (stale path still read in transcripts).
- **Evidence:** above commands.
- **Outcomes:** Replaced after 4 months; its 107 sections became the first issues/ files (backdated filenames via git blame per commit body). Judgment: the growth curve (39 -> 1681 lines in 4 months) is the concrete reason given for the split.
- **Prior-art mention:** dev/workstream-story.md yes ("one giant unevenly-detailed TODO file"); dev/agent-knowledge.html yes (read count only).

## issues/ tree: one file per issue, directory is state
- **One line:** Each issue is `issues/<category>/YYYY-MM-DD-<slug>.md`; status is the directory; closing is `git mv` into `issues/closed/<category>/` with `resolution:`.
- **Lives in:** `issues/`, `issues/CLAUDE.md`, `issues/AGENTS.md`, `.claude/skills/issues/SKILL.md`.
- **Appeared:** 2026-07-04 2c6c497c2 (commit body: "Adopt the file-per-item convention ... instead of any tracker tool ... closed items move to issues/closed/ with a resolution"). Reshaped 2026-07-10 1694cc239 "issues: categorize into subdirectories + titles into frontmatter" (six category dirs, title into frontmatter; "Implements issues/decisions/2026-07-07-categorize-issues-into-subdirectories.md"). issues/CLAUDE.md: 46 commits (`git log --format=%h -- issues/CLAUDE.md | wc -l`); size 74 lines (2c6c497c2) -> 99 (1694cc239) -> 392 (9da2ae439, 2026-08-24) -> 287 (880f9d4d0, 2026-09-12 "Complete instruction calibration") -> 303 now (`git show <c>:issues/CLAUDE.md | wc -l`).
- **Bottleneck relieved:** Single-file merge/size problem; findings from parallel worktrees ride the same branch and merge as code (dev/workstream-story.md:69).
- **New bottleneck exposed:** Volume. 1224 distinct issues filed in ~3 months; needed search (bin/issues), triage signals (priority, next actions), and a browser.
- **Evidence:** Open by dir (`ls issues/<dir> | wc -l`): bugs 108, features 166, code-quality 52, docs-and-chores 29, decisions 26, exploration 77, watch 7, deferred 2 (467 open in categories). Closed: 717 (`find issues/closed -name '*.md' | wc -l`): bugs 429, features 130, code-quality 79, exploration 26, docs-and-chores 30, decisions 22, watch 1. Resolutions (`grep -h '^resolution:' $CLOSED | sort | uniq -c`): implemented 623, wontfix 53, superseded 41. Median age of open issues from filename date: 45 days (p25 18, p75 79; n=467).
- **Outcomes:** 721 distinct issues closed in ~3 months, 623 as `implemented`. Still the live queue. Judgment: open count is still growing (filing outpaces closing each month: 448 vs 298 in August, 329 vs 208 in September).
- **Prior-art mention:** dev/workstream-story.md yes ("Issues had to grow up at the same time": one file per issue, directory categories, frontmatter, life-of-an-issue SVG).

## Category directories
- **One line:** bugs/, features/, code-quality/, docs-and-chores/, decisions/, exploration/, watch/ (plus flat deferred/), dominant category wins, reclassify with `git mv`.
- **Lives in:** `issues/CLAUDE.md` "Layout: category subdirectories".
- **Appeared:** 2026-07-10 1694cc239 (six dirs); watch/ added 2026-08-01 7689ae1aa; deferred/ 2026-08-31 cde25c645.
- **Bottleneck relieved:** A flat queue of ~100+ files; the change was itself filed as a decision issue first (issues/decisions/2026-07-07-categorize-issues-into-subdirectories.md per commit body).
- **New bottleneck exposed:** Not visible beyond reclassification moves inflating raw add counts.
- **Evidence:** counts above.
- **Outcomes:** In use; `--category` filter in bin/issues and `groups --by category`.
- **Prior-art mention:** dev/workstream-story.md yes (names bugs/, features/, decisions/, exploration/).

## Closed frontmatter schema and validation
- **One line:** `title:` and `workstream:` required; closed key vocabulary; unknown keys reported by the shared parser; doc-check enforces links, unique basenames, and plan/issue frontmatter.
- **Lives in:** `workstreams-app/src/server/main/issue-domain.ts` (`KNOWN_FRONTMATTER_KEYS`, line 120), `beebox/src/dev/doc-check/` (check.ts, private-link.ts, file-paths.ts), `issues/CLAUDE.md` "Frontmatter".
- **Appeared:** 2026-08-09 b66aed4f3 "Enforce plan and issue frontmatter"; 2026-08-24 1588e62a8 "issues: retire the invented stories: field, and stop swallowing unknown keys".
- **Bottleneck relieved:** Agents inventing fields (the retired `stories:` field) and drift between files.
- **New bottleneck exposed:** Not visible.
- **Evidence:** issue-domain.ts: 7 commits (`git log --follow --format=%h -- workstreams-app/src/server/main/issue-domain.ts | wc -l`).
- **Outcomes:** Every new field (priority, discovered-by, labels) since then went through the contract; `labels:` replaced an invented field. Judgment: thin record of what it caught.
- **Prior-art mention:** dev/workstream-story.md mentions "machine-readable frontmatter" and pre-commit validation; no detail.

## workstream / discovered-in / discovered-by / filed-by (ownership vs provenance)
- **One line:** `workstream:` is ownership (usually `unattached`); `discovered-in: worktree-<name> — <context>` is provenance; `discovered-by`/`filed-by` record who.
- **Lives in:** `issues/CLAUDE.md` "Identity and grouping"; `bin/assign-issue-workstream.ts`; `bin/issues groups --by discovered-in`.
- **Appeared:** `discovered-in` + `filed-by: agent` in the first convention 2026-07-04 2c6c497c2. `workstream:` 2026-08-09 b66aed4f3; split 2026-08-11 16bc0e915 "Distinguish issue ownership from discovery"; 2026-08-11 5f6a34f46 "Join issues to their workstreams"; `discovered-by` 2026-08-11 13c96733b "Record who discovered an issue".
- **Bottleneck relieved:** A session can file an out-of-scope finding without claiming it (dev/workstream-story.md:60).
- **New bottleneck exposed:** `workstream:` values are mostly not meaningful for clustering: bbx-pick-issues says "mostly `unknown`/`unattached`; a named value may be a live owner or a tombstone. Not a clustering signal."
- **Evidence:** Open: workstream unattached 222, unknown 120, named 125 (`grep -h '^workstream:' $OPEN | ...`). discovered-in: 376/467 open, 604/717 closed (`grep -l '^discovered-in:'`). filed-by: agent: 376 open, 618 closed. Largest provenance group: 49 issues from `user-stories-refresh` (`bin/issues groups --by discovered-in --all`).
- **Outcomes:** ~80% of issues (open and closed) are agent-filed with provenance. bbx-pick-issues ranks `groups --by discovered-in` as the best predictor of "a real body of work".
- **Prior-art mention:** dev/workstream-story.md yes (example frontmatter, "Two separate fields, on purpose").

## "Tensions, not resolutions" / filing does not authorize implementation
- **One line:** Issues record unresolved tensions; filing an item is not permission to implement it; fix small in-scope problems directly instead of filing.
- **Lives in:** `issues/CLAUDE.md` opening paragraph; root `CLAUDE.md` "Use issues ... Filing does not authorize implementation."
- **Appeared:** 2026-07-04 2c6c497c2 (original text: "Most items here are **tensions, not resolutions** ... An item being filed is *not* license to implement it"). Literal phrase removed in 2026-09-12 880f9d4d0 (now "holds unresolved tensions"); root CLAUDE.md wording from 2026-09-12 c8c728285 "Apply compact root agent guidance and resolve monorepo doc links".
- **Bottleneck relieved:** Agents treating every filed idea as a mandate to build.
- **New bottleneck exposed:** Implementation needs an explicit authorization channel -> next actions (`do-it`) and the "How much to do" ladder.
- **Evidence:** `git log -S'tensions, not' -- issues/CLAUDE.md`.
- **Outcomes:** Rule still in force in both files. Judgment: no direct measure.
- **Prior-art mention:** dev/workstream-story.md yes ("Filing is not a mandate: most items are *tensions, not resolutions*").

## needs: design / decision and the decisions/ category
- **One line:** `needs: [design]` requires a plan, `needs: [decision]` requires the developer to choose; separately, `decisions/` holds issues whose deliverable is a decision.
- **Lives in:** `issues/CLAUDE.md` "Human-owned signals", `issues/decisions/`, `issues/closed/decisions/`.
- **Appeared:** `needs:` 2026-07-04 2c6c497c2; `decisions/` 2026-07-10 1694cc239.
- **Bottleneck relieved:** Separating "agent can do" from "only the developer can settle".
- **New bottleneck exposed:** Not visible.
- **Evidence:** Open needs (`grep -h '^needs:' $OPEN | sort | uniq -c`): design 114, decision 26, both 7, manual-testing 23, design+manual-testing 2. decisions/ open 26, closed 22.
- **Outcomes:** 22 decision issues closed; the category change itself (1694cc239) was resolved through one. Judgment: 114 open `needs: [design]` items suggests design is a standing backlog.
- **Prior-art mention:** dev/workstream-story.md names decisions/ only.

## Research sentinel in issue bodies
- **One line:** Pending research uses `## Research (incomplete)`, renamed `## Research (YYYY-MM-DD)` when done; `bin/issues list --research awaiting` queries it.
- **Lives in:** `issues/CLAUDE.md` "Body"; bin/issues `--research`.
- **Appeared:** 2026-07-04 2c6c497c2 (commit body: "research-in-body with '## Research (incomplete)' stubs").
- **Bottleneck relieved:** Research as a resumable step without a separate tracker field.
- **New bottleneck exposed:** Not visible.
- **Evidence:** Open: 12 incomplete, 19 dated (`grep -l '^## Research (incomplete)' $OPEN`; `grep -lE '^## Research \(20'`).
- **Outcomes:** Low use (31 of 467 open). Judgment: minor technique.
- **Prior-art mention:** no.

## STE body style for issues and plans
- **One line:** Issue and plan prose follows Simplified Technical English in spirit.
- **Lives in:** `issues/CLAUDE.md` "Body", `.claude/skills/bbx-plan/SKILL.md` step 4.
- **Appeared:** 2026-07-30 8a3a00bb1 "prompts: encourage Simplified Technical English (ASD-STE100) in issues + plans".
- **Bottleneck relieved:** Cold-resume readability by later agents. 
- **New bottleneck exposed:** Not visible.
- **Evidence:** `git log -S'Simplified Technical English' -- issues/CLAUDE.md`.
- **Outcomes:** Still in both files. Judgment: no measure.
- **Prior-art mention:** no.

## Link healing and unique basenames
- **One line:** After any move, `pnpm --dir beebox doc-check --fix` repairs inbound relative links by unique basename; duplicate basenames fail doc-check.
- **Lives in:** `issues/CLAUDE.md` "Titles + cross-links"; `beebox/src/dev/doc-check/`.
- **Appeared:** 2026-07-21 f52f4335e "issues: document doc-check --fix for repairing links after a move".
- **Bottleneck relieved:** Directory-is-state means every close/reclassify breaks links; this makes moves cheap.
- **New bottleneck exposed:** Not visible.
- **Evidence:** 717 closes + reclassifications (raw add counts exceed distinct counts by ~10-20 per month).
- **Outcomes:** Used by the deferred-issues schedule ("activates due files, removes both fields, repairs links, and commits") and the finish flow.
- **Prior-art mention:** no.

## Grep as query engine
- **One line:** Queue queries are greps over frontmatter in git (e.g. `manual-testing`, a workstream name).
- **Lives in:** convention; `bin/issues list` filters build on the same parser.
- **Appeared:** implicit from 2026-07-04 2c6c497c2 ("grep the directory for related slugs and words" in original CLAUDE.md).
- **Bottleneck relieved:** No external tracker or API.
- **New bottleneck exposed:** Keyword grep misses semantic duplicates -> bin/issues hybrid search (2026-08-24).
- **Evidence:** every count in this file was produced by grep/find.
- **Outcomes:** Still the base layer.
- **Prior-art mention:** dev/workstream-story.md yes ("Grep is the query engine").

## Priority tiers (human-owned)
- **One line:** `priority: important | normal | backlog`; omitted = uncategorized; agents never set it.
- **Lives in:** `issues/CLAUDE.md`; issue browser sort.
- **Appeared:** 2026-08-11 08bd77b11 "Add issue priority tiers"; 2026-08-14 b5a48a6ce "docs(issues): agents don't set priority; tag proving-it-works for discussion".
- **Bottleneck relieved:** Ordering a queue of hundreds.
- **New bottleneck exposed:** Stale priority on re-encounter -> rule: note it and set `discuss`.
- **Evidence:** Open: important 74, normal 141, backlog 118, none 134 (`grep -h '^priority:' $OPEN | sort | uniq -c`; `grep -L`).
- **Outcomes:** 333 of 467 open issues carry a developer-set priority.
- **Prior-art mention:** dev/workstream-story.md yes ("Triage is a priority plus a request").

## labels:
- **One line:** Optional kebab-case cross-cutting groups, a browser facet and `--label` filter.
- **Lives in:** `issues/CLAUDE.md`; issue browser.
- **Appeared:** 2026-07-21 b08688577 "issues(labels): add generic labels: frontmatter field + browser facet".
- **Bottleneck relieved:** Cross-cutting grouping without new schema fields.
- **New bottleneck exposed:** bbx-pick-issues: "good where present, thin coverage".
- **Evidence:** 239 of 467 open carry `labels:` (`grep -l '^labels:' $OPEN | wc -l`).
- **Outcomes:** In use. Replaced the invented `stories:` field (1588e62a8).
- **Prior-art mention:** no.

## bin/issues CLI (list / groups / search / similar / show / next-action / activate-due)
- **One line:** Survey and search CLI over the queue sharing the workstreams-app parser; BM25 offline, hybrid/semantic with OpenAI embeddings and a gitignored `.issues-index/`.
- **Lives in:** `bin/issues`, `bin/issues.ts`, `bin/issues-args.ts`, `bin/issues-context.ts`, `bin/issues-errors.ts`, `bin/issues-output.ts`, `bin/issues.test.ts`.
- **Appeared:** 2026-08-24 9da2ae439 "Add bin/issues (hybrid issue search) and the cb-pick-issues skill"; same day 9c3f90070 "issues CLI + skills: apply cross-model review findings"; c343423bd "Related issues + docs panel in the workstreams issue browser".
- **Bottleneck relieved:** Duplicate filing and cluster finding at ~700 files; filing rule became "run `bin/issues search --all` before filing".
- **New bottleneck exposed:** Clusters by similarity are only hypotheses (bbx-pick-issues: "a session grouped eight connector issues by title ... began launching a workstream on that premise — without having read the issues").
- **Evidence:** 1694 lines across `bin/issues*.ts`, `bin/deferred-issues.ts`, `bin/confirm-tested.ts` (`wc -l`). 8 commits on bin/issues*.ts (`git log --format=%h -- bin/issues.ts bin/issues-*.ts | sort -u | wc -l`).
- **Outcomes:** Used by every queue skill and by the filing rule; `--visibility public` never reads private-issues. Judgment: usage counts in transcripts not measured here.
- **Prior-art mention:** no.

## Issue browser and testing view (workstreams-app)
- **One line:** Web UI at `/workstreams/issues` with facets, priority sort, related-issues panel, next-action select; `/testing` lists manual-testing items landed vs pre-merge with Confirm / Reset test / Resume buttons.
- **Lives in:** `workstreams-app/src/frontend/components/IssuesPane/`, `workstreams-app/src/frontend/pages/TestingPage.tsx`, `bin/confirm-tested.ts`.
- **Appeared:** 2026-08-13 7b49cb0df "Build workstreams React interface" (TestingPage first added here); 2026-08-13 47c1ecf22 "Expand issue browser triage controls"; bin/confirm-tested.ts 2026-08-09 fd1299085 "Add manual testing workflow".
- **Bottleneck relieved:** Triage at queue scale by the developer outside a terminal.
- **New bottleneck exposed:** Browser triage wrote frontmatter and made commits on worktree branches -> local next-action store (27339ea11).
- **Evidence:** TestingPage.tsx 3 commits.
- **Outcomes:** In use; root CLAUDE.md issues/CLAUDE.md tell agents to link the browser, not file paths.
- **Prior-art mention:** no.

## Next-action requests and the local store
- **One line:** A removable request from the developer per issue (`discuss`, `reconfirm`, `duplicate`, `invalid`, `fixed`, `manually-confirmed`, `verify-without-me`, `do-it`, optional free-text message), stored outside git.
- **Lives in:** `workstreams-app/src/server/main/issue-next-actions.ts` (sole reader/writer); store `dev-issue-actions/` beside the main checkout (`BBX_ISSUE_ACTIONS_ROOT`); `bin/issues next-action`.
- **Appeared:** 2026-08-13 47c1ecf22 (reconfirm etc. in browser); 2026-08-14 fe1a9762c "Add discuss next action for issues"; 2026-08-14 722933909 "docs(issues): add next-action: verify-without-me"; 2026-08-24 be8d558fd (manually-confirmed); 2026-10-05 27339ea11 "feat(issues): keep next actions in a local store, with a free-text message"; 2026-10-05 455b4eb16 "add the do-it next action".
- **Bottleneck relieved:** The developer hands a suspicion to the next agent at the moment the whole queue is in view. 27339ea11 body: the browser select "committed it as 'Update issue metadata', which stranded commits on whichever worktree branch held the issue."
- **New bottleneck exposed:** The store keeps no history; rule: quote the message in the issue body before clearing.
- **Evidence:** Pending now: 12, all `discuss` (`bin/issues next-action`). 36 commits mention next action / reconfirm / verify-without-me (`git log --oneline -i --grep='next.action\|reconfirm\|verify-without-me' | wc -l`).
- **Outcomes:** Provisional-tag queue is currently drained (only discuss remains). Judgment: history of how many tags were worked is lost by design.
- **Prior-art mention:** dev/workstream-story.md yes ("Next actions stay out of git, in a local store, so triage never makes commits").

## bbx-issue-actions skill
- **One line:** How to work each next-action value: hypotheses need evidence, `reconfirm` = fixed-then-moot check, `duplicate` merges details first, `verify-without-me` closes only on evidence, `do-it` fixes inline within limits.
- **Lives in:** `.claude/skills/bbx-issue-actions/SKILL.md`.
- **Appeared:** 2026-08-13 bd46bf565 "feat(skills): issue-actions — work the queue's next-action tags"; 16 commits.
- **Bottleneck relieved:** Agents closing on a tag without verification.
- **New bottleneck exposed:** dev/skills-review-2026-10.md: lines 154-155 "cite a finish.md protocol that no longer exists" (flake policy contradiction); recommends shrinking 232 -> ~110 lines.
- **Evidence:** dev/skills-review-2026-10.md table: 1 agent-invoked + 4 typed Claude sessions, 3 Codex sessions, last used 10-06.
- **Outcomes:** Still in use; low session count.
- **Prior-art mention:** dev/skills-review-2026-10.md yes (usage row, shrink recommendation).

## do-it / verify-without-me / manually-confirmed
- **One line:** Three next actions that carry authority: `do-it` authorizes a small fix; `verify-without-me` releases a manual-testing gate for evidence-based disposition; `manually-confirmed` records a completed human check.
- **Lives in:** `issues/CLAUDE.md`, bbx-issue-actions, root `CLAUDE.md` ladder ("do (issue tag `do-it`)", "land (the finish ask, issue tag `verify-without-me`)").
- **Appeared:** verify-without-me 2026-08-14 722933909; manually-confirmed 2026-08-24 be8d558fd "Fix issue editing safeguards and workflow states"; do-it 2026-10-05 455b4eb16.
- **Bottleneck relieved:** Manual-testing gates that would never close; small fixes waiting on a full session.
- **New bottleneck exposed:** bbx-issue-actions: "Separate 'impossible without a device' from 'nobody ran it'" (learned from the audit that produced verify-without-me).
- **Evidence:** dates via `git log -S'<value>' -- issues/CLAUDE.md`.
- **Outcomes:** No pending do-it/verify-without-me requests now. Judgment: counts of use not recoverable (store has no history).
- **Prior-art mention:** no.

## bbx-pick-issues modes (Investigate / Propose / Act)
- **One line:** Skill that maps the developer's words to a mode with explicit allowed/not-allowed actions; clusters are hypotheses; route against live workstreams first.
- **Lives in:** `.claude/skills/bbx-pick-issues/SKILL.md`.
- **Appeared:** 2026-08-24 9da2ae439 (as cb-pick-issues); 10 commits.
- **Bottleneck relieved:** Choosing work from hundreds of issues; the skill names the failure "a session grouped eight connector issues by title ... began launching a workstream on that premise".
- **New bottleneck exposed:** Self-promotion between modes ("One instruction, one action"; "Approval doesn't carry over").
- **Evidence:** dev/skills-review-2026-10.md: 2 agent-invoked + 8 typed Claude sessions, 2 Codex, 118 lines.
- **Outcomes:** One of three skills the developer types by name (finish, bbx-pick-issues, bbx-issue-actions per dev/skills-review-2026-10.md:9).
- **Prior-art mention:** dev/skills-review-2026-10.md yes (usage).

## Re-encounter rules
- **One line:** A repeated symptom is evidence: dated note; manual-testing item recurs -> gate removed, reopened as bug; stale priority -> `discuss`; closed -> reopen with `git mv`.
- **Lives in:** `issues/CLAUDE.md` "Re-encountering an issue".
- **Appeared:** 2026-08-24 9da2ae439 (commit body: "issues/CLAUDE.md gains re-encounter rules").
- **Bottleneck relieved:** Duplicate filings of the same defect.
- **New bottleneck exposed:** Not visible.
- **Evidence:** current pending `discuss` sample carries "Re-encountered in the 2026-10-08 journey walks" (`bin/issues next-action`).
- **Outcomes:** In use. Judgment: no aggregate count.
- **Prior-art mention:** no.

## Manual-testing gate
- **One line:** `needs: [manual-testing]` marks a landed fix only a human can verify, with a `## Manual testing` section and an "Awaiting manual testing" headline; only the developer clears it.
- **Lives in:** `issues/CLAUDE.md` "Manual-testing lifecycle"; `bin/confirm-tested.ts`; TestingPage; finish agent.
- **Appeared:** 2026-07-19 7bf895a48 "issues: add needs: [manual-testing], and de-XML the card-prominence issue"; 2026-07-31 fc88f5e7a "make 'awaiting manual testing' a prominent headline"; 2026-08-09 fd1299085 "Add manual testing workflow".
- **Bottleneck relieved:** Agents claiming device/real-network fixes are done.
- **New bottleneck exposed:** Gates accumulate when the developer cannot test -> `verify-without-me` (2026-08-14).
- **Evidence:** Open with needs manual-testing: 25 (23 + 2 combined); closed files mentioning manual-testing: 27 (`grep -rl 'manual-testing' issues/closed | wc -l`).
- **Outcomes:** ~27 closed after passing through the gate (upper bound; grep counts mentions).
- **Prior-art mention:** dev/workstream-story.md yes (finish tags `manual-testing`, pins test setup).

## Weekly manual-tests triage schedule
- **One line:** Weekly unattended Sonnet agent triages manual-test-suite failures into issues, allowed to edit only `issues/<open category>/**`.
- **Lives in:** `schedules/manual-tests/` (schedule.yaml, prompt.md, run.ts, check.ts).
- **Appeared:** 2026-08-24 00bbd508d "schedules: enroll manual-tests (Track F)".
- **Bottleneck relieved:** Test failures surfacing without a session; "the issue queue is the memory" (schedule.yaml comment).
- **New bottleneck exposed:** Not visible.
- **Evidence:** `bin/schedules list`: last run 42h ago (clean). maxBudgetUsd 2.
- **Outcomes:** Still scheduled. Judgment: issues it filed not counted here (no distinct trailer).
- **Prior-art mention:** no.

## deferred/ issues and the deferred-issues schedule
- **One line:** Known-date work sits in flat `issues/deferred/` with `activate-on:` and `category:`; an hourly schedule moves due files into their category, strips fields, repairs links, commits.
- **Lives in:** `issues/deferred/`, `bin/deferred-issues.ts`, `bin/deferred-issues.test.ts`, `schedules/deferred-issues/`, `bin/issues activate-due`.
- **Appeared:** 2026-08-31 cde25c645 "Add deferred issue activation".
- **Bottleneck relieved:** Date-triggered items cluttering the active queue.
- **New bottleneck exposed:** Not visible.
- **Evidence:** 10 issues ever deferred (`git log --no-renames --diff-filter=A --name-only --format= -- issues/deferred | sort -u | wc -l`); 2 deferred now; 7 activation commits (`git log --oneline --grep='ctivate' -- issues/deferred | wc -l`), e.g. 2026-10-05 1867cc17b "Activate deferred issues". bin/deferred-issues.ts 7 commits. `bin/schedules list`: hourly, last 1h ago (clean).
- **Outcomes:** 8 deferred issues activated on schedule. Small volume.
- **Prior-art mention:** no.

## watch/ category
- **One line:** Issues waiting on an external/upstream trigger; each names the trigger; never picked or periodically checked.
- **Lives in:** `issues/watch/`, `issues/CLAUDE.md`.
- **Appeared:** 2026-08-01 7689ae1aa (body: "Not-actionable-by-us items (upstream bugs, missing dep capabilities) get their own category so they don't clutter exploration/ or sit unfiled").
- **Bottleneck relieved:** Upstream-blocked items polluting the pickable queue.
- **New bottleneck exposed:** Not visible.
- **Evidence:** 7 open, 1 closed.
- **Outcomes:** Small, in use; excluded by bbx-pick-issues.
- **Prior-art mention:** no.

## private-issues (mechanism)
- **One line:** A separate per-developer git repo mounted via gitignored symlink for content that must not be public; public files never link into it; worktree creation mounts a matching private branch.
- **Lives in:** `bin/private-issues`, `issues/CLAUDE.md` "Private issues", `beebox/src/dev/doc-check/private-link.ts`.
- **Appeared:** 2026-08-01 1f9a650cb "private-issues: shadow repo, lifecycle wiring, doc-check guard"; 2026-08-11 db0cc2323 "docs(issues): nothing lands public unvetted when working on a real box".
- **Bottleneck relieved:** The repo is source-available; real-box findings had nowhere safe to go.
- **New bottleneck exposed:** Not visible from the public side.
- **Evidence:** bin/private-issues 10 commits. Contents not inspected (off limits).
- **Outcomes:** Used by alert-filing and the issue browser (`private` marker). Judgment: no public count.
- **Prior-art mention:** no.

## Alert-filing schedule
- **One line:** Daily schedule that files any schedule alert condition open for a week as a private issue.
- **Lives in:** `schedules/alert-filing/` (runs `bin/schedules file-standing`); plan `beebox/docs/implemented-plans/schedule-alert-signal.md`.
- **Appeared:** 2026-09-18 7c46d0967 "Schedule alerts: daily digest and 7-day filing"; plan 2026-09-18 00cb87339.
- **Bottleneck relieved:** Repeating alerts; a persistent condition becomes a queue item instead.
- **New bottleneck exposed:** Not visible.
- **Evidence:** `bin/schedules list`: every 1d, last 19h ago (clean). Count of filed items lives in private-issues (not inspected).
- **Outcomes:** Running daily. Judgment: output not measurable from the public repo.
- **Prior-art mention:** no.

## Issue: commit trailer
- **One line:** `Issue: <basename>` trailer links commits to public issues; commit-msg hook rejects a nonexistent name; `pnpm commit-provenance --issue` queries it.
- **Lives in:** `bin/commit-provenance.ts`, root `.husky/`, root CLAUDE.md.
- **Appeared:** first commit carrying it 2026-08-01 45c360490 "Remove the cb render command and its SSR entry graph"; hook 2026-08-24 e00c5dcca "feat(bin): commit provenance trailers (Workstream/Plan/Issue)".
- **Bottleneck relieved:** `fixed?` checks: bbx-issue-actions queries the trailer first, `-S` search as fallback.
- **New bottleneck exposed:** Not visible.
- **Evidence:** 358 commits with Issue: trailer (`git log --format='%H %(trailers:key=Issue,valueonly)' | awk 'NF>1' | wc -l`); per month 149 / 136 / 73 (Aug / Sep / Oct).
- **Outcomes:** 358 commits traceable to issues.
- **Prior-art mention:** no.

## How-much-to-do ladder (discuss / plan / do / land) applied to the queue
- **One line:** Root guidance mapping the developer's wording to a ceiling, with issue tags `do-it` = do and `verify-without-me` = land; lowest level when unclear.
- **Lives in:** root `CLAUDE.md` "How much to do"; bbx-pick-issues modes are the queue-specific precursor.
- **Appeared:** 2026-10-08 8ee2fe5bd "Root CLAUDE.md: 'How much to do', the autonomy vocabulary" (body: "A dev audit checks the reading of 'go ahead'").
- **Bottleneck relieved:** Agents over- or under-doing relative to the request; unifies pick-issues modes, plan gating, issue tags.
- **New bottleneck exposed:** Too new to show.
- **Evidence:** 1 day old.
- **Outcomes:** Judgment: too recent to assess; a knowledge audit was added with it.
- **Prior-art mention:** no.

## bbx-plan skill and TEMPLATE.md
- **One line:** Plan = complete unit of work designed end-to-end; template sections are the review; cite file:line; "Could this be simpler?" and "NOT in scope" are gates; walk scenarios against real code; ship only when the boxholder says.
- **Lives in:** `.claude/skills/bbx-plan/SKILL.md` (149 lines), `.claude/skills/bbx-plan/TEMPLATE.md` (182 lines).
- **Appeared:** 2026-05-29 bd69d2f45 "Markdoc tags design doc + cb-plan skill"; 2026-08-26 4b7d18f65 "cb-plan: 517 lines become a 100-line skill and a template"; 2026-10-07 6cd8fb1f6 (Design section, hands off to bbx-design). 31 commits on SKILL.md, 12 on TEMPLATE.md.
- **Bottleneck relieved:** Unsurfaced failure modes in multi-module work ("When the cost of an unsurfaced failure mode exceeds the cost of writing the plan").
- **New bottleneck exposed:** Skill size (517 lines -> split); merging partial plans ("merging a partial plan because 'the first part feels done' is the violation").
- **Evidence:** dev/skills-review-2026-10.md: 52 agent-invoked Claude sessions, 14 Codex; dev/agent-knowledge.html: never typed, "asked for in prose 81×".
- **Outcomes:** 324 distinct plan files written; ~199 with `status: implemented` in implemented-plans (see next entry).
- **Prior-art mention:** dev/agent-knowledge.html yes ("early June, Rigor: bbx-plan · codex, plan deeply, review across models"); dev/skills-review-2026-10.md yes (keep).

## Plan docs and lifecycle directories
- **One line:** `beebox/docs/plans/` for draft/active/partial; moved to `implemented-plans/` on ship; `unimplemented-plans/` for superseded/parked; frontmatter `status`, `workstream`, `issues:` list (finish reads it to close issues).
- **Lives in:** `beebox/docs/plans/README.md`, `beebox/docs/implemented-plans/`, `beebox/docs/unimplemented-plans/`, `.claude/agents/finish.md`, doc-check.
- **Appeared:** 2026-06-04 c8f67441a "docs: move plan into docs/plans/ (separate proposals from reference docs)"; 2026-06-04 d9bec451c "skills: wire the docs/plans convention"; implemented-plans first file 2026-06-04 b3bf67809; unimplemented-plans 2026-07-03 fc44e852e; frontmatter enforced 2026-08-09 b66aed4f3.
- **Bottleneck relieved:** README: "a proposal reads as if it describes reality, and a finished plan reads as if it's still open."
- **New bottleneck exposed:** Partial plans accumulate: 41 of 71 status lines in plans/ are `partial`.
- **Evidence:** Files now: plans/ 88 (incl. 18 review, 2 subplan), implemented-plans/ 214 (199 `status: implemented`, 17 review, 7 subplan, 1 design), unimplemented-plans/ 11 (4 parked, 6 superseded) (`grep -h '^status:' ... | sort | uniq -c`; counts include some body lines). Distinct plan basenames first added per month (`git log --reverse --no-renames --diff-filter=A --name-only ... | awk` over `docs/(plans|implemented-plans|unimplemented-plans)/`, excluding review/README/TEMPLATE): 2026-06 44, 2026-07 103, 2026-08 80, 2026-09 85, 2026-10 12; total 324. plans/README.md 14 commits.
- **Outcomes:** ~199 implemented of 324 written; 10 superseded/parked; ~70 open (41 partial, 23 active, 6 draft). Remainder deleted or renamed.
- **Prior-art mention:** no.

## Plan reviews (.review.md) and cross-model review of plans
- **One line:** A plan review is a separate `<topic>.review.md` in a fixed findings format; cross-model review (other model family) runs on plans before implementation.
- **Lives in:** bbx-plan "Reviewing" section; `.claude/skills/cross-model/`.
- **Appeared:** cross-model skill 2026-06-04 b3bf67809 "skill(codex): callback-native cross-model review skill + docs/plans convention notes"; bidirectional 2026-08-04 aae37764a.
- **Bottleneck relieved:** One model reviewing its own plan.
- **New bottleneck exposed:** Not visible here.
- **Evidence:** 35 distinct `*.review.md` files ever (`git log --no-renames --diff-filter=A --name-only --format= -- '*.review.md' | xargs -n1 basename | sort -u | wc -l`); 18 in plans/, 17 in implemented-plans/. dev/skills-review-2026-10.md: cross-model 140 agent-invoked Claude sessions, 32 Codex (covers diffs too).
- **Outcomes:** Committed review files exist for ~11% of plans; most cross-model reviews are not committed as files. Judgment: file count underrepresents use.
- **Prior-art mention:** dev/agent-knowledge.html yes; dev/meta-practices.html yes ("2026-06-04 codex cross-model review: a different model family attacks the plan or the diff").

## Plan: commit trailer
- **One line:** prepare-commit-msg stamps `Plan:` (when exactly one plan matches the workstream) and `Workstream:` on worktree commits.
- **Lives in:** `bin/commit-provenance.ts`, root `.husky/`.
- **Appeared:** first `Plan:` in a message 2026-06-17 92a0a40bc "feat(chat): open chat from a card browse page" (`git log --grep='^Plan: '`); hook 2026-08-24 e00c5dcca.
- **Bottleneck relieved:** Tracing commits back to the plan that motivated them.
- **New bottleneck exposed:** Not visible.
- **Evidence:** 980 commits with Plan: trailer naming 92 distinct plans (`git log --format='%(trailers:key=Plan,valueonly)' | grep -c .`; `| sort -u | wc -l`); per month Aug 140, Sep 728, Oct 112. Workstream: trailers 2288.
- **Outcomes:** 980 commits traceable to 92 plans.
- **Prior-art mention:** no.

## bbx-design (product design before plan)
- **One line:** Product-design skill for user-facing work: situations in "When ..., I want to ..., so I can ...", right place/time, spirit check, trust ladder, failure view; written before plan tracks.
- **Lives in:** `.claude/skills/bbx-design/SKILL.md` (61 lines), `TEMPLATE.md` (55 lines); `<topic>.design.md` subplans.
- **Appeared:** 2026-10-07 6cd8fb1f6 "Design in the plan flow; dev-guidance audits; spirit and design docs refreshed" (retrospective watches for user-facing plans without a design section).
- **Bottleneck relieved:** Plans that described mechanism without the person's situation.
- **New bottleneck exposed:** Too new.
- **Evidence:** 3 commits; 1 `.design.md` file exists (in implemented-plans/).
- **Outcomes:** Judgment: 2 days old, one design subplan; no outcome yet.
- **Prior-art mention:** no.

## bbx-guide-* skills as planning aids
- **One line:** Instructional skills for recurring change shapes (API endpoints, schemas), consulted while planning/implementing.
- **Lives in:** `.claude/skills/bbx-guide-api/`, `.claude/skills/bbx-guide-schemas/`.
- **Appeared:** 2026-07-04 63df4d21d "docs: cb-guide-* instructional skills (first three) + plan tracks filled in" (api, schemas, testing); bbx-guide-testing retired 2026-10-07 19e261eb9 "Retire bbx-debug, bbx-frontend, bbx-guide-testing into the owning docs".
- **Bottleneck relieved:** Repeating the same how-to in each plan.
- **New bottleneck exposed:** Skill sprawl -> retirement of one of three into docs.
- **Evidence:** 15 commits across the two remaining.
- **Outcomes:** 2 of 3 still live; 1 abandoned 2026-10-07 19e261eb9.
- **Prior-art mention:** not checked in detail (grep found no "guide-" hits counted).

## CODING_FEEDBACK plan-reviewed checkpoint
- **One line:** After cross-model plan review, the planner records answers to four prompts via `bin/coding-feedback add --checkpoint plan-reviewed`.
- **Lives in:** `bin/coding-feedback`, bbx-plan step 5.
- **Appeared:** 2026-10-07 b8fc4b1aa "CODING_FEEDBACK: retrospective notes at plan, implement, review, and landing".
- **Bottleneck relieved:** Planning lessons lost after a session.
- **New bottleneck exposed:** Too new.
- **Evidence:** 2 days old; ledger not counted.
- **Outcomes:** Judgment: no outcome yet.
- **Prior-art mention:** no.

# Summary

- Predecessor was `<old-package>/docs/ideas.md` (2026-03-04 to 2026-07-04, 39 -> 1681 lines, 107 commits). There was no TODO.md. Split: 2026-07-04 2c6c497c2 (107 sections migrated).
- Queue size: 467 open in categories + 2 deferred; 717 closed (623 implemented, 53 wontfix, 41 superseded). 1224 distinct issues filed in ~3 months; filing outpaced closing every month. Median open age 45 days.
- ~80% of issues are agent-filed with `discovered-in`.
- Triage layers arrived in order: categories (07-10), manual-testing (07-19), watch/private (08-01), frontmatter enforcement (08-09), priority/ownership split (08-11), browser + next actions (08-13/14), bin/issues + pick-issues + re-encounter (08-24), deferred (08-31), alert-filing (09-18), local next-action store + do-it (10-05), autonomy ladder (10-08).
- Plans: 324 distinct plan files since June; ~199 implemented, 10 superseded/parked, ~70 open (41 partial). 980 commits carry Plan: trailers (92 plans); 358 carry Issue: trailers.

Could not verify:
- There is no `resolved-by` frontmatter field; closure is `resolution:` plus an opening note. "Closed with resolved-by" counts are not possible.
- Next-action usage history (the store keeps no history); only the current 12 `discuss` requests are visible.
- Issue counts filed by schedules (manual-tests, alert-filing); alert-filing writes to private-issues, which was not read.
- Plan status counts use `grep '^status:'` and include a few body lines (e.g. code samples). Treat as approximate.
- "Issues closed" per month counts first appearance under closed/, including items filed directly as closed.
- Transcript invocation counts are quoted from dev/skills-review-2026-10.md and dev/agent-knowledge.html, not recomputed.
