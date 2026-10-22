# Sweep: instructions and prompting for dev-repo agents

Worktree: devprocess-talk, HEAD e9ba5c2c8 (2026-10-09). Repo history starts 2026-01-27 (feb42fed4 "first commit"); package histories were imported into the monorepo on 2026-05-26 (9bd400229, 762d73d77, d8bf39507, 9c3ff625b, 9c5411149), so pre-May dates below are original commit dates from the imported histories. Total commits: 8778 (`git rev-list --count HEAD`).

Transcript numbers come from one run of `node --import tsx bin/skill-usage.ts --since 120` (aggregate only). Claude Code transcript retention reaches back only to 2026-07-21; Codex to 2026-06-17. Scanned: Claude 230 top-level sessions (181 interactive, 49 SDK) + 2055 subagent transcripts; Codex 854 top-level (715 exec, 137 interactive, 2 SDK) + 298 subagent rollouts.

---

## Package CLAUDE.md for the main system (beebox/CLAUDE.md, formerly <old-package>/CLAUDE.md)
- **One line:** The oldest always-loaded instruction file; it tells an agent what the system is, how to test, where code lives, and the behavioral rules.
- **Lives in:** `beebox/CLAUDE.md` (71 lines now; was `<old-package>/CLAUDE.md` until 2026-08-30).
- **Appeared:** 2026-01-30 e5cc933ad "Add initial project structure for the former product name" (217 lines). Reshaping: 2026-03-03 66a45f868 "Condense CLAUDE.md and update wildcard syntax in stack-decisions" (218 to 118 lines); 2026-03-06 bedf968cf "Rewrite CLAUDE.md for clarity and add self-improvement meta-instruction" (145 to 114); 2026-05-05 d6434b37e "CLAUDE.md review pass: compact and fix accuracy"; 2026-07-04 eef3b77a6 "docs: CLAUDE.md slimming — mechanism moves to colocated docs, pointers stay"; 2026-09-12 d7b47dfde "Route operational guidance and scope coding workflows" (184 to 67).
- **Bottleneck relieved:** Without it, each session rediscovered layout, test commands, and card format. The March 3 condense commit body: "Move verbose design principles behind docs/DESIGN.md reference to keep CLAUDE.md focused."
- **New bottleneck exposed:** Growth. After the March cut the file regrew steadily, one rule per commit, from 114 (2026-03-06) to 184 (2026-09-05). Each later cut moved text to another owner (nested CLAUDE.md, `bin/CLAUDE.md`, `docs/`), which created the next problem: pointer accuracy (see doc-check).
- **Evidence:**
  - Size series, 110 commits across both paths: `git log --follow --name-only --format='%ad|%h|%s' --date=short -- beebox/CLAUDE.md` then `git show <sha>:<path> | wc -l` per commit. Key points: 217 (01-30) → 222 (02-17) → 218 (03-03, 6aaefdebe) → 118 (03-03, 66a45f868) → 145 (03-04) → 114 (03-06) → 135 (04-27) → 121 (05-05) → 146 (05-26) → 158 (07-04, 4b1f3ba70) → 148 (07-04, eef3b77a6) → 165 (07-06) → 184 (09-05) → 67 (09-12) → 71 (10-08).
  - Commits touching it: 95 as `<old-package>/CLAUDE.md` + 15 as `beebox/CLAUDE.md` (`git log --follow --name-only --format='%h' -- beebox/CLAUDE.md | grep CLAUDE | sort | uniq -c`).
  - It still `@`-imports `code-style.md` (118 lines), so the loaded total is ~189 lines (`wc -l beebox/code-style.md`).
- **Outcomes:** Still in use and loaded in every beebox session. Two deep cuts (March 3: −100 lines; Sept 12: −117 lines), each followed by regrowth until the Sept 12 rewrite; since Sept 12 it has stayed at 67–71 lines for four weeks. Judgment: the regrowth pattern (114 → 184 over six months) shows that periodic manual cuts did not hold size; the Sept 12 cut came with a routing structure (owners per topic), and it is too early to say whether that one holds.
- **Prior-art mention:** yes, dev/agent-knowledge.html section 4 ("caught at 218 lines, halved in a single day, and held at a healthy weight ever since"; "51 commits"). The March 3 halving is correct (6aaefdebe 218 → 66a45f868 118). "Held at a healthy weight ever since" is wrong after the page was written (2026-06-23, 0c180c857): the file grew to 184 lines before the Sept 12 cut. The 51-commit figure was true near authoring time; it is 110 now.

## Self-improvement meta-instruction ("Improving These Instructions")
- **One line:** A section in the package CLAUDE.md telling the agent that when a correction exposes missing durable guidance, it adds a short rule at the narrowest accurate owner.
- **Lives in:** `beebox/CLAUDE.md` § "Improving These Instructions".
- **Appeared:** 2026-03-06 bedf968cf "Rewrite CLAUDE.md for clarity and add self-improvement meta-instruction" (body: "Added section instructing agents to update instructions when they get corrected."). Reshaped 2026-05-05 d6434b37e ("Compress 'Improving These Instructions' from 11 lines to 2"); current wording names owners (this file, nested CLAUDE.md, code-style.md, frontend.md, docs/).
- **Bottleneck relieved:** Corrections given in one session were lost to the next one.
- **New bottleneck exposed:** It drives the growth described above: every correction becomes a rule in the always-loaded file. The later fixes were "narrowest accurate owner" routing (added in the current wording), budgets, and the retrospective schedule that requires a lesson to recur before it becomes guidance (3cf3c3965, below).
- **Evidence:** `git log -S'Improving These Instructions' --format='%ad %h %s' --date=short | tail -1` → bedf968cf. Example of a rule it produced: 2026-04-17 54a044535 "Add CLAUDE.md rule: keep source and docs generic, no persona". Commits whose subject names CLAUDE.md: 49 (`git log --format=%s | grep -c 'CLAUDE.md'`). Commits touching any CLAUDE.md path ever: 462 (`git log --format=%h -- ':(glob)**/CLAUDE.md' | wc -l`).
- **Outcomes:** Still present. Not separately attributable: commits do not mark "rule added after a correction". Judgment: it accounts for much of the 114 → 184 line growth between March and September, and its later wording ("narrowest accurate owner") is the counterweight.
- **Prior-art mention:** yes, dev/meta-practices.html dates it 2026-03-06 (verified: bedf968cf).

## Nested CLAUDE.md files in the code tree
- **One line:** Area-specific CLAUDE.md files that Claude Code loads only when the agent works in that directory.
- **Lives in:** `beebox/src/services/CLAUDE.md`, `beebox/src/connectors/CLAUDE.md`, `beebox/src/core/reactor/CLAUDE.md`, `beebox/src/dev/CLAUDE.md`, `beebox/src/hub/CLAUDE.md`, `beebox/src/frontend/src/components/chat/CLAUDE.md`, `beebox/deploy/CLAUDE.md`, `beebox/docs/architecture/CLAUDE.md`.
- **Appeared:** 2026-03-03 55a8b97e7 "Document service layer pattern and connector injection" (services + connectors) and 5de4d4d69 "Split reactor into directory, add comprehensive tests" (reactor) — the same day as the condense commit. Later: 2026-03-04 1a45afb09 (deploy), 2026-03-11 f203fb286 (docs/architecture), 2026-03-15 621c9cc36 (src/dev), 2026-06-21 1fda8b9de "docs(chat-scroll): nested CLAUDE.md for the chat UI scroll model", 2026-07-04 4b1f3ba70 (hub).
- **Bottleneck relieved:** Subsystem rules no longer had to sit in the always-loaded package file.
- **New bottleneck exposed:** Rules become invisible unless the agent works in that directory; the 2026-05-05 review pass found duplication between levels ("'Service fakes are domain-specific' (covered in services/CLAUDE.md)").
- **Evidence:** 8 nested files under `beebox/` (from `git ls-files | grep CLAUDE.md`), 19–168 lines each (`xargs wc -l`).
- **Outcomes:** All 8 still exist; none were removed. The chat-scroll file (168 lines) is the largest. No usage data: CLAUDE.md loads are not visible in the skill-usage tool. Judgment: this is the mechanism the March 3 and July 4 cuts relied on to keep the package file small.
- **Prior-art mention:** yes, dev/agent-knowledge.html section 4–5 ("the knowledge didn't vanish, it budded down into the code tree"), dates consistent with git.

