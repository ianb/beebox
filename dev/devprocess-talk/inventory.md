# Development techniques in this repository: inventory

Collected 2026-10-09 at e9ba5c2c8. Companion to [the timeline](timeline.md) and [the bottleneck narrative](bottlenecks.md). The detailed evidence, with the command behind every number, is in the seven sweep reports under [reports/](reports/): [parallel work](reports/sweep-parallel-work.md), [instructions](reports/sweep-instructions.md), [quality gates](reports/sweep-quality.md), [agent knowledge](reports/sweep-agent-knowledge.md), [queue and planning](reports/sweep-queue-planning.md), [unattended work and multi-model](reports/sweep-unattended-multimodel.md), and [repo-wide numbers](reports/sweep-numbers.md).


Naming note: the product was renamed on 2026-08-30 (see `beebox/docs/name-history.md`). Pre-rename paths and the old name are written as `<old-package>`, `<old-clerk-package>` and "the former product name" here, because the pre-commit guard keeps the retired name out of tracked files.
How to read an entry:

- **Where:** the files, skills, scripts or schedules that carry it.
- **Since:** first commit, and the commits that reshaped it. Dates and shas come from git in this checkout. Pre-May dates are from the imported package histories.
- **Relieved / exposed:** the constraint it removed, and the problem it created or made visible next.
- **Outcome:** whether it is still used and what it has produced. A line marked *judgment* is an inference where the record is thin.

Privacy: aggregate counts only from transcripts and local stores; no box content; nothing from `private-issues/`.

## Repo-wide numbers

| Measure | Value |
|---|---|
| First commit / commits / active days | 2026-01-27 / 8,778 / 226 of 256 calendar days |
| Commits per month | Jan 25, Feb 201, Mar 266, Apr 214, May 482, Jun 748, Jul 1,510, Aug 2,305, Sep 2,268, Oct (9 days) 759 |
| Worktree branches landing on main, per month | May 6, Jun 34, Jul 25, Aug 114, Sep 305, Oct 116 (undercounts before 2026-08-24, when landings were fast-forwards) |
| Distinct worktree branches ever merged | 222 |
| Non-blank code lines, Feb 1 → HEAD | 11,858 → 390,172 |
| Doctest files / lines at HEAD | 1,035 / 141,454 (83% of test lines); 142 `*.test.ts` files |
| Docs lines at HEAD (plans, issues, guides, research) | about 246k, roughly 63% of code lines |
| Issues filed / closed since 2026-07-04 | 1,224 / 721 (623 implemented, 53 wontfix, 41 superseded) |
| Plans written / implemented | 324 / about 199 |
| CLAUDE.md files / lines | 20 / 2,284 |
| Skills live / ever created / retired | 21 / 31 / 10 |
| Schedules | 15, all born 2026-08-24 or later |
| Co-Authored-By trailer values | 19 (Opus 3,498, Fable 2,048, Sonnet 167, Haiku 3, Codex 1); 1,328 non-merge commits carry none |
| Sessions in the last 60 days (bin/skill-usage) | Claude 225 top-level + 1,845 subagent transcripts; Codex 508 (423 `exec`) + 298 subagent rollouts |
| Reverts | 13 subject-line reverts in 8,778 commits |