## Root CLAUDE.md (monorepo level)
- **One line:** A workspace-level file covering worktrees, router, issues, privacy, landing, and the autonomy vocabulary, above every package's file.
- **Lives in:** `CLAUDE.md` (73 lines, 1277 words).
- **Appeared:** 2026-05-26 9c5411149 "Import remaining files from ~/src/callback" (9 lines, 65 words: three projects, boxes live outside). Reshaping: 2026-07-04 eef3b77a6 (router/worktree internals moved to new `bin/CLAUDE.md`; 1393 → 807 words); 2026-09-12 c8c728285 "Apply compact root agent guidance and resolve monorepo doc links" (2242 → 850 words); 2026-10-08 8ee2fe5bd "Root CLAUDE.md: 'How much to do', the autonomy vocabulary".
- **Bottleneck relieved:** Cross-package concerns (worktrees, shared router, issues, deploy) had no home once four projects shared one repo.
- **New bottleneck exposed:** Same growth as the package file: 65 words (05-26) → 1393 (07-04) → 2242 (09-04). The 2026-09-12 calibration plan names it: "replaces the original 2,242-word root with roughly 800–1,100 words" (`beebox/docs/implemented-plans/prompt-calibration.md`).
- **Evidence:** 71 commits touch it (`git log --format=%h -- CLAUDE.md | wc -l`). Word series: `for h in $(git log --reverse --format=%h -- CLAUDE.md); do git show $h:CLAUDE.md | wc -w; done`. Peaks/cuts: 1393 → 807 (07-04 eef3b77a6), 2242 → 850 (09-12 c8c728285), regrown to 1277 (10-08).
- **Outcomes:** Still in use. Two cuts, each followed by regrowth (850 → 1277 words in four weeks after the second cut, 50% regrowth; most from the 10-08 autonomy section and the 10-07 memory folds).
- **Prior-art mention:** yes, dev/agent-knowledge.html ("The root CLAUDE.md (2026-05-26) is a new altitude"); date verified.

## Per-package and per-area CLAUDE.md layering (the full set)
- **One line:** One CLAUDE.md per package or area, so each package's agent gets its own contract and the root routes to them.
- **Lives in:** 20 tracked files: `CLAUDE.md`, `beebox/CLAUDE.md`, `beebox-clerk/CLAUDE.md`, `ios-app/CLAUDE.md`, `scan-uploader/CLAUDE.md`, `personal-vibe-check/CLAUDE.md`, `canvas-loop/CLAUDE.md`, `feedback-review/CLAUDE.md`, `site/CLAUDE.md`, `research/CLAUDE.md`, `issues/CLAUDE.md`, `bin/CLAUDE.md`, plus the 8 nested files above.
- **Appeared:** beebox-clerk 2026-02-07 83c6a9435; personal-vibe-check 2026-04-16 689f61aae "Add CLAUDE.md with explicit 'complete' checklist for rule work"; feedback-review 2026-05-26 9c5411149; issues 2026-07-04 2c6c497c2; research 2026-07-04 7b9646c98; bin 2026-07-04 eef3b77a6; ios-app 2026-07-19 b60eafbe8; site 2026-07-21 c2082f31e; scan-uploader 2026-09-14 73ee5f76f; canvas-loop 2026-10-07 04bae7e91 (replaced the retired canvas-loop-sketch skill).
- **Bottleneck relieved:** Mechanism-level text (router internals, issue format) could leave the root. eef3b77a6 body: "router/worktree internals ... -> new bin/CLAUDE.md; root keeps the contract + one-sentence pointers."
- **New bottleneck exposed:** The mechanism files are now the largest: `issues/CLAUDE.md` 303 lines, `site/CLAUDE.md` 284, `bin/CLAUDE.md` 261, `ios-app/CLAUDE.md` 241.
- **Evidence:** `git ls-files | grep -c CLAUDE.md` → 20; total 2284 lines (`git ls-files | grep CLAUDE.md | xargs wc -l`). 293 commits touch the 20 current paths (`git log --format=%h -- $(git ls-files | grep CLAUDE.md) | sort -u | wc -l`); 462 touch any CLAUDE.md path ever. `bin/CLAUDE.md` 81 commits, `issues/CLAUDE.md` 46 commits.
- **Outcomes:** All 20 in use. The 2026-10-07 retirement of canvas-loop-sketch shows a direction: a skill converted into an area CLAUDE.md (04bae7e91). Judgment: the layering moved size out of the root but did not reduce total guidance; the four largest files are each larger than the root.
- **Prior-art mention:** yes, dev/agent-knowledge.html section 5 ("Root = how the workspace runs · per-project = what each project is · nested = how each subsystem works"); its counts predate 7 of the 20 files.

## @-import of the code-style contract
- **One line:** `beebox/CLAUDE.md` ends with `@code-style.md`, so the coding contract loads with the package file but is maintained separately.
- **Lives in:** `beebox/CLAUDE.md` last line; `beebox/code-style.md` (118 lines); historically at-imports of THINKING_CLAUDE and CONVENTIONS (both since removed).
- **Appeared:** by 2026-02-17 a143179ad "Add vibe-check conventions and CLAUDE.md reference" (an at-import of CONVENTIONS at line 222, verified with `git show a143179ad:<old-package>/CLAUDE.md | grep '^@'`). 2026-05-05 149f89bff "Split CONVENTIONS.md into CODE-STYLE.md and FRONTEND.md"; d6434b37e switched the import to CODE-STYLE.
- **Bottleneck relieved:** Coding rules could grow without editing the package file.
- **New bottleneck exposed:** Imported size is hidden from line counts of CLAUDE.md alone. Not otherwise visible.
- **Evidence:** `git log --follow --format=%h -- beebox/code-style.md | wc -l` → 31 commits.
- **Outcomes:** Still in use. Judgment: the beebox file's 67-line figure understates the loaded size by 118 lines.
- **Prior-art mention:** no.

## Prompt calibration (Sept 12 rewrite of root, package, and skill descriptions)
- **One line:** A planned workstream that rewrote the root instructions, the beebox CLAUDE.md, and all skill descriptions by deciding each item's purpose, necessity, compact form, and destination, then tested routing with four models.
- **Lives in:** `beebox/docs/implemented-plans/prompt-calibration.md`, `beebox/docs/implemented-plans/prompt-calibration-bodies.subplan.md`, `beebox/docs/reports/prompt-calibration-pilot-2026-09-12.md` (+ `.results.json`).
- **Appeared:** 2026-09-12 6fa206288 "Shorten skill descriptions and plan root guidance cleanup"; c8c728285 "Apply compact root agent guidance and resolve monorepo doc links"; 0bb2ece90 "Reduce unnecessary work in agent guidance"; d7b47dfde "Route operational guidance and scope coding workflows" (18 files, +999/−1373); 0aea01bd2 "Clarify handoff authority and bound instruction workflows"; 880f9d4d0 "Complete instruction calibration and record decision pilot".
- **Bottleneck relieved:** Size and persuasion in the always-loaded layer. Plan, stated preferences: "Keep information and described impacts; remove attempts to convince a capable reader. Repository instructions serve multiple leading models."
- **New bottleneck exposed:** The pilot found models copying invented details from a worked briefing example ("The pilot also exposed copying of invented task details from a worked briefing example; the example was replaced with explicit fill-in fields"). The plan states it "does not claim measured improvement in skill activation"; the trigger-eval issue stays open (`issues/docs-and-chores/2026-07-30-run-skill-trigger-evals.md`).
- **Evidence:** Root 2242 → 850 words; beebox/CLAUDE.md 184 → 67 lines; SKILL.md total 3766 → 3092 lines between 2026-09-12 and 2026-09-13 (`git rev-list -1 --first-parent --before=<date> HEAD`, then sum `git show <c>:<skill>/SKILL.md | wc -l`). Pilot: 4 models × 12 routing cases + 5 authority scenarios; all predeclared required/forbidden boundaries held.
- **Outcomes:** Landed (plan status implemented). Produced the current shape of the root and beebox files and the delegation, noise, and lint wording still in use. Root regrew 850 → 1277 words in four weeks. Judgment: the largest single reduction in instruction size in the repo's history; its pilot is the only multi-model test of the instructions in the record.
- **Prior-art mention:** no (all prior-art pages predate it).

## "How much to do" autonomy ladder (discuss / plan / do / land)
- **One line:** Four named levels of authorization in the root CLAUDE.md; the human's wording sets the ceiling and an unclear request takes the lowest level.
- **Lives in:** `CLAUDE.md` § "How much to do"; issue tags `do-it` and `verify-without-me` (`issues/CLAUDE.md`, `.claude/skills/bbx-issue-actions/`); a dev knowledge audit in `beebox/src/dev/knowledge-audits.yaml` (~line 8003).
- **Appeared:** Issue tag first: 2026-08-14 722933909 "docs(issues): add next-action: verify-without-me" (`git log -S'verify-without-me' | tail -1`). The ladder in root: 2026-10-08 8ee2fe5bd "Root CLAUDE.md: 'How much to do', the autonomy vocabulary" (`git log -S'**discuss**' -- CLAUDE.md`), body: "'go ahead' after a proposal means do; destructive or outward-facing actions need their own yes at any level. A dev audit checks the reading of 'go ahead'."
- **Bottleneck relieved:** Ambiguous approvals. skill-usage "Recurring human instructions": "approve: go ahead / do it / sounds good" in 86 Claude sessions (153 turns) and 43 Codex sessions (70 turns) over 120 days; "finish / land / merge to main" in 64 Claude and 114 Codex sessions.
- **New bottleneck exposed:** Not visible yet (one day old).
- **Evidence:** +42 lines across 3 files in 8ee2fe5bd (`git show --stat 8ee2fe5bd`). One dev audit entry tests "go ahead".
- **Outcomes:** Too new to measure. Judgment: it collects terms that already existed (issue tags since 08-14, the finish ask) into one rule; its first check is the dev audit.
- **Prior-art mention:** no.

## Codex mirrors: generated AGENTS.md, .agents/skills links, .codex/agents
- **One line:** A generator copies every tracked CLAUDE.md verbatim to a gitignored AGENTS.md beside it, links each skill into `.agents/skills/`, and writes `.codex/agents/*.toml` and `.codex/hooks.json`, so Codex sessions get the same guidance.
- **Lives in:** `bin/generate-agents-md.ts` (280 lines), `bin/generate-codex-agents.ts` (195), `bin/lib/codex-skill-links.ts` (143), `bin/codex-skill-links.test.ts`, `bin/generate-agents-md.test.ts`, `bin/lib/launch-session.sh` (refuses a Codex launch with no AGENTS.md), `.gitignore`.
- **Appeared:** First attempt removed 2026-05-26 872450eb1 "Remove .agents/ and AGENTS.md — half-finished cross-tool convention" (body: "AGENTS.md was a stale partial duplicate of CLAUDE.md"). Generator 2026-08-04 a9dcb4029 "feat(worktrees): launch OpenAI Codex sessions via launch-worktree-session --agent codex". 2026-09-16 0d65810d0 "Generate Codex agent mirrors so Codex /finish runs on gpt-5.6-luna". 2026-10-07 6657f44d1 (stale-directory pruning in codex-skill-links).
- **Bottleneck relieved:** Codex sessions had no repo guidance. Generator header: "A committed AGENTS.md produced by find-replace rotted for a month and was removed in 872450eb; this generator kills both failure modes by construction: no transform to mangle, and regeneration at every worktree spin-up." `generate-codex-agents.ts` header: the hand-written hooks file used `$CLAUDE_PROJECT_DIR`, so under Codex "the lint hook exited 127 on every edit ... silently linting nothing."
- **New bottleneck exposed:** Drift in the main checkout: dev/skills-review-2026-10.md finding 6 ("The main checkout's `.agents/skills/` still holds three real directories from July ... `generateSkillLinks` ... prunes symlinks only"), fixed in 6657f44d1. Claude-only frontmatter (`allowed-tools`) is ignored under Codex. Open issue `issues/docs-and-chores/2026-09-18-move-to-agents-md-only.md` proposes one authored file now that Claude Code reads AGENTS.md (v2.1.277+).
- **Evidence:** 21 symlinks in `.agents/skills` (`ls .agents/skills | wc -l`). Codex top-level sessions in this repo over 120 days: 854 (skill-usage). Codex skill agent-invocations (SKILL.md reads) for `cross-model` 520 events/112 sessions, `browse` 268/75.
- **Outcomes:** In use: every Codex session in the repo (854 top-level in 120 days) receives the generated guidance. Fixed two silent failures (the 127-exit lint hook; Codex /finish running on the default model, 0d65810d0). The committed-copy approach was abandoned 2026-05-26 (872450eb1). Judgment: the verbatim-copy design is why the second attempt survived where the first rotted.
- **Prior-art mention:** dev/skills-review-2026-10.md finding 6 (drift). Others: no.

## Skills system (.claude/skills)
- **One line:** Repo skills: on-demand instruction files the model loads when a description matches, or the human invokes by name.
- **Lives in:** `.claude/skills/*/SKILL.md` (21 now), mirrored to `.agents/skills/`.
- **Appeared:** 2026-05-26 6babebd70 "Add /finish skill + SessionEnd auto-cleanup of merged worktrees"; same day cf9693e81 `browse` (as `.agents/skills/agent-browser`, consolidated in 872450eb1). Major reshaping: 2026-08-03 e52071dfb "skills: review pass — fix stale claims, add missing skills, sharpen triggers"; 2026-09-12 6fa206288 (descriptions); 2026-10-07 19e261eb9 "Retire bbx-debug, bbx-frontend, bbx-guide-testing into the owning docs", 04bae7e91 "Retire bbx-codehealth and canvas-loop-sketch", 6657f44d1 "Skill mechanics move to scripts".
- **Current skills (birth = first SKILL.md add, following renames; lines = SKILL.md / all tracked files in the dir):**
  - finish — 2026-05-26 6babebd70 — 75/75
  - browse — 2026-05-26 cf9693e81 (as .agents/skills) — 83/334
  - launch-worktree-session — 2026-05-27 275a29ffd — 91/91
  - bbx-plan (was cb-plan) — 2026-05-29 bd69d2f45 — 149/331
  - bbx-context — 2026-06-20 684932e71 — 38/38
  - bbx-migration — 2026-06-26 14dd4a7b8 — 148/148
  - bbx-guide-api — 2026-07-04 63df4d21d — 38/38
  - bbx-guide-schemas — 2026-07-04 63df4d21d — 79/79
  - bbx-ios-overlap — 2026-08-03 e52071dfb — 42/42
  - doctest — 2026-08-03 e52071dfb — 65/65
  - issues — 2026-08-03 e52071dfb — 30/30
  - knowledge-audit — 2026-08-03 e52071dfb — 47/47
  - cross-model (from `codex`, 2026-06-04 b3bf67809) — 2026-08-04 aae37764a — 150/150
  - security-report — 2026-08-07 db7901c5e — 277/277
  - field-probe — 2026-08-12 c64c96b9f — 92/92
  - bbx-issue-actions — 2026-08-13 bd46bf565 — 208/208
  - bbx-authoring-schedules — 2026-08-24 78e98ddad — 23/23
  - bbx-pick-issues — 2026-08-24 9da2ae439 — 118/118
  - deploy-status — 2026-10-07 6657f44d1 — 15/15
  - bbx-design — 2026-10-07 6cd8fb1f6 — 61/116
  - box-work — 2026-10-07 bd85ee4a1 — 12/12