Monorepo assembled 2026-05-26 from five repositories (the developer's stated reason: an agent is equally good in every area at once, so cross-repository changes became obvious, common, and desired; 46 of 154 trailered workstreams since 2026-08-24 touch two or more packages, iOS app plus server the most common pair) (<old-package> 874 commits, cardworks 44, personal-vibe-check 25, <old-clerk-package> 15, agent-doctest 9). Product renamed from the former product name to Bee Box 2026-08-30 (4,188 files).

---

## 1. Parallel work

### Managed git worktrees
One checkout per line of work on a `worktree-<name>` branch, created by repo tooling under `~/src/beebox-worktrees/`.
- **Where:** `bin/workstreams` (`create`), `bin/lib/worktree-create.sh`, `.claude/hooks/`, `bin/docs/worktree-lifecycle.md`, root `CLAUDE.md`.
- **Since:** 2026-05-26 43fc5762e, f5e5d6e8e. Promoted into the CLI 2026-08-08 6d671837b.
- **Relieved:** several agents in one checkout collided ("They did not stay in their area").
- **Exposed:** sessions became cheap, so they accumulated (see workstream split); concurrent `git worktree add` races; host contention from parallel test runs.
- **Evidence:** 548 first-parent worktree merges from 191 distinct names; 497 of 1,185 issues carry `discovered-in: worktree-…`; 232 Claude project directories and 797 Codex rollouts reference a worktree path.
- **Outcome:** Still the unit of every non-trivial change. Merges rose from 3 (May) to 299 (September). Every technique below in this section depends on it.

### Per-worktree test-box clones
Each worktree gets its own clone of the test box at `~/src/box-worktrees/<name>/test1/`, with `.env` copied minus the real-box list.
- **Since:** 2026-05-26 f5e5d6e8e; `keep/` branches for unmerged box state 2026-08-09 19e33d98f.
- **Relieved:** one agent's test mutations showing up in another's run; an isolated checkout cannot serve real boxes.
- **Exposed:** culling destroyed repro data a human still needed, which led to manual-testing pins.
- **Evidence:** 45 box clones on disk against 7 live worktrees.
- **Outcome:** In use. *Judgment:* the 45-vs-7 gap means clones outlive their worktrees; whether they are kept deliberately was not verified.

### Shared dev router (lazy start, idle stop)
One proxy on port 3210 serves every checkout at `/<worktree>/<box>/…`, cold-starting a worktree on first request and stopping it after idle time.
- **Where:** `workstreams-app/src/router/`, `bin/docs/router-protocol.md` (304 lines), `bin/docs/router-operations.md`.
- **Since:** 2026-05-26 967b776af, 96932b6df. Idle-storm fix 2026-06-09 d7aa208fb; moved into the workstreams app 2026-09-02 3b3ba0df5; retries under host load 2026-09-15 2a8d3fa75.
- **Relieved:** a hand-run dev server and port per checkout.
- **Exposed:** shared process state: orphans, duplicate starts, WebSocket reconnects, startup timeouts under load; a rule that one worktree may not restart the router for everyone.
- **Outcome:** In daily use; hosts `/dev/`, exhibits, and the dashboard. Tailscale exposure (2026-07-21 b12611e80) extended review to the phone. *Judgment:* 451 lines of protocol docs is the cost of one process shared by all sessions.

### Per-worktree browser daemon (`bin/browse`)
A worktree-aware wrapper around agent-browser so parallel agents drive browsers without sharing a session.
- **Since:** 2026-05-26 74393cc71, 4f23d00cb; reaper fix 2026-06-26 0df685632.
- **Relieved:** agents could not see frontend behavior. **Exposed:** daemon reclamation needed the same liveness oracle as teardown.
- **Evidence:** browse skill used in 51 Claude sessions over 60 days; 128 sessions over 120 days.
- **Outcome:** In regular use; the smoke tier is built on it. *Indirect development:* 86 commits touch the harness (`browse/`, 1,703 lines of TypeScript, plus the wrapper and skill); of the 24 with a workstream trailer, 21 came from streams doing other work (journey walks 7, skills review 2, prompt calibration 2, the rename 2, feature branches). The Aug 23 click rewrite (2fc153770) began because a journey walker misread silent clicks as the app doing nothing; the Oct 8 covered-click and upload-path fixes came out of the October journey walks. The human never drives the browser and judges the tool by whether the agent's reports hold up.

### launch-worktree-session
An agent spins off a new session in a fresh worktree, opening one terminal tab, with a briefing that carries decisions and authorization.
- **Where:** `.claude/skills/launch-worktree-session/SKILL.md` (91 lines), `bin/launch-worktree-session`, `bin/lib/launch-session.sh`.
- **Since:** 2026-05-27 275a29ffd. Codex engine 2026-08-04 a9dcb4029; shared launcher 2026-08-09 c7f37aa5b; routing and briefed resume 2026-08-20 a0a84452c.
- **Relieved:** the human opening terminals and re-explaining context per line of work.
- **Exposed:** concurrent launches raced in `git worktree add`; a launch-to-agent gap where a new worktree looked dead; spin-offs duplicating existing streams.
- **Evidence:** 36 commits on the skill; 19 Claude sessions called it in 60 days; never typed by the human.
- **Outcome:** Launched most of the 191 merged worktrees (*judgment*; manual creation is not separable in git). Shrunk from 218 to 91 lines in the October skills review.

### Creation lock and launch lease
Per-name serialization of setup, a short repo-wide lock around `git worktree add`, and a bounded `launching` state counted as live.
- **Since:** 2026-08-24 0300a0185, c69ac5903.
- **Relieved:** parallel launches failing after the tab opened; a fresh branch is "merged and clean", so cleanup could run before the session was visible.
- **Outcome:** Closed two bugs; one residual race in the October review window.

### Workstream vs worktree split
A workstream is the durable record (registry entry, plan, issues, exhibits); a worktree is a disposable checkout attached to it, culled when merged and resumed on demand.
- **Where:** `bin/workstreams` (1,080 lines: list, create, resume, remove, release, cull state, liveness), `~/.cache/beebox/workstreams/*.json`, `beebox/docs/implemented-plans/workstreams.md`.
- **Since:** redesign issue filed 2026-08-08 516ebbbe7 (`issues/closed/features/2026-08-08-worktree-session-workflow-redesign.md`); rename 2026-08-09 a4d74648f; registry, resume, cull state same day (2d88a7f23, dc55704d3, 32fb3962e).
- **Relieved:** "Sessions are currently doing double duty as a to-do database… Closing a session feels lossy, so ~9 accumulate (…on a machine that had exhausted its 20 GB of swap)."
- **Exposed:** nothing recorded what a workstream covers (routing, 2026-08-20); no archive control in the app.
- **Evidence:** 155 registry records against 7 live worktrees; 181 distinct `Workstream:` trailer values on main; 852 issues name an owning workstream.
- **Outcome:** In use; the redesign issue closed as implemented. *Judgment:* this split is what made automated culling safe.

### Workstream routing and briefed resume
Launch records carry a description; `list --json` tells a launching agent whether to resume an existing stream.
- **Since:** 2026-08-20 cd8c97889, a0a84452c.
- **Relieved:** "I think there's a workstream that should own this, but I'm not sure."
- **Evidence:** 548 merges over 191 names, about 2.9 landings per name; 8 Claude sessions ran `resume` in 60 days.
- **Outcome:** Closed the issue. *Judgment:* repeated landings per name show streams are reused.

### Tri-state liveness, fail closed
One guard returns `none`, `launching`, `live`, or `unknown`; only `none` authorizes a destructive action, and `--force` never overrides it.
- **Since:** 2026-08-04 ad6acad97, 2d22bc184 ("Fail closed when git can't report worktree state"); shared guard 2026-08-08 8f42c1f53.
- **Relieved:** `issues/closed/bugs/2026-08-04-sweep-live-agent-guard-fails-open.md`, found by cross-model review: the sweep failed open when `ps`/`lsof` could not answer.
- **Exposed:** nested reviewers could delete their parent's tree; fixed with self-ancestor exclusion.
- **Evidence:** cleanup log 2026-08-30 to 10-09: 793 sweep skips for a live agent, 0 for unknown, 2 for launching.
- **Outcome:** No closed issue after 2026-08-24 reports a wrongly deleted live worktree (*judgment*, from issue titles).

### Teardown and culling sweeps
One teardown removes worktrees that are merged, clean, unpinned, and agent-free, triggered at session end, session start, Codex exit, and post-merge.
- **Since:** 2026-05-26 6babebd70; `sweep` 2026-05-27 0e2bd0155; post-merge auto-sweep 2026-07-11 f91df58e4; detached worker 2026-08-24 03c107933.
- **Exposed:** the sweep was killed with the exiting session's process group (15 of 109 session-end sweeps lost); exhibits, comments and private worktrees outliving their tree.
- **Evidence:** 40 days of log: 184 auto-sweeps; 83 session-end removals plus 61 sweep removals; skips: 1,017 unmerged, 238 pinned, 793 live.
- **Outcome:** About 144 worktrees removed with no human step in 40 days. *Judgment:* the same few unmerged trees are skipped ~120 times each; the sweep reports them but cannot decide for the human.

### The seam: lifecycle out of hooks into a CLI
Create, remove and teardown moved from Claude Code hook scripts into `bin/workstreams` and `bin/lib/worktree-*.sh`, so hooks, the launcher, Codex, schedules and the web app are thin clients.
- **Since:** 2026-08-04 a9dcb4029, ad6acad97; 2026-08-08 6d671837b, 505615b66.
- **Relieved:** Codex "had to impersonate Claude Code's hook JSON" to reach the lifecycle; a web button could not either.
- **Exposed:** generated guidance mirrors to keep in sync; a sweep that ran on every Codex launch (fixed 2026-08-10 ef7ab4fff).
- **Evidence:** 103 Codex-exit teardowns in 40 days; the dashboard shells out to the same CLI.
- **Outcome:** Codex became a routine second engine; scheduled workstreams (08-24) and GLM launches reuse the same path.

### Dev dashboard (workstreams app)
A resident React and tRPC app listing workstreams with git, router, liveness and schedule state, plus issues, plans, testing, asks, alerts, and a recency feed.
- **Where:** `workstreams-app/` (199 files, 27,241 lines, 127 commits).
- **Since:** HTML index 2026-05-26 010dc2e33; issue browser 2026-07-10 12c9a1137; app 2026-08-13 f64b90215, 7b49cb0df; recency feed 2026-08-22 31bf12b13.
- **Relieved:** "There's no way to see what's outstanding; the list exists only as terminal tabs."
- **Exposed:** one bad row blanked the issues page (rows now parse independently).
- **Outcome:** The human's single view across streams; hosts exhibits, comments, next actions, alerts, and since 2026-09-02 the router itself.

### Document comments (`bin/comments`)
The human selects text in a rendered doc and leaves a typed or spoken comment, stored outside git, routed to a workstream, read and cleared at pickup.
- **Since:** 2026-08-22 31545f15f.
- **Relieved:** disagreeing with one paragraph of an agent-written plan without re-explaining it in chat.
- **Exposed:** comment namespaces outliving a culled workstream (open issue).
- **Evidence:** `bin/comments list` ran in 65 of 276 Claude sessions; `clear` in 1; store empty today.
- **Outcome:** The pickup check is routine. *Judgment:* either few comments in the window or clearing happens elsewhere.

### Exhibits (`bin/exhibits`)
An agent publishes a labeled page (screenshots, a decision page, a small app) to a per-workstream store that survives culls, with exactly one ask: decide, confirm, react, or fyi.
- **Where:** `bin/exhibits`, `workstreams-app/docs/exhibits.md`, store `~/src/workstream-exhibits/`, ask queue at `/workstreams/asks`.
- **Since:** 2026-08-15 3e3ae0def, 10ad95b6a, 2b15809ce.
- **Relieved:** "Chat is the wrong medium for much of what agents produce: it is ephemeral, text-first, and feedback only lands if the developer is present at that moment."
- **Evidence:** 128 exhibits (fyi 65, react 35, confirm 20, decide 8); 12 in August, 85 in September, 31 in October; 4 have an in-app disposition.
- **Outcome:** Display side is used; the answer loop through the page is thin (4 of 128). *Judgment:* answers return through chat.

### Finish: skill, headless agent, preflight, verify, land
When the human says finish, a headless subagent merges main in, runs the checks a preflight decision sheet names, reconciles plan docs, closes resolved issues, and lands with `--no-ff`; it stops BLOCKED on anything needing a human.
- **Where:** `.claude/skills/finish/SKILL.md`, `.claude/agents/finish.md`, `bin/finish-preflight`, `bin/finish-verify`, `bin/land`.
- **Since:** 2026-05-26 6babebd70; subagent 2026-07-03 42d39875c; `bin/land` 2026-08-08 9786e4895; `--no-ff` 2026-08-24 a0093e2ba; scripts 2026-08-25 803ff20fa.
- **Relieved:** landing many branches by hand with merge and test churn in the main thread.
- **Exposed:** the agent file grew to 624 lines by 2026-08-08 before mechanics moved to scripts (165 lines by 08-30); full suites under parallel load timed out.
- **Evidence:** the most-typed skill (131 Claude and 110 Codex sessions in 120 days); 520 landings since `--no-ff`; `land`/preflight refused 53/20 times in 60 days, by design.
- **Outcome:** The landing path for every merge since late August. Agent file 175 → 624 → 165 lines is the clearest "mechanics into scripts" example.

### Commit provenance trailers
Hooks stamp `Workstream:` and, when exactly one plan matches, `Plan:` on worktree commits; `Issue:` must name an existing public issue or the commit is refused.
- **Where:** `bin/commit-provenance.ts`, `.husky/prepare-commit-msg`, `.husky/commit-msg`, `bin/docs/commit-guards.md`.
- **Since:** 2026-08-24 685bc1d48, e00c5dcca. `Issue:` trailers were written by hand from 2026-08-01.
- **Relieved:** "a workstream is a name on a branch; nothing records what it covers."
- **Evidence:** on main: 2,288 commits with `Workstream:` (180 names), 980 with `Plan:` (92 plans), 358 with `Issue:`; 81% of non-merge commits since introduction carry a workstream.
- **Outcome:** Consumed mostly by tooling and retrospectives, including this inventory (3 ad hoc queries in 60 days).

### Manual-testing pins and `confirm-tested`
`needs: [manual-testing]` on a landed issue pins the workstream's test box against culling until the human confirms.
- **Since:** tag 2026-07-19 7bf895a48; workflow and pins 2026-08-09 fd1299085, c462271d9.
- **Relieved:** "Merged + needs verification: the worktree has nothing unique; you only need a record of what to check."
- **Exposed:** pinned trees accumulate while waiting (238 pin skips in 40 days).
- **Evidence:** 68 issues have carried the tag; 25 open now.
- **Outcome:** In use. Whether clears come from `confirm-tested` or hand edits was not verifiable.

### Private-issues shadow repo (mechanism only)
A separate gitignored repository mounted by symlink, with a private worktree per public worktree; public files never link in.
- **Since:** 2026-08-01 1f9a650cb.
- **Relieved:** the repo is source-available; real-box findings needed a safe place in the same workflow.
- **Evidence:** 79 private worktrees removed at session end in 40 days. Contents not read.

### `/dev/` pages, doc browser, `dev/tools.json`
Tracked HTML and rendered Markdown under `dev/` are served without cold-starting the worktree; a doc browser covers every `.md` in the repo.
- **Since:** 2026-06-23 0c180c857; tool cards 2026-07-24 4f7c88a68; sandbox CSP removed 2026-08-19 30400a662.
- **Relieved:** reviewing a worktree's docs and visualizations without starting its servers.
- **Exposed:** scripted apps needed a separate origin, which became exhibits.
- **Outcome:** This document is served this way.

### Path-scoped commits for agents sharing a worktree
Agents in one worktree commit with explicit paths and work in different packages, because a bare commit can capture another agent's staging.
- **Since:** 2026-07-09 f01f36084 (closed `issues/closed/bugs/2026-07-06-parallel-agent-git-commit-race.md`, ~31 stage-then-commit sites swept).
- **Outcome:** Still the rule. *Judgment:* intra-worktree parallelism stayed a secondary mode.

### Machine-wide test semaphore and host-pressure gate
Whole-tree test, lint and typecheck runs take one of two slots; the scheduled suite defers when the host is swapping.
- **Where:** `bin/test-locks.ts`, `bin/with-slot.ts`, `bin/host-pressure.ts`.
- **Since:** 2026-08-25 40411eb35, 6e565471b; 2026-09-11 b47af3add.
- **Relieved:** "six concurrent whole-tree eslint runs took 29–51 minutes each against a solo minute"; load average 40 with 11 concurrent test processes.
- **Exposed:** "load looked quiet while 18 GB of swap was in use"; fixed timeout budgets still fail under load (open).
- **Outcome:** *Judgment:* the parallelism ceiling moved from git conflicts to machine memory; the swap incident recurs (20 GB on 08-08, 18 GB on 09-11).

### Router retry and failure classification
A worktree that fails to start under host load is retried (2s/8s/30s); other failures park at once.
- **Since:** 2026-09-15 2a8d3fa75. **Outcome:** in use, not measured.

### CODING_FEEDBACK notes
Agents write a four-question note at plan-reviewed, implemented, review-adjudicated, and landed checkpoints, outside git, for the retrospective schedule.
- **Since:** 2026-10-07 b8fc4b1aa. **Evidence:** 54 notes across 12 workstreams in two days. **Outcome:** too new.

---

## 2. Instructions and prompting

### Package CLAUDE.md for the main system
The oldest always-loaded instruction file: what the system is, how to test, where code lives, the rules.
- **Where:** `beebox/AGENTS.md` (71 lines; named CLAUDE.md until 2026-10-09) plus an `@`-import of `beebox/code-style.md` (118 lines).
- **Since:** 2026-01-30 e5cc933ad (217 lines). Cuts: 2026-03-03 66a45f868 (218 → 118); 2026-07-04 eef3b77a6 (mechanism to colocated docs); 2026-09-12 d7b47dfde (184 → 67).
- **Relieved:** each session rediscovering layout, test commands and card format.
- **Exposed:** regrowth, one rule per commit: 114 (03-06) → 184 (09-05). Each cut moved text to another owner, which created the pointer-rot problem doc-check now checks.
- **Evidence:** 110 commits; full line series in the instructions report.
- **Outcome:** Two deep cuts, each followed by regrowth until the September rewrite added routing by owner; 67–71 lines for four weeks since. *Judgment:* manual cuts did not hold; whether routing holds is not yet known.

### Self-improvement meta-instruction
A section telling the agent that a correction exposing missing durable guidance becomes a short rule at the narrowest accurate owner.
- **Since:** 2026-03-06 bedf968cf; compressed to two lines 2026-05-05 d6434b37e.
- **Relieved:** corrections lost between sessions.
- **Exposed:** it drives the growth above: every correction becomes a rule in the always-loaded file. Counterweights came later: owner routing, budgets, and the retrospective's recurrence threshold.
- **Outcome:** Still present. *Judgment:* responsible for much of the 114 → 184 growth.

### Nested CLAUDE.md files
Area files loaded only when the agent works in that directory (services, connectors, reactor, dev, hub, chat UI, deploy, architecture).
- **Since:** 2026-03-03 55a8b97e7, the same day as the first condense.
- **Relieved:** subsystem rules no longer sit in the package file. **Exposed:** rules invisible outside the directory; duplication between levels found in the May review pass.
- **Outcome:** All 8 still exist; the mechanism the March and July cuts relied on.

### Root CLAUDE.md and the full layering
A workspace file for worktrees, router, issues, privacy, landing and the autonomy vocabulary; one CLAUDE.md per package or area under it.
- **Since:** root 2026-05-26 9c5411149 (65 words). Cuts: 2026-07-04 eef3b77a6 (1,393 → 807 words, router internals to `bin/AGENTS.md`); 2026-09-12 c8c728285 (2,242 → 850).
- **Evidence:** 20 files, 2,284 lines; 462 commits touched a CLAUDE.md path. Largest now: `issues/AGENTS.md` 303, `site/CLAUDE.md` 284, `bin/AGENTS.md` 261.
- **Outcome:** Root regrew 850 → 1,277 words in four weeks after the second cut. *Judgment:* layering moved size out of the root but did not reduce total guidance; the four largest files each exceed the root. No dev-side CLAUDE.md has an enforced budget.

### Prompt calibration (the 2026-09-12 rewrite)
A planned pass that rewrote the root, the package file and every skill description by deciding each item's purpose, necessity, compact form and destination, then tested routing on four models.
- **Where:** `beebox/docs/implemented-plans/prompt-calibration.md`, `beebox/docs/reports/prompt-calibration-pilot-2026-09-12.md`.
- **Since:** 2026-09-12 6fa206288, c8c728285, d7b47dfde, 880f9d4d0.
- **Relieved:** size and persuasion in the always-loaded layer ("remove attempts to convince a capable reader").
- **Exposed:** models copied invented details from a worked briefing example (replaced with fill-in fields); no measured change in skill activation.
- **Evidence:** root 2,242 → 850 words; package 184 → 67 lines; SKILL.md total 3,766 → 3,092 lines; pilot 4 models × 12 routing cases + 5 authority scenarios, all boundaries held.
- **Outcome:** The largest single instruction cut in the history; the only multi-model test of the instructions on record.

### "How much to do" ladder (discuss / plan / do / land)
Four named authorization levels; the human's wording sets the ceiling; unclear takes the lowest.
- **Since:** issue tag `verify-without-me` 2026-08-14 722933909; ladder in root 2026-10-08 8ee2fe5bd, with a dev knowledge audit for "go ahead".
- **Relieved:** ambiguous approvals: "go ahead / do it" in 86 Claude and 43 Codex sessions over 120 days.
- **Outcome:** One day old. Collects terms that already existed into one rule.

### Codex mirrors: generated AGENTS.md, skill links, agent TOML
A generator copies every tracked CLAUDE.md verbatim to a gitignored AGENTS.md, links skills into `.agents/skills/`, and writes `.codex/agents/*.toml` from `.claude/agents/*.md`.
- **Where:** `bin/generate-codex-mirrors.ts` (was `generate-agents-md.ts` until 2026-10-09), `bin/generate-codex-agents.ts`, `bin/codex-preamble.ts`, `bin/lib/codex-skill-links.ts`.
- **Since:** a committed find-replace copy was removed 2026-05-26 872450eb1 ("a stale partial duplicate"); generator 2026-08-04 a9dcb4029; agent mirrors 2026-09-16 0d65810d0; stale-dir pruning 2026-10-07 6657f44d1.
- **Relieved:** Codex sessions had no guidance; under Codex the lint hook had exited 127 on every edit; Codex `/finish` ran on the default model.
- **Exposed:** drift in the main checkout (three stale real directories); Claude-only frontmatter ignored.
- **Evidence:** 854 Codex sessions in 120 days receive the generated guidance.
- **Outcome:** The verbatim-copy design survived where the first attempt rotted, and then became unnecessary: on 2026-10-09 (3ea06edcf, workstream agents-md) all 20 tracked CLAUDE.md files were renamed to AGENTS.md, which Claude Code 2.1.277+ and Codex both read natively. The generator no longer writes instruction mirrors; it keeps the skill links, agent TOMLs and hooks file, and the Codex preamble moved to `bin/codex-preamble.ts` as developer instructions. doc-check now fails on any CLAUDE.md in the repo, because one stray file makes Claude Code skip every AGENTS.md. Three designs for one need in five months: a committed copy, a generated copy, one file both agents read.

### Skills system
On-demand instruction files the model loads when a description matches, or the human invokes by name.
- **Where:** `.claude/skills/*/SKILL.md`, 21 now.
- **Since:** 2026-05-26 6babebd70 (finish), cf9693e81 (browse). Review passes 2026-08-03 e52071dfb, 2026-09-12 6fa206288, 2026-10-07 19e261eb9 / 04bae7e91 / 6657f44d1.
- **Relieved:** repeatable workflows no longer sit in always-loaded files or get re-explained.
- **Exposed:** triggering was never checked (closed issues 2026-07-30); staleness and contradiction (a skill contradicted a code-style decision); the listing budget drops rarely used descriptions first.
- **Evidence:** 31 skills ever, 10 retired, 21 live; peak 24 skills / 3,766 lines (09-12), now 1,841. Births: May 4, Jun 7, Jul 5, Aug 10, Sep 1, Oct 3. Top by sessions in 120 days: finish 290, cross-model 268, browse 128, bbx-plan 117, doctest 86, issues 85.
- **Outcome:** The skills that held are workflow steps (finish, cross-model, plan, browse, issues). Most craft skills (debug, frontend, codehealth, guide-testing) were retired into docs on 2026-10-07. The human types almost only `finish`; agents reach the rest by description.

### Skill descriptions as triggers
Descriptions state when to load (symptoms, exclusions), not a summary of the workflow.
- **Since:** issue 2026-07-30; sharpened 2026-08-03 e52071dfb; shortened 2026-09-12 6fa206288.
- **Relieved:** skills that never fired ("investigate-or-debug instructions appear in 31 sessions and the skill does not fire").
- **Outcome:** Most skills do fire from descriptions (cross-model 169 agent invocations, never typed); the weak ones were retired rather than re-described. Activation has never been measured directly (open trigger-eval issue).

### Skills review with transcript measurement
A script counts skill use across Claude and Codex transcripts; a review used it to retire, merge and shrink.
- **Where:** `bin/skill-usage.ts`, `dev/skills-review-2026-10.md`.
- **Since:** 2026-10-07 b4e7e7005, ea52a35b8.
- **Evidence:** 60-day scope: 228 Claude + 1,699 subagent transcripts, 492 Codex + 287 rollouts.
- **Outcome:** Acted on within a day: 6 skills retired, cross-model and launch skills halved, deploy-status added from a "22 sessions ask about deploy state" pattern, a foreground-sleep rule from 104 sleep-blocked sessions, skill-lint added, 85 stale doc references fixed (6657f44d1). SKILL.md lines 3,126 → 1,841.

### Skill lint (pre-commit)
Frontmatter, description length, body under 400 lines, reference depth, bare sigils, backticked paths.
- **Since:** 2026-10-07 6657f44d1. **Outcome:** two days old; enforces in code what the review did by hand.

### Mechanics into scripts; "agent and skill files only ever grow unless pruned"
Procedure prose is replaced by a script the agent runs; anyone touching an agent or skill file must remove more than they add.
- **Since:** rule 2026-10-07 059746c23; precursor 2026-08-26 4b7d18f65 ("cb-plan: 517 lines become a 100-line skill and a template").
- **Evidence:** cross-model 377 → 150 lines; launch 218 → 91; finish agent 624 → 165.
- **Outcome:** Most of the 3,126 → 1,841 drop. Whether the rule holds against regrowth is untested.

### Subagent definitions (`.claude/agents`)
One named subagent, `finish`, so landing runs headless; mirrored to Codex as TOML.
- **Since:** 2026-07-03 42d39875c. **Evidence:** 56 worktree merges before it, 659 since.
- **Exposed:** policy split between skill and agent (flake handling said two things).

### Path-scoped rules (`.claude/rules`)
One tracked rule file, for `**/*.doctest.md`.
- **Since:** 2026-03-03 257c2be03. **Outcome:** not extended elsewhere in the dev repo; nested CLAUDE.md is used instead.

### Briefing discipline for launched sessions
A launching agent writes context, decisions, constraints and exact authorization; the launcher wraps it in `<agent-continuation>` so the receiver knows a sibling wrote it.
- **Since:** 2026-05-27 275a29ffd, adff57ace; authorization rules 2026-09-12 0aea01bd2; memory folded in 2026-10-07 2505aba8c.
- **Relieved:** a new session reading "we discussed" as the human's voice and answering the prior agent.
- **Exposed:** example contamination (pilot); stale paths in briefings (old `callback-*` paths in 118 Claude and 106 Codex sessions).
- **Outcome:** Wrapper unchanged in concept since May; this very session arrived through it.

### Sigil rule for skill names in briefings
Briefings name skills in words, never `/finish` or `$finish`; the launcher refuses a briefing containing one.
- **Since:** guidance 2026-09-20 69875694f; refusal 2026-10-07 6657f44d1 (`bin/briefing-sigils.ts`).
- **Relieved:** a sigil as the first message starts the skill in the receiving session.
- **Evidence:** 83 sessions used a bare sigil after the guidance existed.
- **Outcome:** Prose did not stop it; a check did. Post-enforcement data is two days old.

### Delegation guidance ("lightest capable worker")
Delegate without asking; small models for bounded searches, mid-tier for most implementation, strongest for hard reasoning; full briefings; long commands in the foreground.
- **Since:** 2026-07-04 6f1aad752; Fable-specific 2026-07-09 29d83450b; search subagents 2026-08-31 2da898a52; current wording 2026-09-12 c8c728285.
- **Evidence:** 2,055 subagent transcripts against 230 top-level Claude sessions in 120 days, about 9 per session.
- **Outcome:** Routine. The foreground rule came from a scheduled session that backgrounded a suite and never returned (2026-10-06 a8f45b4b8).

### Memory: "memory belongs in docs"
Durable lessons go to tracked docs, skills or CLAUDE.md; per-machine auto-memory holds only machine and boxholder facts.
- **Since:** concern 2026-03-04; promotion passes 2026-04-17 00f05941a and 2026-10-07 2505aba8c / 059746c23.
- **Relieved:** "Memory is per-machine and invisible to Codex, subagents, and reviewers."
- **Exposed:** stale memories send agents to old paths; the tracked `.claude/memory/` directory is a frozen archive that could mislead a reader.
- **Outcome:** Two promotion passes; the October one also fixed finish firing on "checkpoint".

### Style rules: STE, no Claude-isms, altitude, word budgets
Issue and plan bodies in Simplified Technical English; no stock model phrases or the "not X, but Y" construction; a rarely used thing gets a reference entry and one pointer; explicit size targets.
- **Since:** STE 2026-07-30 8a3a00bb1; antithesis note 2026-07-05; "Altitude matches use" tracked 2026-10-07 2505aba8c; box-guide budget 2026-09-26, skill size lint 2026-10-07.
- **Evidence:** on 2026-09-16 tracked docs held "the real" 362 lines, "genuinely" 296, "not just" 290, "load-bearing" 145 (open cleanup issue).
- **Outcome:** STE and altitude are in tracked guidance; the Claude-ism rule lives only in user memory and open issues, so Codex and subagents do not see it. Budgets exist for skills and the box guide, not for dev CLAUDE.md files.

### No-disable lint guardrail
Agents may not disable or weaken a lint rule to pass; one justified `eslint-disable-next-line <rule> -- <reason>` for a narrow false positive is the only exception.
- **Since:** 2026-05-31 8965f1d36, the day the suppression ratchet reached zero.
- **Evidence:** 190 disables in tracked TS, 172 in the justified form; ESLint errors recur in 32 Claude and 69 Codex sessions over 120 days.
- **Outcome:** Kept through both rewrites; no slipped weakening found (not exhaustively searched).

### Noise-as-bug rule
Unsolicited tool output is a bug to fix because it costs agent context every time.
- **Since:** 2026-05-26 085a23011. **Outcome:** shaped the silent-on-success design of doc-check, schedule lint, path-leak, and the agent-first TAP output (2026-06-09 3aecb4c05).

### Single-line guardrails after observed failures
Never search the whole home directory (2026-09-26 7768f81ff, macOS privacy prompts); foreground `sleep` is blocked (2026-10-07, 104 sessions hit it); boxes live outside the repo (2026-05-26).
- **Outcome:** Each is a one-line response to a measured or repeated failure.

### Glossary and stack-decisions
One file of proper nouns with a user-facing line each (2026-05-21 dbfc2335e, 22 commits); a record of which tools won and why (2026-03-02 09fc3ce36, frozen as a dated report 2026-09-12 dcc1778a7 after drifting from code).
- **Outcome:** Glossary in use; stack-decisions abandoned as a live doc.

### doc-check and doc-lifecycle-check
A Markdown commit fails on a broken reference, a live-area orphan, a duplicate issue basename, or a backticked repo path that does not resolve; plan status must match its directory.
- **Where:** `beebox/src/dev/doc-check/`, `bin/doc-lifecycle-check.ts`, `.husky/pre-commit`.
- **Since:** doc graph 2026-03-04 1a45afb09; enforcement 2026-07-04 efad24c61 (ended `--no-verify` on docs commits); lifecycle 2026-09-13 12d776dd2; path checking 2026-10-07 6657f44d1.
- **Relieved:** link rot as files moved, pointer rot after every slimming pass.
- **Evidence:** 96 commits mention doc-check; 85 stale references fixed when path checking landed; the doc graph lists 510 documents, 98 orphans (mostly shipped plans, exempt by design).
- **Outcome:** Runs on every `.md` commit; the number of commits it has blocked is not recorded.

---

## 3. Quality gates and verification

### Doctest framework
Markdown files whose fenced TypeScript examples run as TAP tests; the default test form.
- **Where:** `agent-doctest/`, `.claude/skills/doctest/SKILL.md`, `beebox/docs/testing/doctests.md`.
- **Since:** 2026-03-03 aa13e9c98; package 2026-03-09 1739e4c9e; agent-first TAP output 2026-06-09 3aecb4c05 ("the consumers of test runs are agents reading through a pipe"); usability pass 2026-09-28 46a02a09f.
- **Relieved:** tests an agent can read and write without a harness; "docs that can't go stale".
- **Exposed:** volume and run time; the full suite became too slow and too often red for reasons unrelated to the branch; flakes from fixed sleeps.
- **Evidence:** 1,035 files, 172k lines (950 in beebox) against 142 `*.test.ts`; net growth 59 (Apr 1) → 413 (Aug 1) → 1,035; ledger: 1,915 runs, 1,823 files seen, 717 files have failed at least once.
- **Outcome:** The base every later verification layer sits on. Its cost is the flake load; a usability review changed failure output to name Markdown lines and give paste-ready suggestions.

### Change-based test selection (`pnpm test:changed`)
Runs only tests whose import graph reaches the branch's changed paths; unaccounted paths run everything.
- **Where:** `bin/test-select.ts`, `beebox/docs/plans/change-based-test-selection.md`.
- **Since:** design 2026-08-08 4f9001b62; graph 2026-08-09 4f8ad1a26; selector 2026-08-25 088046895; spawn edges 2026-10-06 01f482e9d.
- **Relieved:** full runs on every iteration and at merge ("full runs were mostly red for reasons the branch did not cause").
- **Exposed:** only 25% of branches were fully accounted for against a 50% bar; "running 484 tests for them is not verification, it is ritual". Main-branch verification moved to the hourly suite.
- **Evidence:** 1,217 selected runs since 08-30, 414 fully accounted (34%). One recorded catch: 2026-09-27 69414cfbe.
- **Outcome:** The documented iteration command. *Judgment:* its main product was the measurement that most changes touch untested code, which redirected effort to the ledger and the scheduled suite.

### Test ledger
One JSONL record per run (green included), classifying failures as attached, unimplicated, or flaky.
- **Since:** 2026-08-09 d74af7a14; frontend and bin results 2026-10-06 bf5cda987.
- **Relieved:** "which tests have ever failed in a way that mattered?" had no answer.
- **Exposed:** the flake load became measurable (49 files, open issue 2026-10-08).
- **Evidence:** 1,915 runs; worst file 124 failures in 398 runs, 75 unimplicated.
- **Outcome:** An instrument with no gate; its numbers justify each later flake-policy change and define "flake" for `finish-verify`.

### Careful tier and flake quarantine
A hand-curated list of timing-sensitive files excluded from selected runs and run alone in the batched full run.
- **Since:** 2026-08-25 80954db6a. **Evidence:** 6 files, all at 0 failures in their last 40 runs.
- **Outcome:** Stopped flakes blocking landings but did not reduce the count; being replaced by a fix-or-delete pass.

### Flake policy ("never rerun to chase green")
A failing file is rerun once alone; passing alone at the same content hash is a named flake; failing again blocks; no suite rerun.
- **Since:** 2026-08-25 803ff20fa. **Evidence:** 90 commits mention "flake", 56 of them in August.
- **Exposed:** drift between the doctest skill and the finish agent on what to do with a flake (review finding 5).
- **Outcome:** Moved flake decisions from agent discretion to a scripted single rerun.

### Hourly full suite with bisection
A scheduled job runs the whole suite on main when anything landed, bisects a red batch over landings, files one issue per blamed landing, and alerts.
- **Where:** `schedules/full-suite/`, `bin/host-pressure.ts`.
- **Since:** 2026-08-25 b88d84861; report-loop fix 2026-08-27 65cad1b48; load gating 2026-09-02, 09-11, 10-06.
- **Relieved:** removing full runs from merge left main untested; "a failure that reaches main surfaces here within the hour." Run-only by design: "an agent session would only add cost and a place to be creative."
- **Exposed:** it blamed its own report commits (twelve hourly duplicates); host load faked reds; flake volume.
- **Evidence:** 871 runs; 29 `full-suite-red` issues (11 fixed, 16 superseded, 1 wontfix, 1 open); 38 issues trace to it, 35 closed.
- **Outcome:** Caught 11 real regressions that were fixed. Made "no full run at merge" safe enough to keep. Most early alerts were duplicates or load artifacts.

### `bin/finish-verify` and preflight
A script runs exactly the checks the decision sheet names and prints a verdict.
- **Since:** 2026-08-25 803ff20fa. **Outcome:** verification choices moved from agent text into a script.

### Smoke tier and weekly smoke review
Before a merge touching deployed paths, boots a real box through the router and walks it in a browser; no model turns; every step logged.
- **Where:** `bin/smoke*.ts`, `beebox/docs/testing/smoke.md`, `schedules/smoke-review/`.
- **Since:** 2026-08-26 1e8cfe8c4; false greens closed by cross-model review the same day 92c74000e.
- **Relieved:** "Three escapes on 2026-08-25/26 passed typecheck, lint and their selected tests while the app was broken: the code was right and the state was wrong."
- **Exposed:** tier rot (weekly review); 63 runs lost at the rename; scheduled and direct landings skip it (open issue, three windows of evidence).
- **Evidence:** 517 runs, 416 green, 101 red, median 59 s; 10 issues trace to it.
- **Outcome:** Required by finish for code landings.

### Browser tours and tour-check
Scripted walks that capture screenshots, accessibility snapshots and axe reports at two viewports; a weekly session runs them and edits tours the app outgrew.
- **Since:** 2026-05-28 9a600875c; formalized 2026-07-10 88bb0526c; weekly 2026-08-26 2c9d75eed.
- **Relieved:** "Three of five tours had been silently failing for months; nobody ran them, so nobody knew."
- **Evidence:** 10 tour files; 7 weekly runs, 3 of which hit the 1-hour limit before it was raised; 9 issues trace to it.
- **Outcome:** Running weekly; example find 2026-09-02 aaa69fe1d.

### Scenario testing (retired)
Scripted end-to-end runs of a whole box with stubbed fetch.
- **Since:** 2026-02-21 69e0ed376; deleted 2026-09-16 741dca4cb ("No scenario files exist anywhere in the repo").
- **Outcome:** Abandoned; the idea continues as field tests (19 issues trace to those).

### Card validation hooks (warn on write, block on commit)
A PostToolUse hook validates cards after agent edits; a box pre-commit blocks invalid cards.
- **Since:** 2026-05-23 06eea48c6. **Outcome:** in every box; the box-side twin of the dev lint hook.

### personal-vibe-check lint preset and PostToolUse lint hook
A shared, versioned ESLint, Prettier, strict tsconfig, knip, oxlint, madge and husky preset; after every agent edit ESLint runs on the file and failures feed back.
- **Where:** `personal-vibe-check/` (preset 834 lines, ~216 rule entries), `.claude/settings.json`.
- **Since:** 2026-02-13 893ad26ff; hook 2026-02-17 0a77a4040; TypeScript conversion 2026-08-25 ab4738447.
- **Relieved:** per-project lint drift; lint errors found only at commit.
- **Exposed:** the integration silently turned 18 rules off (led to the ratchet); per-edit noise during multi-file edits ("finish coordinated edits before reacting").
- **Outcome:** The earliest agent-facing gate in the repo; the baseline the later guardrails defend.

### ESLint suppression ratchet (retired)
Existing violations were recorded so rules could be enforced for new code and burned down.
- **Since:** 2026-05-30 b53159500 (1,000 violations across 158 files); zero and deleted 2026-05-31 8965f1d36.
- **Outcome:** 1,000 → 0 in about two days; the lasting artifact is the no-disable rule.

### Lint economics: `lint:changed`, caches, `with-slot`
Lint only what the change implicates; whole-tree runs take a semaphore slot.
- **Since:** 2026-08-25 6e565471b; three gaps closed by cross-model review fe4a55696.
- **Relieved:** "Warm runs go 32–43 s to 4.4 s." **Outcome:** the documented iteration command.

### Supplemental lint and knip sweeps (weekly schedules)
Baseline-diffed oxlint, circular-dependency and dead-code findings; the sessions land their own green fixes.
- **Since:** knip in preset 2026-02-13; schedule 2026-08-24 56fae9331; supplemental 2026-08-29 ccdfe5c98; self-landing 2026-09-12.
- **Evidence:** backlog 342 → 4 before scheduling; knip-sweep 19 commits, supplemental-lint 10; 21 standing oxlint warnings cleared 2026-10-06.
- **Outcome:** Running; one flake blocked a knip landing (filed 2026-10-07).

### Layout check
A scanner enforcing source file-layout rules at zero findings per package root, in pre-commit.
- **Since:** 2026-09-27 228b71fb2 after the layout moves (8 commits of 300–740 files).
- **Exposed:** path moves broke runtime path computations. **Outcome:** active; no recorded catches yet.

### Pre-commit guards: path leak, personal blocklist, retired product name, staged security
Block a home path in tracked files; block staged additions matching a gitignored per-developer blocklist (fail closed); block the old product name; private keys, merge markers, shellcheck.
- **Since:** 2026-07-05 6a4fa15a0, f6344efb3 (ahead of going source-available); 2026-08-30 dab834811; 2026-08-29 6deee0f14.
- **Outcome:** Active on every commit; blocked-commit counts are not recorded.

### Contract tripwires: mobile contract, scan-upload version, clerk snapshot
Staging a contract anchor without updating the contract doc blocks unless the message carries `Contract-Unchanged:`; a hand-bumped scan contract version; a regenerated clerk contract snapshot that must match.
- **Since:** 2026-07-17 e577200a7; 2026-09-14; 2026-07-12 27720149d.
- **Evidence:** 101 commits carry `Contract-Unchanged:` against 43 contract-doc edits; the scan version has never been bumped.
- **Outcome:** *Judgment:* most trips are declared non-changes; whether any caught real drift is not recorded.

### Cross-model review
Plans and diffs beyond a small fix are reviewed by the other model family, and findings are adjudicated.
- **Where:** `.claude/skills/cross-model/SKILL.md`, `bin/cross-model-run`.
- **Since:** 2026-06-04 b3bf67809 (Codex reviewing Claude); bidirectional 2026-08-04 aae37764a; runner to script 2026-10-07 6657f44d1.
- **Relieved:** "A model can't catch the blind spots it shares with itself."
- **Exposed:** skill size (377 → 150 lines); enforcement is guidance only (a pre-land marker check was proposed).
- **Evidence:** 216 commits mention it (Jun 10, Jul 26, Aug 110, Sep 50, Oct 20); 134 commits pair a detection verb with cross-model or Codex in one sentence; 55 issues trace to a review, 41 closed; 140 Claude sessions and 32 Codex sessions in 60 days.
- **Outcome:** The quality technique with the most recorded catches: eight defects in the test-economics branch, two false greens in the smoke tier, three gaps in lint economics, the fail-open liveness guard, four defects each in add-box and admin backup, and reviews that flipped the test-selection mechanism twice. It also reviewed most of the other gates listed here.

### Security report skill and cross-box leak scan
A committed rubric from which an agent regenerates a structured security report after security-relevant changes; a weekly static sweep of the HTTP surface and a read-only host audit.
- **Since:** 2026-08-07 db7901c5e; scan 2026-09-04 188f3c493.
- **Evidence:** 43 commits on the report; 18 issues trace to security work; scan 5 runs, 5 commits.
- **Outcome:** "A document an agent maintains, not a one-time audit"; second regeneration cycle ran.

### Husky hook set
One root hook set shared by all worktrees, dispatching per-package checks by staged path; parallel lint-staged and typecheck; docs-only fast path.
- **Since:** 2026-05-26 085a23011 ("each subproject lost its own .git, so those husky setups silently stopped working").
- **Exposed:** cross-package breakage escaping per-package gates (a rename took `bin/issues` and a schedule down); lint-staged's stash clobbering concurrent agents (now `--no-stash`).
- **Outcome:** The pre-commit hook is where most gates attached; its comments record each escape that added a branch.

### Schedule lint and lint-script-coverage
`bin/schedules lint` validates schedule definitions in pre-commit ("a schedule that fails lint fails at 03:00 on a Sunday with nobody watching"); a test asserts the root lint script still covers `bin/`.
- **Since:** 2026-08-24 703f3a8bb; 2026-08-13 3a561ddbe. **Outcome:** no invalid schedule has reached the tick.

---

## 4. Knowing what agents know

### Knowledge audits (box surface)
A YAML suite of prompts run through a real box agent; each entry checks the answer and the tool use to test what the agent learned from loaded guidance.
- **Where:** `beebox/src/dev/knowledge-audit.ts`, `beebox/src/dev/knowledge-audits.yaml`, `beebox/docs/testing/knowledge-audits.md`, `.claude/skills/knowledge-audit/SKILL.md`.
- **Since:** 2026-02-23 2c69ec73e; full rerun report 2026-07-03; web-lookup checks 2026-09-26 eef862615.
- **Relieved:** no way to tell whether a guidance change reached box agents; "generated agent guide taught unimplemented gates" (2026-06-21 e49de30e2).
- **Exposed:** audits go stale when the right answer changes (31 stale after one overhaul); the runner resets the box, so a guard refuses dirty boxes; results are gitignored, so the durable record is hand-typed status comments.
- **Evidence:** 406 entries, 363 dated status records, 1,042 recorded runs since 2026-06-21 (July 460, September 429); 313 commits touch the suite; run in 40 sessions since late July.
- **Outcome:** The 2026-07-03 rerun covered 217 audits and closed 9 real gaps. Every guide rule now cites the audits guarding it. *Judgment:* the instrument every later box-guidance technique points to as its proof step.

### Context-size history ledger
Every audit run appends tokens and turns per audit, keyed by box.
- **Since:** 2026-06-21 e49de30e2. **Evidence:** 1,042 entries, 7,728 lines.
- **Outcome:** A measurement with no assertion until the guide budget used it as the baseline.

### Dev-guidance audits (`knowledge-audit --dev`)
The same harness pointed at a headless Claude Code session in this checkout.
- **Since:** 2026-10-07 6cd8fb1f6; answer-key denial 2026-10-08 9c464c073.
- **Exposed:** the dev agent could read the audit file itself.
- **Evidence:** 11 entries; first clean run 7 of 8. **Outcome:** two days old.

### Agent guide ledger, laws, and word budget
The always-loaded box guide is a hand-written document backed by a ledger with one row per rule (bin: law, core, indirect, delete; reason; guarding audits) and a word budget the linter asserts.
- **Where:** `beebox/src/core/agent-guide/`, `pnpm lint:guide`, `beebox/docs/agent-guide.md`.
- **Since:** generation 2026-02-09 e564d6199; spec and rewrite 2026-09-26 to 09-27 (567a6e8f6, 94545e091, e38a04ea6, 5d1bbbf36).
- **Relieved:** the guide grew from 3,355 words (April) to 11,435 (September), "one justified paragraph per feature, because nothing asked each paragraph to earn its place."
- **Exposed:** every feature must now fit the budget; raises are recorded with a reason; main went over once (2026-10-02 0e653763d, fixed 061d2a8a2).
- **Evidence:** 142 rows (11 law, 82 core, 32 indirect, 17 delete); budget 5,595 guide words / 10,330 always-loaded; measured today 5,555 / 10,289 on a bare box; roughly 9.2k rendered words before (different box).
- **Outcome:** The one instruction surface in the repo with an enforced budget. "A new law needs a failure someone has seen."

### Box CLAUDE.md design and placement tiers (bbx-context)
Route each piece of box guidance to the lightest surface that loads when needed: root, nested, path rules, schema instructions, box docs, procedures.
- **Since:** schema instructions 2026-02-07 1c4aa2f6f; size lint 2026-06-17; skill 2026-06-20 684932e71; registry 2026-09-26 e3ffeb729; skill cut to 38 lines 2026-10-07.
- **Relieved:** "When an agent ignores a written rule, suspect file length first."
- **Exposed:** generated guidance files orphan and park.
- **Outcome:** Low direct invocation; lives on through the ledger bins and the prompt review doc.

### Agent-context renderer, prompt viewer, prompt lenses
Render the full assembled context an agent sees per situation (2026-07-01 d3a8f0d6a); a browsable page of every prompt with a duplication report (2026-07-12 9145f23f2); a written review procedure with lenses (2026-05-19).
- **Evidence:** agent-context in 79 sessions; prompt-viewer in 11; the viewer's size-over-time ledger has one line.
- **Outcome:** agent-context's always-loaded total is the second number the budget asserts; the viewer was superseded in practice by agent-context and the guide lint.

### Documentation graph and doc-read census
`pnpm doc-graph` reports orphans and broken refs (2026-03-04); a one-time census from transcripts found 176 of 333 tracked Markdown files ever opened by an agent (2026-06-23).
- **Evidence now:** 3,008 tracked `.md` (1,823 without issues); by a stricter Read-only measure 318 opened under their current path.
- **Outcome:** The graph is a by-product; doc-check does the work. The tracked-doc count grew 9× in 3.5 months, mostly issues and plans.

### User-story capability catalog
A multi-agent workflow reads the source, writes "the product can do X" stories, adversarially verifies each against code and the running app, and renders a dated catalog the developer annotates.
- **Where:** `beebox/docs/user-stories/`, `beebox/src/scripts/user-stories/`.
- **Since:** 2026-06-26 36ac65226 (413 stories); second run 2026-08-21 (1,024 found, 667 kept).
- **Relieved:** "confirming changes one at a time never answers whether the product does its job."
- **Exposed:** a panel-voting bug flipped 21 of 28 results; cost (~420 agents, ~30M tokens); rot from the day it is committed; "no notion of a person with a motive", which led to journeys.
- **Evidence:** 50 issues trace to it, 39 closed; the recheck loop's `stories:` link is used by 0 issues.
- **Outcome:** Two runs, each producing a batch of issues; the maintenance loop exists but has no recorded use. Workstream-story calls it "started; not settled."

### User-story journeys (simulated-person walks)
An agent with browser access plays one person with one goal, knowing only "an AI-powered app for organising your life", walks a fresh box, and writes in-character notes.
- **Where:** `beebox/test/user-stories/journeys/` (five journeys, walker prompt, provisioning), `beebox/docs/plans/user-story-journeys.md` (draft).
- **Since:** 2026-08-22 696109c42, 92294ea1c; rounds 2026-08-23 to 25, 09-20 to 21, 10-08 (7df3bd4d9).
- **Relieved:** "Nothing starts from someone who wants to stop losing track of what they lent out and has never heard the word 'card'."
- **Exposed:** walk evidence is unreliable on its own (after-action); harness leakage (box agent could read walk notes; boxes inherited the test box's conversations); journey E never built.
- **Evidence:** 14 committed reports; 74 issues trace to walks, 34 closed; the October round filed 40 new issues and found 15 repeats.
- **Outcome:** The largest issue source in this area. Journey finds accumulate (43 open vs 39 closed) where full-suite finds get fixed (3 vs 35).

### Journey after-action pass
A procedure that turns walk notes into verified findings: collect box commits and screenshot timestamps, split every claim, verify each against box, logs and source, then write the report; `prepare` refuses a new walk while an old one lacks a report.
- **Since:** 2026-08-24 42a74680b; reports now go through cross-model review (2026-10-08).
- **Relieved:** "three of the seven bugs a walk reported were ours… Filing them unexamined would have put three false bugs in the queue."
- **Outcome:** The pass is what makes journey issue counts trustworthy.

### Agent browsing as the box owner
A box opts in so the browse key acts as its owner; walkers and catalog passes see owner-gated pages.
- **Since:** 2026-08-26 2af357ca0. **Relieved:** 57 inconclusive catalog checks were 403s. **Outcome:** removed that class of false findings.

### Field probes
For bugs reproducible only on the boxholder's phone or prod: default-off, bounded, content-free instrumentation, a five-step script for the boxholder, a trace pulled from the client debug log.
- **Since:** 2026-08-12 c64c96b9f (scroll trace); boot diagnostics 2026-08-28; admin hang 2026-09-25.
- **Relieved:** "A probe that reaches the device broken wastes a boxholder round-trip, the most expensive resource here."
- **Evidence:** 4 episodes; the skill invoked once. **Outcome:** rarely triggered by design; one closed bug cites it; chat scroll remained open after probing.

### Manual-testing catch-up queue
`needs: [manual-testing]` means "landed, and nobody has looked at it yet"; the queue is the developer's catch-up list; `verify-without-me` lets an agent release a gate on evidence.
- **Since:** 2026-07-19 7bf895a48; `verify-without-me` 2026-08-14.
- **Relieved:** "Code lands faster than one person can try it."
- **Evidence:** 35 open, 27 closed. **Outcome:** larger open than closed; the story-level review is "the same shape, one level up."

### Session critiques
A transcript extraction with full tool output, graded by a critique subagent for whether CLI tools served the agent.
- **Since:** 2026-03-05 865655555. **Evidence:** 13 sessions; the critique agent is defined in a legacy `agents.json` file that current Claude Code does not load. **Outcome:** low use.

### Instruction experiments and calibration pilots
Pre-registered offline runs of instruction wording on several models (12 routing cases and 5 authority scenarios on four models; a 192-call triage experiment on a small model).
- **Since:** 2026-09-12 880f9d4d0; 2026-09-28 2f021c00a. **Outcome:** one worked example rewritten; one-off.

### Retrospective schedule and "arrange context, don't automate judgment"
Every three days an unattended agent receives a packet (CODING_FEEDBACK notes, recurring human instructions and tool failures from transcripts, skill use, escaped bugs, its prior watch list) and lands guidance edits backed by two or more pieces of evidence, after cross-model review.
- **Since:** 2026-10-07 3cf3c3965; the principle is cited in 20 tracked docs, earliest 2026-06-27.
- **Relieved:** guidance repair depended on the developer noticing repeats; replaces "a rule per correction" with a recurrence threshold.
- **Evidence:** 2 runs, 3 landed skill edits in its first day. **Outcome:** too new.

### Agent-docs refresh
A weekly session maps main's commits to the public docs corpus and edits pages to match the code.
- **Since:** 2026-09-16 a41536f24. **Evidence:** 4 runs, 3 refresh commits. **Outcome:** one commit per week after the first run.

---

## 5. The work queue and planning

### The single ideas file (predecessor)
One Markdown file with a section per idea, appended by the developer and agents.
- **Since:** 2026-03-04; split 2026-07-04 2c6c497c2. No TODO.md ever existed.
- **Exposed:** size: 39 lines (03-04) → 470 (05-19) → 919 (05-28) → 1,232 (06-18) → 1,681 at deletion, in 107 commits; "some items carried pages of agent research, others were a few words."
- **Outcome:** Its 107 sections became the first issue files, with filenames backdated by blame.

### issues/ tree: one file per issue, directory is state
`issues/<category>/YYYY-MM-DD-<slug>.md`; closing is `git mv` into `issues/closed/<category>/` with a `resolution:`.
- **Where:** `issues/`, `issues/AGENTS.md` (303 lines, 46 commits), `.claude/skills/issues/SKILL.md`.
- **Since:** 2026-07-04 2c6c497c2; categories 2026-07-10 1694cc239 (watch/ 08-01, deferred/ 08-31).
- **Relieved:** merge conflicts and no structure in one file; findings from parallel worktrees ride the same branch and merge as code.
- **Exposed:** volume: 1,224 issues in three months needed search, triage signals, and a browser.
- **Evidence:** open: bugs 108, features 166, code-quality 52, docs-and-chores 29, decisions 26, exploration 77, watch 7, deferred 2 (467); closed 717. Filed vs closed per month: Jul 336 / 112, Aug 448 / 298, Sep 329 / 208, Oct (9 days) 111 / 103. Median open age 45 days.
- **Outcome:** 721 closed in three months, 623 as implemented. Filing outpaces closing every month.
- **Are closed issues read?** Partly. In local transcripts (Claude 3,566 incl. subagents, since late July), 430 transcripts read at least one closed issue; 385 of 717 closed issues were read at least once; of 931 such reads, 422 were in the closing workstream or on the closing day and 319 came a week or more later (157 after 30 days). Open issues: 4,687 reads over 979 files. The long tail of closed reads is decisions and conventions (the architectural-review decisions issue 15 transcripts, release-provider honesty 11, categorize-issues 10). Codex: 7 transcripts, 11 files. Same method as the plan-read count.

### Ownership vs provenance (`workstream:` / `discovered-in:` / `discovered-by:`)
Ownership is usually `unattached`; provenance names the worktree and context that found it.
- **Since:** `discovered-in` 2026-07-04; split 2026-08-11 16bc0e915, 13c96733b.
- **Relieved:** a session files an out-of-scope finding without claiming it.
- **Exposed:** `workstream:` values are mostly tombstones, "not a clustering signal"; `discovered-in` groups are the best predictor of a real body of work.
- **Evidence:** 376 of 467 open and 604 of 717 closed carry `discovered-in`; `discovered-by`: agent 326, the developer 311.
- **Outcome:** About 80% of issues are agent-filed with provenance. The provenance is a thing the agent does for free and a person does not: of 1,036 agent-filed issues, 1,018 carry `discovered-in`; of 190 developer-filed issues, 4 do. The developer's own words: "something I probably wouldn't have done manually filing issues, but the agent can do it without issue." The field costs the agent one line at filing time, when the context is in front of it, and it is what pick-issues clusters on and what this talk's journey funnel was built from.

### "Tensions, not resolutions"; filing does not authorize implementation
- **Since:** 2026-07-04 original text; reworded 2026-09-12.
- **Exposed:** implementation needed an explicit authorization channel, which became `do-it` and the ladder.

### Frontmatter schema and validation
Required keys, a closed vocabulary, unknown keys reported; doc-check enforces links, unique basenames, and plan and issue frontmatter.
- **Since:** 2026-08-09 b66aed4f3 (613 files); invented `stories:` field retired 2026-08-24 1588e62a8.
- **Outcome:** Every later field (priority, discovered-by, labels) went through the contract.

### Human-owned signals: priority, `needs:`, labels
`priority: important | normal | backlog` set only by the developer (2026-08-11 08bd77b11); `needs: [design | decision | manual-testing]`; optional cross-cutting labels (2026-07-21).
- **Evidence:** 333 of 467 open issues carry a priority; `needs: design` on 114, `decision` on 26; labels on 239.
- **Outcome:** *Judgment:* 114 open design needs is a standing backlog.

### `bin/issues` CLI and the issue browser
Survey and search over the queue (BM25 offline, hybrid with embeddings), sharing the app's parser; a web browser with facets, related-issues panel and next-action select; a testing view with confirm, reset and resume.
- **Since:** browser 2026-08-13 7b49cb0df, 47c1ecf22; CLI 2026-08-24 9da2ae439 (with cross-model findings applied the same day).
- **Relieved:** duplicate filing at ~700 files; the filing rule became "search before filing".
- **Exposed:** similarity clusters are hypotheses ("a session grouped eight connector issues by title and began launching a workstream without having read them"); browser triage made commits on worktree branches.
- **Outcome:** Used by every queue skill and the filing rule.

### Next-action requests and the local store
A removable request per issue (`discuss`, `reconfirm`, `duplicate`, `invalid`, `fixed`, `manually-confirmed`, `verify-without-me`, `do-it`, free text), stored outside git.
- **Since:** 2026-08-13 and 08-14 in the browser; local store and free text 2026-10-05 27339ea11; `do-it` 455b4eb16.
- **Relieved:** the developer hands a suspicion to the next agent at the moment the whole queue is in view; browser edits had "stranded commits on whichever worktree branch held the issue."
- **Exposed:** the store keeps no history, so usage cannot be counted.
- **Evidence:** 12 pending now, all `discuss`.

### bbx-issue-actions, bbx-pick-issues, re-encounter rules
How to work each tag (hypotheses need evidence); modes Investigate / Propose / Act mapped from the developer's words; a repeated symptom is evidence.
- **Since:** 2026-08-13 bd46bf565; 2026-08-24 9da2ae439.
- **Evidence:** two of the three skills the developer types by name (pick-issues 8, issue-actions 4 sessions in 60 days).
- **What pick-issues does to the queue:** issues arrive from many directions and build up; pick-issues batches them into logical units of work. 1,025 of 1,229 issue files name a `discovered-in`, and the top sources are production feedback triage, boxholder discussion, launch-readiness review, external code review, journey walks, post-fix sweeps, and the weekly smoke review. None of those produce work-sized items. The skill's survey ranks `groups --by discovered-in` and `similar` as the signals, then requires reading every member and naming the cluster's mechanism before proposing one session. The day after it landed (Aug 25–26) six clusters were claimed or closed: composer-intake, chat-session-identity (seven issues), model/engine policy, live-vs-stored, chat-history-scale, drive-folder-mounts. The composer-intake cluster is the clean case: four issues from four directions (a field-test prototype on Aug 8, a cross-model review, a journey walkthrough, journey B's assets) settled in one session with four different fates (two land behind `manual-testing`, one implemented, one wontfix because the premise did not hold). The seven-issue chat-session-identity cluster spans Jul 18 to Aug 25 and four workstreams. 26 commits on main close two or more issues at once; 10 of them are in the first week.
- **Exposed:** a cluster is a hypothesis. The skill's own failure story is a session that grouped eight connector issues by title and started a workstream without reading them; that became the "read every member, state the cause not the vocabulary" rule.

### Deferred, watch, and alert-filing
Date-triggered issues in a flat directory activated hourly (2026-08-31 cde25c645; 8 activated); upstream-blocked items in `watch/` (7 open); alert conditions open a week become private issues daily (2026-09-18).
- **Outcome:** Small volumes; alert-filing output is private and uncounted.

### bbx-plan and the plan lifecycle
A plan is a complete unit of work designed end to end; the template sections are the review; `plans/` for draft, active and partial, `implemented-plans/` on ship, `unimplemented-plans/` for superseded or parked; finish reads the plan's issue list to close issues.
- **Where:** `.claude/skills/bbx-plan/`, `beebox/docs/plans/`, `beebox/docs/implemented-plans/`.
- **Since:** skill 2026-05-29 bd69d2f45; convention 2026-06-04 c8f67441a; 517-line skill split into 100 lines plus template 2026-08-26 4b7d18f65; design section 2026-10-07.
- **Relieved:** "When the cost of an unsurfaced failure mode exceeds the cost of writing the plan."
- **Exposed:** partial plans accumulate (41 of 71 status lines in `plans/`); "merging a partial plan because the first part feels done is the violation."
- **Evidence:** 324 plans since June (Jun 44, Jul 103, Aug 80, Sep 85, Oct 12); about 199 implemented, 10 superseded or parked, about 70 open; 35 committed `.review.md` files; 980 commits carry `Plan:` naming 92 plans. bbx-plan is asked for in prose, never typed (52 sessions in 60 days).
- **Outcome:** Plans and reports are the largest docs category (113k lines).
- **Are old plans read?** Yes. In local transcripts (Claude 3,566 incl. subagents, since late July; Codex 1,787), 227 Claude transcripts read at least one shipped plan; 144 of 214 shipped plans were read at least once; 269 of 479 such reads came a week or more after the plan landed (156 after 30 days). Active plans: 1,132 reads over 166 files. Parked or superseded plans: 11 reads. Most-read shipped plans: todo-annotation 23, boxes-as-packages-v2 19, workstreams 13, secret-custody 13, model-engine-policy 11. Counts real reads only (Read tool, or cat/sed/grep in a shell), not edits or moves; plan age uses the landing date on main. What the late reads are for: of 204 reads a week or more after landing, about 115 come from repo-wide audits that read many plans at once (a prior-art credit sweep, this talk's own research, doc and layout sweeps), about 60 answer a question the human asked in the moment (is this a regression; why was this removed; does the system already do this; can a test box reach real secrets), about 15 are research for a new plan in the same area, and the rest are workstream pickups and landing mechanics. The in-the-moment reads get intent and sequencing from the plan that the code cannot give. 26 of 204 later replies cite the plan by name.

### bbx-design
Product design before the plan for user-facing work: situations, right place and time, spirit check, failure view.
- **Since:** 2026-10-07 6cd8fb1f6. **Outcome:** one design subplan; too new.

### bbx-guide-* skills
How-to skills for recurring change shapes (API, schemas); the testing one was retired into docs 2026-10-07.

---

## 6. Unattended work

### Schedules system (`schedules/`, `bin/schedules`, one launchd tick)
One tracked directory per recurring job, one CLI as the only store writer, one tick every 15 minutes, validated run and alert records outside git.
- **Where:** `schedules/*/`, `bin/schedules.ts`, `bin/docs/schedules.md`, `beebox/docs/implemented-plans/scheduled-workstreams.md`.
- **Since:** 2026-08-24 9718aedbc, cfabf04e4, 024e2f01d, 703f3a8bb; four launchd plists retired the same day 3ffc8885d.
- **Relieved:** "four jobs were resilient and silent", each hand-rolling a plist, a log location and a way to tell the developer something; a job that stops should show as overdue without reporting its own death.
- **Exposed:** alert noise (conditions and digest, 09-18); host load (09-11); stranded unattended work (10-06).
- **Evidence:** 15 schedules (9 born in August, 4 in September, 2 in October); 2,237 runs and 81 headless sessions since 08-25; 229 alerts; 91 commits from schedule workstreams; 48 public issues trace to runs plus 29 full-suite-red issues.
- **Outcome:** In daily use for six weeks; jobs grew from 4 to 15.

### Run-script head and agent handoff
`run` gathers, compares and decides whether anything changed, exiting silently when not; only a handoff starts an agent, whose prompt holds judgment.
- **Relieved:** "the persistent Opus session starts on the days something was actually published instead of every day at 12:04"; "A run that reasons about its findings will be wrong at 03:00 with nobody watching."
- **Evidence:** 7 of 15 schedules are run-only and account for 2,143 of 2,237 runs with no agent cost.
- **Outcome:** *Judgment:* the split is why hourly cadences are affordable.

### Scheduled workstreams and stranded-work handling
A handoff reuses a sticky workstream named after the schedule and runs `claude -p` or `codex exec` headless in its own worktree; since 2026-10-06 the runner parks leftover edits, lists unlanded commits, and can replay a handoff.
- **Since:** 2026-08-24 d8d314054, 0fda18d54; 2026-10-06 a8f45b4b8.
- **Relieved:** sdk-update once ran in the main checkout ("could pull and commit over uncommitted work or under a live session"); "a headless session that backgrounded the suite and ended its turn never came back; its uncommitted edits then made every later merge refuse; committed work sat on schedule branches for weeks."
- **Outcome:** 81 headless sessions, 91 commits. The foreground rule for all workers came from here.

### Alerts, conditions, daily digest
`important` pops up at once; `normal` and `fyi` wait for a 09:00 digest; `--condition` dedupes a standing problem; a week-old condition becomes a private issue.
- **Since:** 2026-08-24; conditions and digest 2026-09-18 f680b798e, 7c46d0967.
- **Relieved:** "interrupt me only if it cannot wait a day"; the same `needs-procedure` reported three days running.
- **Evidence:** 229 alerts (Aug 47, Sep 143, Oct 39 in 8 days); closed by a person 172, by a schedule 30, by the digest 13; 14 open.
- **Outcome:** The September peak preceded the change; October's rate is lower but the window is short.

### Overdue detection, schedule lint, headless discipline
Due-ness derives from the stored last run plus cadence, so a laptop that slept runs each job once at the next tick; lint in pre-commit; background tasks disabled and a Bash cap for headless runs; a run with neither alert nor done is a "bailed" important alert.
- **Outcome:** Weekly jobs hold 7–8 runs over six weeks on a laptop; no invalid schedule reached the tick.

### The schedules, one line each
| Schedule | Cadence | Shape | Born | Runs / sessions / alerts / commits | Produced |
|---|---|---|---|---|---|
| full-suite | 1h | run-only | 08-25 | 871 / 0 / 119 / 0 | 29 red landings attributed, 28 closed |
| deferred-issues | 1h | run-only | 08-31 | 739 / 0 / 9 / 0 | 8 issues activated |
| box-convergence | 1h | run-only | 09-12 | 470 / 0 / 14 / 0 | boxes kept on shipped migrations |
| sdk-update | 1d | handoff, persistent Opus | 08-24 | 46 / 36 / 38 / 36 | 23 SDK bumps, 15 issues, 3,293-line ledger |
| docling-update | 1w | run-only | 08-24 | 36 / 0 / 1 / 0 | 1 alert |
| alert-filing | 1d | run-only | 09-18 | 20 / 0 / 0 / 0 | private issues (uncounted) |
| knip-sweep | 1w | handoff | 08-24 | 8 / 7 / 9 / 19 | dead-code landings |
| smoke-review | 1w | handoff | 08-26 | 8 / 7 / 7 / 7 | 5 issues; three windows of unwalked landings |
| tour-check | 1w | handoff | 08-26 | 7 / 7 / 7 / 5 | tours kept passing |
| manual-tests | 1w | handoff, sandboxed + check | 08-24 | 7 / 3 / 6 / 3 | low volume; the `check` pattern |
| disk-hygiene | 1d | run-only | 10-02 | 7 / 0 / 2 / 0 | caches that had reached 31 GB and 62 GB |
| supplemental-lint | 1w | handoff | 08-29 | 6 / 5 / 6 / 10 | 21 standing warnings cleared |
| cross-box-leak-scan | 1w | handoff | 09-04 | 5 / 4 / 4 / 5 | 2 issues |
| agent-docs-refresh | 1w | handoff, Sonnet | 09-16 | 4 / 3 / 4 / 3 | one refresh commit per week |
| retrospective | 3d | handoff | 10-07 | 2 / 2 / 3 / 3 | 3 skill edits |

### The pre-schedules launchd jobs (retired)
Four jobs with their own plists and logs (SDK monitor 2026-07-10, manual tests and failure reporting 2026-08-06, knip, Docling).
- **Outcome:** Abandoned 2026-08-24; a booted-out label whose file survives came back at login and the SDK job ran twice a day from two mechanisms.

---

## 7. Multi-model and delegation

### Codex as a second engine
`bin/launch-worktree-session --agent codex` runs OpenAI's Codex CLI in the same worktree, box clone, briefing and teardown flow.
- **Since:** 2026-08-04 a9dcb4029, ad6acad97, 145e0c8d1.
- **Relieved:** a second model family for review, and capacity when Claude quota is tight.
- **Exposed:** Codex reads none of the Claude hook settings, so no teardown fired and about ten worktrees piled up (fixed the same day).
- **Evidence:** registry: 41 Codex vs 97 Claude workstreams; Codex models in use: Astra 12, Sol 17, Luna 10, Spark 2. 60-day sessions: Codex 508, 423 of them `exec`.
- **Outcome:** At least 283 commits on main from Codex-launched workstreams (lower bound; Codex adds no co-author trailer). Mostly run as a scripted reviewer rather than an interactive driver.

### GLM as a provider of the Claude agent
`--model glm-*` keeps the agent as Claude but points it at a third-party endpoint for one launch.
- **Since:** 2026-09-14 fb0e21501. **Evidence:** 2 workstreams. **Outcome:** low use; the subscription ends in December.

### Dev-side model-choice ladder
Opus 5.5 for most implementation; Fable 5.1 for hard reasoning or delegation-heavy work; Codex Sol or Astra for the other family; small models (Luna, Sonnet, GLM) for bounded mechanical work.
- **Since:** 2026-07-09 29d83450b ("when running as Fable, delegate"); generalized 2026-09-12 c8c728285.
- **Exposed:** alias drift found by the SDK monitor (Opus and Sonnet aliases still pinning old versions); "settle the default engine" in the skills review.
- **Evidence:** trailer values follow the releases: Opus 4.5 (Jan) → 4.6 → 4.7 → 4.8 → Fable 5 (Jun) → Opus 5 → Fable 5.1 (Sep) → Opus 5.5. Fable 5 is the largest single value (1,532).
- **Outcome:** The product's own model registry (four tiers per engine) grew alongside the dev practice of running both engines.

### Headless finish subagent and real-model policy
Finish runs on a pinned mid-tier model (Sonnet; Luna under Codex). Workstreams may call real models for experiments; small models need no permission; ask before sending box content out or spending money (2026-09-28 e484fba40).

### Agent quota posture
Normalized Claude, Codex and GLM quota windows with a pace calculation on the dashboard.
- **Since:** 2026-08-10 52dd5e406. **Evidence today:** Claude 7-day 69%, Fable 7-day 52%, Codex 7-day 57%.
- **Outcome:** *Judgment:* both families run near weekly capacity.

---

## Where the earlier dev pages are now wrong

- `dev/agent-knowledge.html` says the package CLAUDE.md was "held at a healthy weight ever since" the March cut; it grew to 184 lines before the September cut. Its "51 commits" is 110 now.
- `dev/meta-practices.html` describes the ratchet as counting disabled rules; the commits show it counted individual violations (1,000). It lists scenario testing without noting its retirement.
- `dev/skills.html` sizes are June sizes (bbx-plan 439 lines, now 149). The June "craft" era of skills was mostly retired on 2026-10-07.
- None of the four pages covers: the full suite, smoke, tours, test selection and ledger, journeys, the guide budget, schedules, exhibits, comments, provenance trailers, prompt calibration, the retrospective.

---

## 8. False starts: what went in and came out

Things that were built and later removed or replaced. The reason is quoted from the removing commit or issue. Full detail with shas is in the [slides](slides/15a-false-starts-table.md) and the sweep reports.

| What | In | Out | Reason, as recorded | Replaced by |
|---|---|---|---|---|
| Committed AGENTS.md mirror and `.agents/` convention | 2026-05-26 (imported) | 2026-05-26 872450eb1 | "a stale partial duplicate of CLAUDE.md"; "The implementation was incomplete" | Verbatim, gitignored generator (2026-08-04) |
| Generated AGENTS.md mirrors of CLAUDE.md | 2026-08-04 a9dcb4029 | 2026-10-09 3ea06edcf | both agents read AGENTS.md natively, so "one source for both agents" | The instruction files renamed to AGENTS.md; a doc-check rule that no CLAUDE.md may exist |
| Scenario testing | 2026-02-21 69e0ed376 | 2026-09-16 741dca4cb | "No scenario files exist anywhere in the repo, so no invocation could succeed" | Field tests |
| 18 lint rules turned off at preset integration | 2026-02-14 | 2026-05-30 b53159500 | "silently disabling a chunk of our own documented style" | The suppression ratchet |
| The suppression ratchet | 2026-05-30 | 2026-05-31 8965f1d36 | "at zero suppressions, so the ratchet machinery is vestigial" | The standing no-disable rule |
| One ideas file | 2026-03-04 | 2026-07-04 2c6c497c2 | 1,681 lines, 107 commits; "Migrated all 107 sections" | `issues/` |
| Four launchd jobs | 2026-07-10, 08-06 | 2026-08-24 3ffc8885d | "four jobs were resilient and silent"; the SDK job "would run twice a day from two mechanisms" | `schedules/` |
| sdk-update in the main checkout (`worktree: false`) | 2026-08-24 | 2026-08-24 0fda18d54 | "could commit over uncommitted work or under a live session" | Its own worktree |
| `codex` skill, one direction | 2026-06-04 | 2026-08-04 aae37764a | "codex reviewing codex — a same-model self-review wearing the costume of the cross-model check" | `cross-model` |
| Vendored skill-creator; cb-prompt-review | 2026-06-20; 07-01 | 2026-08-03 cdb3fb8a2 | "vendored out of obligation and never invoked"; "a deliberate, user-initiated workflow" | Nothing; a doc |
| `user-copy` skill | 2026-08-19 | 2026-08-19 7f8aba23a | "a mis-scoped skill the assistant wrote unasked"; "a counter-defaults document written in those defaults is self-refuting" | An issue |
| Craft skills bbx-debug, bbx-frontend, bbx-guide-testing | 2026-06-20 | 2026-10-07 19e261eb9 | "Current models debug and build UI without a skill" | Sections in testing.md and frontend.md |
| bbx-codehealth; canvas-loop-sketch | 2026-07-04; 07-14 | 2026-10-07 04bae7e91 | "promoted index.ts barrels against code-style.md"; probes already ran weekly | Schedules; a nested CLAUDE.md |
| browser-task skill in the dev repo | 2026-09-12 | 2026-10-07 329045bff | ships with the box, "versioned with the card type" | A managed box skill |
| Invented `stories:` issue field | 2026-08-21 | 2026-08-24 1588e62a8 | "reached no tool… because the parser drops unknown keys without a word" | `labels:`; the parser reports unknown keys |
| finish agent at 624 lines | 2026-08-08 | 2026-08-25 803ff20fa | "the mechanics the scripts now own are gone" | 150-line agent plus preflight and verify scripts |
| Fast-forward-only landing | 2026-08-08 | 2026-08-24 a0093e2ba | one visible merge commit per landing | `bin/land --no-ff` |
| Browser triage committing frontmatter | 2026-08-13 | 2026-10-05 27339ea11 | "stranded commits on whichever worktree branch held the issue" | A local store outside git |
| Hourly reporter blaming its own commits | 2026-08-25 | 2026-08-27 c6be8b524 | "THIRTEEN issues and thirteen commits on main" for one failure | Known-red carried forward; docs-only landings never blamed |
| Post-merge auto-sweep | 2026-07-11 07:04 | 2026-07-11 18:09 667738949 | raced the deploy, "failing the prod deploy (seen repeatedly)" | Sweep at session start and end |
| Codex write grant to the main checkout | 2026-08-04 | 2026-08-04 ec21bdcc7 | "it never worked… only weakened isolation" | Codex implements; landing goes through the launcher |
| Speculative finish guidance | 2026-08-08 | 2026-08-08 1ffb197f3 | "generalized from a handful of probes rather than observed failures" | Only the fix "hit twice in real sessions" |
| Test selection's planned FULL fallback | plan Track 2 | 2026-08-25 (never shipped) | sixteen days of ledger data found no full run catching an unimplicated bug | Empty selection allowed; hourly suite on main |
| stack-decisions as a live doc | 2026-03-02 | 2026-09-12 dcc1778a7 | "records why the stack was chosen, not how the system works now" | A dated report |
| The old two-letter CLI name | 2026-01-30 | 2026-08-30 dab834811 | rename; a tombstone that "never forwards" so "the rename would never finish" otherwise | `bbx` |
| Package CLAUDE.md rules: flake workaround note; "Don't invent card XML formats"; "Read before writing" | 06-21; 03-06; 03-06 | same day; 05-05; 09-12 | cause fixed; "a box-side concern"; dropped in calibration, not restated | — |

Never removed but unused: the tracked `.claude/memory/` import (14 files, a frozen archive), the prompt viewer's size ledger (one line), the user-story catalog's recheck loop (0 issues link to it).

Reverts: 13 commits on main start with "Revert"; the fastest came two minutes after the commit it reverted. Most carry no reason; the reason is usually in the next commit (a scope review that stopped an iOS track and added "a scope circuit breaker" to the plan skill nine minutes later; a cross-model review that found a removal "silently drops the only record of a capture's media. The suite stayed green through all of it").