- **Retired (10):** cb-prompt-review and vendored skill-creator (2026-08-03 cdb3fb8a2), codex → cross-model (2026-08-04 aae37764a), user-copy (2026-08-19 7f8aba23a, born same day ea3428b3e), bbx-codehealth and canvas-loop-sketch (2026-10-07 04bae7e91), bbx-debug, bbx-frontend, bbx-guide-testing (2026-10-07 19e261eb9), browser-task (2026-10-07 329045bff, moved to a managed box skill).
- **Bottleneck relieved:** Repeatable workflows (landing, launching, planning, review) no longer had to sit in always-loaded files or be re-explained per session.
- **New bottleneck exposed:** (1) Triggering: closed issues `issues/closed/exploration/2026-07-30-do-our-skills-auto-fire.md` ("We have never checked whether that happens") and `issues/closed/docs-and-chores/2026-07-30-skill-description-triggering-conditions.md` (a description that summarizes the workflow "gets acted on instead of the skill body being loaded"); both superseded into the still-open trigger-eval issue. (2) Staleness and contradiction: the skills review found stale box paths in five skills and a skill (bbx-codehealth) contradicting a code-style decision. (3) Listing budget: review finding 7, the harness drops descriptions of least-invoked skills first.
- **Evidence:**
  - Count now 21 (`ls .claude/skills | wc -l`); peak 24 (Sept 12 – Oct 6).
  - Births per month (distinct names, renames not double-counted; from `git log --diff-filter=A --name-only -- ':(glob)**/skills/*/SKILL.md'`): May 4, Jun 7, Jul 5, Aug 10 (+ codex→cross-model rename), Sep 1, Oct 3.
  - Counts/lines over time (`git rev-list -1 --first-parent --before=<date> HEAD`; count and sum SKILL.md): 06-01: 4 skills / 899 lines; 07-01: 11 / 2454; 08-01: 16 / 2678; 09-01: 23 / 3666; 09-12: 23 / 3766; 09-13: 24 / 3092; 10-06: 24 / 3126; 10-09: 21 / 1841 (2329 including reference files).
  - Commits with "skill" in subject: 138 (`git log --format=%s | grep -ic skill`); 283 mention it in subject or body (`git log -i --grep=skill --format=%h | wc -l`).
  - Monthly skill invocations, human + agent (skill-usage): Claude 15 / 296 / 319 / 124 and Codex 79 / 1401 / 1373 / 188 for Jul / Aug / Sep / Oct(1–9).
  - Top skills by sessions, 120 days (skill-usage): finish 290, cross-model 268, browse 128, bbx-plan 117, doctest 86, issues 85.
- **Outcomes:** In use. Over 120 days: finish typed by the human in 131 Claude and 110 Codex sessions; cross-model invoked by agents in 144 Claude sessions; bbx-plan in 56. Least used current skills: deploy-status (1 Codex session, new), box-work (1/2, new), field-probe (1 Claude session). Ten skills retired, six of them on 2026-10-07. Total SKILL.md text halved from its peak (3766 → 1841 lines). Judgment: the skills that held are workflow steps (finish, cross-model, plan, browse); most "craft" skills (debug, frontend, codehealth, guide-testing) were retired into docs.
- **Prior-art mention:** yes. dev/skills.html (2026-06-23) lists born dates that match git (bbx-plan 05-29, finish 05-26, codex 06-04, bbx-* craft 06-20); its sizes are June sizes (bbx-plan 439 lines, finish 240) and are stale. dev/agent-knowledge.html "three eras" (mechanics → plan & review → craft); the craft era has since been mostly retired. dev/skills-review-2026-10.md covers usage and recommendations.

## Skill descriptions written as triggers
- **One line:** Skill descriptions state when to load the skill (symptoms, exclusions), not a summary of the workflow.
- **Lives in:** frontmatter of each `.claude/skills/*/SKILL.md`; `bin/skill-lint.ts` checks description length.
- **Appeared:** Issue filed 2026-07-30 (`issues/closed/docs-and-chores/2026-07-30-skill-description-triggering-conditions.md`, sourced from `research/claude-elixir-phoenix`). 2026-08-03 e52071dfb "sharpen triggers". 2026-09-12 6fa206288 "Shorten skill descriptions" (23 descriptions). 2026-10-07 dev/skills-review-2026-10.md re-examined descriptions.
- **Bottleneck relieved:** Skills that never fired. Review on bbx-debug: "Investigate-or-debug instructions appear in 31 Claude sessions, so the work exists and the skill does not fire for it."
- **New bottleneck exposed:** No measurement of activation. The calibration plan: "This does not claim measured improvement in skill activation." The trigger-eval issue (open, backlog) owns it.
- **Evidence:** Description lengths in July ranged 223–574 characters (closed issue). Review: the human typed only finish (128 sessions), bbx-pick-issues (8), bbx-issue-actions (4) in Claude over 60 days; "Everything else is reached by an agent reading the description."
- **Outcomes:** In use. Judgment: the agent-invocation counts above show most skills do fire from descriptions (e.g. cross-model 169 agent invocations in 144 Claude sessions, never typed); the weak ones were retired rather than re-described.
- **Prior-art mention:** dev/skills-review-2026-10.md ("Descriptions carry triggers, not workflow"; finding 7 on the listing budget).

## Skills review and transcript-based skill usage measurement
- **One line:** A script counts skill use across local Claude Code and Codex transcripts (counts only), and a review report used it to retire, merge, and shrink skills.
- **Lives in:** `bin/skill-usage.ts` (81 lines) + `bin/lib/skill-usage-*.ts`; `dev/skills-review-2026-10.md` (100 lines); feeds `schedules/retrospective/run.ts`.
- **Appeared:** 2026-10-07 b4e7e7005 "bin/skill-usage: count skill use in Claude Code and Codex transcripts"; f2223faf7 "skill-usage: never print free text"; ea52a35b8 "Skills review report: usage counts, per-skill recommendations, outside ideas". Earlier, informal: dev/agent-knowledge.html (2026-06-23) used "~114 Claude Code session logs".
- **Bottleneck relieved:** Skill decisions without data. Report: "`/skill-doctor` is feature-flagged and not available in this install, so `bin/skill-usage.ts` is the measurement."
- **New bottleneck exposed:** "Loaded-but-unused could not be shown" (report). Codex counts SKILL.md reads in bulk, so "focused" sessions are the usable signal.
- **Evidence:** Report scope: 60 days, 228 Claude sessions + 1,699 subagent transcripts, 492 Codex sessions + 287 rollouts. My 120-day run: figures at the top of this file. Workstream skills-review commits, 2026-10-07–08: 50 including merges, 38 non-merge (`git log --grep='Workstream: skills-review' [--no-merges] --format=%h | wc -l`).
- **Outcomes:** The report's conclusions were acted on within one day: 6 skills retired (19e261eb9, 04bae7e91, 329045bff), cross-model shrunk to 139 lines with runners moved to `bin/cross-model-run`, launch-worktree-session shrunk to 91 lines, deploy-status skill + `bin/deploy-status` added from the "deploy or prod state questions 22/7 sessions" pattern, foreground-sleep rule added to root CLAUDE.md from "104/0" sleep-blocked sessions, skill-lint added, 85 stale doc references fixed (all in 6657f44d1). Report's "Decisions for the boxholder" 2 (codehealth: retired) and 4 (launch default: "launch skill lists models, no default", 04bae7e91) were resolved. Skill lines 3126 → 1841.
- **Prior-art mention:** yes — this is dev/skills-review-2026-10.md itself. Conclusions: humans type almost only `finish`; agent-written briefings used bare `/finish`/`$finish` sigils in 61 Claude and 22 Codex sessions against the root rule; seven findings (codehealth contradicts the barrel ban; figure card points to a dev-only skill; finish fires on "checkpoint"; stale box paths; flake policy contradicts finish.md; Codex mirror drift; listing budget); proposed merges/shrinks, a deploy-status script, trigger evals, rules-first ordering, `context: fork`, a size lint.

## Skill lint (pre-commit)
- **One line:** A pre-commit check on staged `.claude/` files: frontmatter, description length, body under 400 lines, reference depth, bare sigils, backticked paths.
- **Lives in:** `bin/skill-lint.ts` (308 lines), `bin/skill-lint.test.ts`, `.husky/pre-commit` lines 92–98, `bin/CLAUDE.md:146`.
- **Appeared:** 2026-10-07 6657f44d1 "Skill mechanics move to scripts; doc-check validates backticked paths".
- **Bottleneck relieved:** The report's proposal "A size lint for skills" and stale paths inside skills.
- **New bottleneck exposed:** Not visible.
- **Evidence:** `grep -n skill-lint .husky/pre-commit`.
- **Outcomes:** Two days old; no recorded catches. Judgment: it enforces in code what the review did by hand.
- **Prior-art mention:** dev/skills-review-2026-10.md proposed it ("A size lint for skills").

## Mechanics into scripts; "agent and skill files only ever grow unless pruned"
- **One line:** Procedure text in skills is replaced by a script the agent runs; the root CLAUDE.md tells agents touching an agent or skill file to remove more than they add and give a rewrite a line budget.
- **Lives in:** `CLAUDE.md` § "Implement and verify"; scripts `bin/cross-model-run`, `bin/deploy-status`, `bin/briefing-sigils.ts`, `bin/launch-worktree-session --check-briefing`.
- **Appeared:** Root rule 2026-10-07 059746c23 "Fold the last repo-material memories into bin/CLAUDE.md, mac-app/README.md, root CLAUDE.md, research/" (`git log -S'only ever grow unless pruned' -- CLAUDE.md`). Scripts 2026-10-07 6657f44d1. Precursor: 2026-08-26 4b7d18f65 "cb-plan: 517 lines become a 100-line skill and a template".
- **Bottleneck relieved:** Skill length and drift between prose and the commands it describes.
- **New bottleneck exposed:** Not visible.
- **Evidence:** cross-model 187 + 190 reference lines → 150 (report table vs `wc -l`); launch-worktree-session 218 → 91; bbx-plan 517 → ~100 (4b7d18f65).
- **Outcomes:** In use since 10-07. Contributed most of the 3126 → 1841 SKILL.md line drop. Judgment: too early to tell whether the "remove more than you add" rule holds against regrowth.
- **Prior-art mention:** partly; dev/skills-review-2026-10.md proposed the cross-model runner script.

## Subagent definitions (.claude/agents)
- **One line:** A named Claude Code subagent (`finish`) that runs the landing procedure headless so merge and test churn stays out of the main thread.
- **Lives in:** `.claude/agents/finish.md` (171 lines; the only file); generated Codex mirror `.codex/agents/finish.toml`; legacy `beebox/.claude/agents.json` (one `session-critique` agent, old format).
- **Appeared:** 2026-07-03 42d39875c "chore(claude): run /finish in a subagent; show model in status line". Codex mirror 2026-09-16 0d65810d0.
- **Bottleneck relieved:** Landing output filled the interactive session's context.
- **New bottleneck exposed:** Policy split between skill and agent: the review's finding 5, "doctest 61-64 and bbx-issue-actions 154-155 tell agents to rerun suites and file flake issues; `.claude/agents/finish.md` says never rerun to chase green."
- **Evidence:** `ls .claude/agents | wc -l` → 1; 35 commits (`git log --format=%h -- .claude/agents/finish.md | wc -l`). Worktree merges on main's first-parent line: 56 before 2026-07-03, 659 since (`git log --first-parent main --merges --format=%s --since=2026-07-03 | grep -c worktree-`).
- **Outcomes:** In use. Judgment: the 659 worktree landings since July 3 mostly went through finish (finish has 290 sessions over 120 days in skill-usage); not every merge is attributable to the agent.
- **Prior-art mention:** dev/skills-review-2026-10.md (finding 5, flake policy).

## Path-scoped rules (.claude/rules)
- **One line:** A rule file that Claude Code loads only for matching paths (here `**/*.doctest.md`).
- **Lives in:** `beebox/.claude/rules/doctest.md` (the only tracked dev-repo rule file). Embedded into the nearest AGENTS.md by the Codex generator.
- **Appeared:** 2026-03-03 257c2be03 "Support multiple examples per block, replace paths.test.ts with doctest" (`git log --follow --diff-filter=A -- beebox/.claude/rules/doctest.md`). Tracked memory notes "use `paths:` not `globs:`" (a field-name bug fixed in the box-side `init-rules.ts`).
- **Bottleneck relieved:** Doctest authoring rules load only when editing a doctest.
- **New bottleneck exposed:** Not visible in the dev repo. (Rules are used heavily on the box side; out of scope.)
- **Evidence:** `git ls-files | grep '\.claude/rules'` → 1 file.
- **Outcomes:** Still in use; the mechanism was not extended to other areas of the dev repo (nested CLAUDE.md is used instead).
- **Prior-art mention:** no.

## Briefing discipline for launched sessions (handoff, continuation wrapper, authorization)
- **One line:** A launching agent writes a briefing for a new worktree session with context, decisions, constraints, and exact authorization; the launcher wraps it in `<agent-continuation>` so the receiver knows a sibling agent wrote it.
- **Lives in:** `.claude/skills/launch-worktree-session/SKILL.md` (§ "Write the briefing"), `bin/launch-worktree-session` (~line 279), `bin/lib/launch-session.sh`, `bin/workstreams resume`.
- **Appeared:** 2026-05-27 275a29ffd "Add /launch-worktree-session skill + rename cccb-new"; 2026-05-27 adff57ace "launch-worktree-session: wrap briefings in <agent-continuation>"; 2026-09-12 0aea01bd2 "Clarify handoff authority and bound instruction workflows" (authorization rules); 2026-10-07 2505aba8c ("The launch skill carries the briefing and handoff rules that lived only in memory").
- **Bottleneck relieved:** adff57ace body: the new session "reads first-person plural ('we discussed') as the human's voice and may answer back to the prior agent instead of the human in the room." Skill: "Authorization must survive the handoff."
- **New bottleneck exposed:** Example contamination: the prompt-calibration pilot found models copying invented details from the worked briefing example (fixed with fill-in fields). Stale paths in briefings: review table "missing file or directory, often `cd` to the old `callback-*` paths" 118 Claude / 106 Codex sessions.
- **Evidence:** launch-worktree-session 35 commits (`git log --follow --format=%h -- .claude/skills/launch-worktree-session/SKILL.md | wc -l`); agent invocations 15 Claude sessions, 92 Codex events in 8 sessions (skill-usage, 120 days). Human "delegate: subagent / parallel / spin off a session" instructions in 19 Claude sessions (139 turns).
- **Outcomes:** In use. Root CLAUDE.md also carries "Shorter repo instructions are not a reason to strip scaffolding from subagent briefings" (c8c728285). Judgment: the wrapper has been unchanged in concept since May 27; the authorization rules were added after the decision pilot tested them.
- **Prior-art mention:** dev/workstream-story.md covers the workstream process generally (not checked line by line here); others no.

## Sigil rule for skill names in briefings
- **One line:** Agent-written briefings name skills in words ("use the finish skill") and never as `/finish` or `$finish`; the launcher refuses a briefing that contains one.
- **Lives in:** `.claude/skills/launch-worktree-session/SKILL.md` line 62; `bin/briefing-sigils.ts` (38 lines) + `bin/lib/briefing-sigils.ts`; `bin/skill-lint.ts` (bare sigils in skills).
- **Appeared:** 2026-09-20 69875694f "launch-worktree-session: never write a bare $skill in briefing prose" (guidance). Enforcement 2026-10-07 6657f44d1 ("scans the briefing for /skill and $skill sigils ... inline code spans count, fenced blocks do not; --allow-sigils overrides").
- **Bottleneck relieved:** A sigil in a briefing executes the skill in the receiving session (e.g. `/finish` as the first message starts a landing). Report: "Agent-written briefings used a bare `/finish` or `$finish` sigil in 61 Claude and 22 Codex sessions (114 for finish, 44 for cross-model), against the rule in the root CLAUDE.md."
- **New bottleneck exposed:** Not visible.
- **Evidence:** 120-day skill-usage: sessions with a sigil in an agent-written briefing: Claude 66, Codex 24. Briefing mention forms for finish: 127 slash, 5 dollar; cross-model 42 slash, 7 dollar.
- **Outcomes:** Guidance alone (Sept 20) did not stop the pattern (report counted 83 sessions after it existed); a mechanical refusal was added Oct 7. Post-enforcement counts not yet measurable (2 days). Judgment: an example of a rule moving from prose to a check after measurement showed the prose failing.
- **Prior-art mention:** yes, dev/skills-review-2026-10.md (counts above).

## Delegation guidance (lightest capable worker)
- **One line:** The root CLAUDE.md tells agents to delegate without asking, choose the lightest capable model, brief workers fully, and run long commands in the foreground inside subagents.
- **Lives in:** `CLAUDE.md` § "Implement and verify"; model list in the launch skill.
- **Appeared:** 2026-07-04 6f1aad752 "docs: note subagent discretion + model choice in root CLAUDE.md" (`git log -i -S'subagent' -- CLAUDE.md | tail -1`); 2026-08-31 2da898a52 "docs: encourage lightweight search subagents"; current wording 2026-09-12 c8c728285.
- **Bottleneck relieved:** Main-thread context and quota.
- **New bottleneck exposed:** "a subagent waiting on its own background job can stall with nothing running" (root text, same section).
- **Evidence:** Claude subagent transcripts in 120 days: 2055 against 230 top-level sessions (skill-usage).
- **Outcomes:** In use. Judgment: the ~9 subagents per top-level session ratio suggests delegation is routine.
- **Prior-art mention:** no.

## Memory: tracked import, and "memory belongs in docs"
- **One line:** Durable lessons go into tracked docs, skills, or CLAUDE.md; per-machine Claude Code auto-memory holds only machine or boxholder facts.
- **Lives in:** `.claude/memory/` (14 tracked files, a frozen import from the pre-monorepo checkout); `issues/exploration/2026-03-04-claude-code-memory-concerns.md` (open); user-level auto-memory directory for this repo (16 files, count only); the "memory belongs in docs" rule is in the user-level memory, not in a tracked file.
- **Appeared:** Concern filed 2026-03-04 (issue file date; "Durable project knowledge should go in repo files (CLAUDE.md, docs/), not auto-memory"). 2026-04-17 00f05941a "Promote durable memory notes into repo docs" (body: auto-memory "is path-hash-based, machine-specific, and not version-controlled"). Tracked import 2026-05-26 9c5411149. 2026-10-07 2505aba8c "Fold repo-overlapping memories into tracked guidance" and 059746c23 "Fold the last repo-material memories into ...".
- **Bottleneck relieved:** 2505aba8c body: "Memory is per-machine and invisible to Codex, subagents, and reviewers, so a memory that duplicates or corrects a tracked skill or doc is a defect in the tracked file."
- **New bottleneck exposed:** Stale memories send agents to old paths (review: `cd` to old `callback-*` paths in 118/106 sessions; "a one-time sweep of memory files and the launch briefing template"). The tracked `.claude/memory/` copy is not read by Claude Code in this repo (auto-memory lives under `~/.claude/projects/`), so it is an archive; last content commit 2026-07-05 b6fdd738e apart from path rewrites.
- **Evidence:** 2505aba8c: 27 files, +80/−31; 059746c23: 4 files, +41/−3 (`git show --stat`). 00f05941a: 7 files, +363.
- **Outcomes:** Two promotion passes (April, October) moved memory content into docs; the October pass also fixed finish triggering on "checkpoint" and pinned the Opus version in schedules. Judgment: the tracked `.claude/memory/` directory is a leftover and could mislead a reader of the repo.
- **Prior-art mention:** no.

## Simplified Technical English (STE) for issues and plans
- **One line:** Issue and plan bodies use short, active, unambiguous sentences with one idea each and consistent terms (ASD-STE100, in spirit).
- **Lives in:** `issues/CLAUDE.md:195`; `beebox/docs/development/workflow.md:40`; `.claude/skills/issues/SKILL.md:16`; `ACKNOWLEDGEMENTS.md:179`.
- **Appeared:** 2026-07-30 8a3a00bb1 "prompts: encourage Simplified Technical English (ASD-STE100) in issues + plans" (`git log -S'Simplified Technical English' | tail -1`); 2026-08-26 4b7d18f65 (bbx-plan); 2026-09-13 b22ed4697 "Development process docs: how development happens here, in five pages".
- **Bottleneck relieved:** Issues written by agents must be resumable cold by other agents; `issues/CLAUDE.md`: "enough context and `file:line` pointers to resume cold."
- **New bottleneck exposed:** Not visible. `research/beads-vs-issues.md` cites it as a reason to reject per-type issue templates ("STE body conventions are judgment, not template").
- **Evidence:** Issues in tree: 1186 `.md` files, 717 closed (`find issues -name '*.md' | wc -l`; same for `issues/closed`).
- **Outcomes:** In use as written guidance; no check enforces it. Judgment: not measurable from the record.
- **Prior-art mention:** no.

## No Claude-isms / no "not X, but Y" antithesis / no assessment tics
- **One line:** Avoid stock model phrases ("load-bearing", "genuinely", "the real X"), the negated antithesis, candor openers, and rating an idea instead of stating its consequence.
- **Lives in:** `.claude/memory/feedback_no_load_bearing.md` (tracked, from the old checkout); `issues/docs-and-chores/2026-09-16-remove-claude-isms-from-repo-docs.md` (open); `issues/docs-and-chores/2026-08-19-skill-for-how-the-agent-writes-to-the-developer.md` (open); `issues/features/2026-07-05-writing-skill.md`; user-level memory files (not tracked).
- **Appeared:** tracked memory note imported 2026-05-26 9c5411149; antithesis first mentioned 2026-07-05 b6fdd738e (`git log -S'antithesis' | tail -1`); 2026-07-20 a5f9e2b78 "issue(writing): reframe from anti-AI style guide to assembling the user's words"; 2026-08-19 7f8aba23a proposal (and same-day retirement of the `user-copy` skill born in ea3428b3e).
- **Bottleneck relieved:** The open issue: "Once in a doc, they persist: agents read the docs, copy the voice, and add more."
- **New bottleneck exposed:** The rule is not in any tracked CLAUDE.md; it lives in memory and open issues, so Codex and subagents do not see it (per the repo's own memory reasoning in 2505aba8c).
- **Evidence:** Counts on 2026-09-16 over tracked `*.md` (issue file): "the real " 362 lines, "genuinely" 296, "not just" 290, "load-bearing" 145 (+39 `.ts` files).
- **Outcomes:** The cleanup issue is open; no sweep commit found. Judgment: the rule reaches Claude sessions through user memory only.
- **Prior-art mention:** no.

## Doc altitude and "no invented color"
- **One line:** A rarely used thing gets a reference entry and at most one pointer on an always-on surface; prose avoids affect adjectives and drama.
- **Lives in:** `beebox/docs/prompts/review.md:60` ("**Altitude matches use.**"); referenced in many implemented plans as `feedback_doc_altitude_matches_importance` (a memory name). "No invented color" appears only in user-level memory; `git grep -i 'invented color'` finds nothing tracked.
- **Appeared:** `git log -S'Altitude matches use' | tail -1` → 2026-10-07 2505aba8c (moved from memory into tracked guidance). Plans cite the memory name from mid-2026 (e.g. `beebox/docs/implemented-plans/bbx-agent-surface.md:412`).
- **Bottleneck relieved:** Always-loaded size; low-use commands crowding the guide.
- **New bottleneck exposed:** Not visible.
- **Evidence:** `git grep -c doc_altitude` across implemented plans (at least 4 plan citations listed by `grep -rn altitude`).
- **Outcomes:** Used as a review criterion in plans. Judgment: one of the principles behind every slimming pass.
- **Prior-art mention:** no.

## Word and size budgets
- **One line:** Explicit size targets for instruction surfaces: a word budget on the box agent guide enforced by lint; line targets for skills (body < 400 lines in skill-lint; per-skill budgets in the review); a word range for the root rewrite.
- **Lives in:** dev side: `bin/skill-lint.ts`, `dev/skills-review-2026-10.md` ("Proposed merges and shrinks" table), `beebox/docs/implemented-plans/prompt-calibration.md` ("roughly 800–1,100 words"). Box side (other sweep): `src/core/agent-guide/ledger.yaml`, `pnpm lint:guide`, `issues/docs-and-chores/2026-10-02-agent-guide-over-word-budget.md`.
- **Appeared:** Closed issues `issues/closed/exploration/2026-06-12-knowledge-budget-always-loaded-context.md` and `issues/closed/docs-and-chores/2026-07-04-instruction-surface-size-budget.md` (box guide); dev-side budgets 2026-09-12 (calibration) and 2026-10-07 (review, skill-lint).
- **Bottleneck relieved:** June issue: "every addition feels individually justified, and the layer only grows."
- **New bottleneck exposed:** Budget breaches: open issue "The rendered agent guide is over its word budget on main" (box side).
- **Evidence:** Box guide 9,508 → 5,595 words (closed issue). Dev: review budgets e.g. cross-model 377 → 130 lines (landed at 150).
- **Outcomes:** Dev-repo CLAUDE.md files have no enforced budget; only skills do (since 10-07). Judgment: the root and package files' regrowth after each cut is consistent with that gap.
- **Prior-art mention:** no.

## No-disable lint guardrail
- **One line:** Agents may not disable or weaken lint rules to pass; the one exception is a justified single-line `eslint-disable-next-line` for a narrow false positive.
- **Lives in:** `CLAUDE.md` § "Implement and verify"; `beebox/CLAUDE.md` § Development; guard comments atop each `eslint.config.mjs`.
- **Appeared:** 2026-05-31 8965f1d36 "eslint: remove now-empty suppressions ratchet; harden the no-disable guardrail" (body: add "NEVER disable or weaken a lint rule to make code pass. Ask first."). Current wording 2026-09-12 c8c728285 (root) and d7b47dfde (beebox).
- **Bottleneck relieved:** 8965f1d36: "Harden against silent re-disabling ... A failing rule is a prompt to fix the code or raise it with the user — not to switch the rule off." All projects had reached zero suppressions.
- **New bottleneck exposed:** Not visible.
- **Evidence:** ESLint errors as recurring tool failures: 32 Claude sessions / 69 Codex sessions (skill-usage, 120 days) — agents meet lint often.
- **Outcomes:** Kept through both rewrites; the calibration plan lists it under "keep". Judgment: no record of a weakening slipping through was found in this sweep (not searched exhaustively).
- **Prior-art mention:** yes, dev/meta-practices.html dates it 2026-05-31 (verified: 8965f1d36).

## Noise-as-bug rule
- **One line:** Unsolicited tool output (warnings, deprecations, peer-dependency lists) is treated as a bug to fix, because it costs agent context every time.
- **Lives in:** `CLAUDE.md` § "Implement and verify"; `beebox/CLAUDE.md` § Development.
- **Appeared:** 2026-05-26 085a23011 "Hoist husky to monorepo root; recover hooks broken by migration" (root text "**Treat noisy command output as a bug.**"). Rewritten 2026-09-12 c8c728285.
- **Bottleneck relieved:** 085a23011 text: noisy output "cost[s] real agent context every time they appear."
- **New bottleneck exposed:** Not visible.
- **Evidence:** `git show 085a23011:CLAUDE.md | grep -i warning`.
- **Outcomes:** Still in force. Example derived change: 2026-06-12 a7fd417de "fix(chat): diarization diagnostics are anomaly-only — agents read stderr too". Judgment: not quantified.
- **Prior-art mention:** no.

## Guardrails added as single root rules (search scope, sleep, boxes outside repo)
- **One line:** Short root rules added after observed failures: never search the whole home directory; foreground `sleep` is blocked, so wait with an until-loop or Monitor; boxes live outside the repo so box agents do not inherit dev instructions.
- **Lives in:** `CLAUDE.md`.
- **Appeared:** Boxes outside repo: 2026-05-26 9c5411149 (first root file: "outside this repo so agents don't inherit this CLAUDE.md"). Home search: 2026-09-26 7768f81ff "Root instructions: never search the whole home directory". Sleep: 2026-10-07 6657f44d1.
- **Bottleneck relieved:** Sleep: review "harness blocked a foreground `sleep`" 104 Claude sessions. Home search: macOS privacy prompts (root text).
- **New bottleneck exposed:** Not visible.
- **Evidence:** 120-day skill-usage: "sleep blocked (use Monitor)" 107 Claude sessions / 230 events.
- **Outcomes:** Sleep rule is 2 days old; effect not yet measurable. Judgment: each is a one-line response to a measured or repeated failure.
- **Prior-art mention:** sleep: dev/skills-review-2026-10.md (proposed the root line). Others no.

## Dev knowledge audits (`knowledge-audit --dev`) — note only
- **One line:** Audits that ask a Claude Code session in this checkout questions and grade whether the repo's CLAUDE.md files, skills, and docs taught it the answer.
- **Lives in:** `beebox/src/dev/knowledge-audit.ts` (`runDevAudits`), `beebox/src/dev/knowledge-audits.yaml` (`surface: dev`), `.claude/skills/knowledge-audit/SKILL.md`.
- **Appeared:** 2026-10-07 6cd8fb1f6 "Design in the plan flow; dev-guidance audits; spirit and design docs refreshed"; 2026-10-08 9c464c073 "Dev audits: deny the answer key, count only successful reads, hard timeout", 30516e30f.
- **Bottleneck relieved / exposed:** Covered by the audits sweep.
- **Evidence:** 11 dev entries (`grep -c 'surface: dev' beebox/src/dev/knowledge-audits.yaml`).
- **Outcomes:** Two days old; the first re-run required denying the answer key (9c464c073). See audits sweep.
- **Prior-art mention:** dev/meta-practices.html covers box knowledge audits (2026-02-26), not the dev mode.

## doc-check enforcement (links, orphans, backticked paths)
- **One line:** The pre-commit hook fails a Markdown commit with a broken reference, a live-area orphan, a duplicate issue basename, or (since Oct 7) a backticked repo path that does not resolve.
- **Lives in:** `beebox/src/dev/doc-check/` (check.ts, file-paths.ts, frontmatter.ts, link-repair.ts, private-link.ts) + doctests; `beebox/docs/README.md` § "Enforcement (`pnpm doc-check`)"; `.husky/pre-commit:103`.
- **Appeared:** Precursor 2026-03-04 1a45afb09 "Add documentation graph tool, fix doc orphans and descriptions". 2026-07-04 efad24c61 "feat(docs): doc-check enforcement — broken refs + live-area orphans fail commits". 2026-10-07 6657f44d1 (backticked paths).
- **Bottleneck relieved:** Pointer rot after slimming moved text into many owners; review finding 4 (stale box paths in skills).
- **New bottleneck exposed:** Exemptions needed for historical records, plans, and box-facing docs (README lists them).
- **Evidence:** 96 commits mention doc-check (`git log -i --grep='doc-check' --format=%h | wc -l`). 85 stale references fixed when path checking was added (6657f44d1 body).
- **Outcomes:** In use on every `.md` commit. Fixed 85 stale references in one pass. Related closed issue: `issues/closed/docs-and-chores/2026-08-22-doc-check-skips-untracked-docs.md`.
- **Prior-art mention:** dev/meta-practices.html "documentation-graph tool" 2026-03-04 (verified: 1a45afb09).

## Doc lifecycle check (plan status vs location)
- **One line:** Validates that each plan's `status` frontmatter matches its directory (plans/, implemented-plans/), on the staged index at commit and on the candidate branch before `bin/land`.
- **Lives in:** `bin/doc-lifecycle-check.ts` (116 lines), `beebox/src/dev/doc-check/frontmatter.ts`, `.husky/pre-commit:73`.
- **Appeared:** 2026-09-13 12d776dd2 "Clarify document lifecycle and validate plans before landing" (Workstream: prompt-calibration).
- **Bottleneck relieved:** Historical plans read as live manuals; beebox/CLAUDE.md: "Do not use historical plans as live manuals."
- **New bottleneck exposed:** Not visible.
- **Evidence:** `grep -n doc-lifecycle .husky/pre-commit`.
- **Outcomes:** In use. Judgment: no recorded catches found in commit messages.
- **Prior-art mention:** no.

## Glossary
- **One line:** One file of project proper nouns and narrowed words, with a "User-facing:" line per entry; the glossary wins when code or docs disagree.
- **Lives in:** `beebox/docs/glossary.md` (91 lines).
- **Appeared:** 2026-05-21 dbfc2335e "Add docs/glossary.md with starter Proper-Noun set"; user-facing register decisions 2026-09-02 (`docs/implemented-plans/vocab-glossary-sweep.md`).
- **Bottleneck relieved:** Term drift across agent-written code and docs.
- **New bottleneck exposed:** Open capitalization question in the file.
- **Evidence:** 22 commits (`git log --follow --format=%h -- beebox/docs/glossary.md | wc -l`).
- **Outcomes:** In use; drives UI copy wording via the user-facing lines. Judgment: modest change rate (22 commits in 4.5 months).
- **Prior-art mention:** yes, dev/meta-practices.html dates it 2026-05-21 (verified).

## Stack-decisions doc
- **One line:** A record of which tools and approaches were chosen and why, so agents do not re-litigate them.
- **Lives in:** `beebox/docs/reports/stack-decisions-2026-09-04.md` (was `<old-package>/docs/stack-decisions.md`, then `beebox/docs/stack-decisions.md`).
- **Appeared:** 2026-03-02 09fc3ce36 "Add stack decisions document". 2026-05-29 5e8015be9 "stack-decisions: reconcile with code". 2026-09-12 dcc1778a7 "Freeze stack-decisions.md as a dated report".
- **Bottleneck relieved:** Repeated tool debates by agents.
- **New bottleneck exposed:** Drift from code (5e8015be9 had to reconcile it); resolved by freezing it as history.
- **Evidence:** 40 commits (`git log --follow --format=%h -- beebox/docs/reports/stack-decisions-2026-09-04.md | wc -l`).
- **Outcomes:** Abandoned as a live document on 2026-09-12 (dcc1778a7); kept as a dated report.
- **Prior-art mention:** yes, dev/meta-practices.html dates it 2026-03-02 (verified).

## Retrospective loop from coding feedback to guidance
- **One line:** Agents write a short coding-feedback note at plan, review, and landing; a schedule every three days turns repeated items into guidance edits or issues.
- **Lives in:** `bin/coding-feedback`; `schedules/retrospective/` (run.ts, prompt.md, schedule.yaml); steps in bbx-plan, cross-model, and `.claude/agents/finish.md`.
- **Appeared:** 2026-10-07 b8fc4b1aa "CODING_FEEDBACK: retrospective notes at plan, implement, review, and landing"; 3cf3c3965 "schedules/retrospective: every 3 days, turn CODING_FEEDBACK into guidance changes".
- **Bottleneck relieved:** The self-improvement instruction added rules on single corrections. 3cf3c3965: "edits asked for twice (or once plus a transcript pattern) land on the branch ... once-seen items go on the watch list."
- **New bottleneck exposed:** Not visible yet.
- **Evidence:** Run records not checked in this sweep (schedules sweep covers them).
- **Outcomes:** Two days old. Judgment: it replaces "add a rule per correction" with a recurrence threshold.
- **Prior-art mention:** no.

## Document comments read at pickup
- **One line:** Human comments on tracked documents live outside git; the root CLAUDE.md tells agents to list and act on them at workstream pickup, then clear them.
- **Lives in:** `bin/comments`, `bin/comments.ts` (392 lines), `CLAUDE.md` § "Record and show work".
- **Appeared:** 2026-08-22 31545f15f "feat(comments): the document-comment store and bin/comments".
- **Bottleneck relieved:** Feedback on a plan doc had no channel back into the agent session.
- **New bottleneck exposed:** `issues/features/2026-08-22-orphaned-comment-namespaces-after-a-cull.md` (open).
- **Evidence:** not measured here.
- **Outcomes:** In use per root instructions; usage not counted in this sweep.
- **Prior-art mention:** no.

## Prior-art pages: date verification summary
- dev/meta-practices.html, dev/agent-knowledge.html, dev/skills.html, dev/skill-tree.html, dev/viz-*.html were all created 2026-06-23 in 0c180c857 "feat(dev): add the /dev/ visualization space + markdown doc browser"; later commits only rename paths (b6fdd738e, dab834811, fb6a9e18a). Their numbers are June snapshots.
- Verified correct: stack-decisions 03-02, documentation-graph tool 03-04, self-improvement meta-instruction 03-06, glossary 05-21, skills system 05-26, no-disable guardrail 05-31, codex cross-model 06-04, bbx-* craft skills 06-20, beebox/CLAUDE.md born 01-30, March 3 halving.
- Stale or wrong now: "held at a healthy weight ever since" (grew to 184 before Sept 12); "51 commits" (110 now); skill sizes in dev/skills.html (bbx-plan 439 → 149 lines, finish 240 → 75); the "craft" era of skills (5 of the June craft skills retired 2026-10-07: bbx-debug, bbx-frontend, bbx-codehealth, and later bbx-guide-testing, canvas-loop-sketch).

---

## Summary
- 20 tracked CLAUDE.md files (2284 lines); 462 commits ever touched a CLAUDE.md path. The package file went 217 → 118 (03-03) → 184 (09-05) → 67 (09-12); the root went 65 → 2242 words (09-04) → 850 (09-12) → 1277 (10-08). Each cut was followed by regrowth; size budgets exist for skills and the box guide but not for dev CLAUDE.md files.
- Skills: 31 distinct skills created, 10 retired, 21 live; peak 24 skills / 3766 SKILL.md lines (09-12), now 1841 lines after the 10-07 review. Human-typed use is almost only `finish`; agents reach the rest by description. The review was the first data-driven pass (bin/skill-usage.ts) and its conclusions landed within a day.
- Recurring pattern: prose rule → measured failure → script or check (sigils: rule 09-20, refusal 10-07; skill size: review → skill-lint; stale paths → doc-check path checking; Codex drift → generator + pruning).
- Codex parity came from generated, verbatim mirrors after a committed copy rotted (05-26 removal, 08-04 generator).

## Could not verify / gaps
- Whether Claude Code actually loads the tracked `.claude/memory/` directory in this repo (I inferred from the auto-memory path convention that it does not).
- Post-enforcement effect of the sigil refusal and sleep rule (2 days of data).
- Claude transcripts before 2026-07-21 are gone, so transcript counts cannot cover May–July.
- Retrospective schedule run counts and dev-audit pass rates (left to the schedules and audits sweeps).
- Whether any lint weakening slipped past the guardrail (not searched exhaustively).
- dev/workstream-story.md and the viz-*.html pages were not read line by line.
