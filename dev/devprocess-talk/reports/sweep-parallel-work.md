# Parallel work: technique inventory

All commands run from the worktree root unless noted. Out-of-git store counts (`~/src/workstream-exhibits`, `~/src/dev-comments`, `~/.cache/beebox/...`) are aggregate file/line counts only. Transcript counts: `~/.claude/projects/*beebox*/*.jsonl` holds 276 transcripts, the oldest from 2026-08-10 (older ones are pruned), so the window is about 60 days. Codex rollout grep counts are inflated by generated AGENTS.md text inside the rollouts, so they are not used as usage evidence.

Shared repo-wide numbers (cited by several entries below):

| Number | Value | Command |
|---|---|---|
| `worktree-*` branches currently present | 7 | `git branch -a \| grep -c worktree-` |
| Commit subjects `Merge branch 'worktree-…'` (all reachable) | 600 | `git log --format=%s \| grep -c "Merge branch 'worktree-"` |
| Same, first-parent of `main` | 548 | `git log main --first-parent --format=%s \| grep -c "Merge branch 'worktree-"` |
| Distinct worktree names merged into main | 191 | `... \| sed "s/Merge branch '\(worktree-[^']*\)'.*/\1/" \| sort -u \| wc -l` |
| Distinct `worktree-*` names in any subject | 435 | `git log --format=%s \| grep -o "worktree-[A-Za-z0-9._-]*" \| sort -u \| wc -l` |
| Worktree merges into main per month | 05: 3, 06: 10, 07: 8, 08: 112, 09: 299, 10 (to 10-09): 116 | `git log main --first-parent --format='%ad %s' --date=format:%Y-%m \| grep "Merge branch 'worktree-" \| cut -c1-7 \| sort \| uniq -c` |
| `Workstream:` trailers on main | 2800 (181 distinct) | `git log main --format=%B \| grep '^Workstream:' \| sort -u \| wc -l` |
| `Plan:` trailers on main | 1245 (175 distinct) | same with `^Plan:` |
| `Issue:` trailers on main | 1283 (434 distinct) | same with `^Issue:` |
| bin/*.ts (non-test) / bin/*.test.ts / bin/lib files / bin/test doctests | 74 / 44 / 52 / 32 | `ls bin/*.ts \| grep -v '\.test\.ts$' \| wc -l`; `ls bin/*.test.ts \| wc -l`; `git ls-files bin/lib \| wc -l`; `git ls-files bin/test \| grep -c doctest.md` |
| bin/ tracked lines | 44,394 | `git ls-files bin \| xargs cat \| wc -l` |
| workstreams-app: tracked files / lines (ts,tsx,css,md,html) / src ts+tsx / test ts | 199 / 27,241 / 18,439 / 3,869 | `git ls-files workstreams-app \| grep -E '\.(ts\|tsx\|css\|md\|html)$' \| xargs cat \| wc -l` (and variants) |
| Commits touching bin / workstreams-app | 554 / 127 | `git log --format=%h -- bin \| wc -l` |

Caveat on merge counts: `bin/land` started as fast-forward-only (2026-08-08 9786e4895) and switched to `--no-ff` on 2026-08-24 (a0093e2ba "bin/land: merge --no-ff instead of --ff-only"). Earlier landings were often fast-forwards with no merge commit, so May–August counts are undercounts. 520 of the 548 first-parent worktree merges are dated on or after 2026-08-24 (`git log main --first-parent --since=2026-08-24 --format=%s | grep -c "^Merge branch 'worktree-"`). `main` was also rewritten and force-pushed around 2026-09-02 (bin/CLAUDE.md "Commit safety"); shas below are those reachable in this worktree.

---

## Managed git worktrees (`~/src/beebox-worktrees/<name>/`, branch `worktree-<name>`)
- **One line:** each line of work gets its own git checkout on a `worktree-<name>` branch, created by repo tooling, outside the main checkout.
- **Lives in:** `bin/workstreams` (`create`), `bin/lib/worktree-create.sh`, `bin/lib/worktree-paths.sh`, `.claude/hooks/worktree-create.sh`, `.claude/hooks/worktree-remove.sh`, `bin/docs/worktree-lifecycle.md`, root `CLAUDE.md` "Work safely in this checkout".
- **Appeared:** 2026-05-26 43fc5762e "Worktree paths and pnpm migration"; 2026-05-26 f5e5d6e8e "Worktree setup: migrate shell scripts to Claude Code hooks". Reshaped: 2026-08-08 6d671837b "Promote worktree creation into `bin/worktrees create`"; 2026-08-08 8f42c1f53 "Derive worktree paths and share sweep's live-agent guard" (roots derived from `git rev-parse --git-common-dir`, fatal on failure).
- **Bottleneck relieved:** several agents in one checkout collided. dev/workstream-story.md, Act I: "One checkout. Several agent sessions at once, each told to 'stay in your area.' They did not stay in their area."
- **New bottleneck exposed:** cheap sessions accumulated; the open terminal tab became the only record of unverified work (see "Workstream vs worktree split"). Also concurrent `git worktree add` races (issues/closed/bugs/2026-08-20-concurrent-workstream-launches-race.md) and host contention from many parallel test runs (see "Machine-wide test semaphore").
- **Evidence:** see shared table (548 worktree merges into main, 191 distinct merged names, 435 distinct names in subjects). 232 Claude project dirs under `~/.claude/projects` have `beebox-worktrees` in their name (`ls ~/.claude/projects | grep -c beebox-worktrees`); 249 Claude transcripts sit in those dirs. 797 of 1782 Codex rollouts reference a `beebox-worktrees` path (`find ~/.codex/sessions -name '*.jsonl' -exec grep -l -m1 'beebox-worktrees' {} + | wc -l`). Current worktrees: 7 (`git worktree list | wc -l`).
- **Outcomes:** Still the unit of all non-trivial work. 548 merges into main from 191 distinct worktree names; merges rose from 3 (May) to 299 (September). Every later technique in this file builds on it. 497 of 1185 tracked issues carry `discovered-in: worktree-…` (`git grep -l '^discovered-in: worktree-' -- issues | wc -l`), so worktree sessions are also the main source of filed findings.
- **Prior-art mention:** yes. dev/workstream-story.md "Worktrees, and one router to serve them all"; dev/meta-practices.html entry 2026-05-26 "worktrees + dev router: parallel isolated sessions, each lazily served".

## Per-worktree test-box clones (`~/src/box-worktrees/<name>/test1/`)
- **One line:** each worktree gets an isolated clone of the `test1` test box outside the monorepo, so agents can mutate test data without touching the shared box.
- **Lives in:** `bin/lib/worktree-create.sh`, `bin/workstreams reset-test`, root `CLAUDE.md`, `beebox/docs/box-work.md`, `bin/docs/worktree-lifecycle.md` ("Creation keeps the isolated `test1` box outside the monorepo ... copies `.env` without `BOXES=`").
- **Appeared:** 2026-05-26 f5e5d6e8e (worktree setup hooks); 2026-05-27 b921dffd1 "Worktree boxes: keep 'test1' basename so URL slug is stable across worktrees". Reshaped: 2026-08-09 19e33d98f "Preserve kept box state on release" (unmerged test-box branch pushed as `keep/<workstream>-<date>` before cull).
- **Bottleneck relieved:** shared test data across parallel sessions; one agent's test mutations would show up in another's runs. `.env` copy without `BOXES=` "so an isolated checkout cannot serve real boxes" (bin/docs/router-operations.md).
- **New bottleneck exposed:** a culled worktree destroyed the repro data a human still needed to test, which led to manual-testing cull pins and `keep/` branches. Also orphaned annex remnants (issues/closed/bugs/2026-08-04-worktree-box-trash-annex-remnants.md).
- **Evidence:** 45 entries in `~/src/box-worktrees` (`ls ~/src/box-worktrees | wc -l`) against 7 live worktrees.
- **Outcomes:** In use. Judgment: the 45-vs-7 gap suggests box clones outlive their worktrees more often than the sweep removes them; not verified whether these are `keep`-preserved or orphans.
- **Prior-art mention:** yes, briefly. dev/workstream-story.md: "its own clone of the test data".

## Shared dev router on localhost:3210 (lazy start, idle stop)
- **One line:** one long-running proxy serves every checkout at `/<worktree>/<box>/...`, cold-starting a worktree's Vite and hub on the first HTTP request and stopping it after idle time.
- **Lives in:** `workstreams-app/src/router/` (moved from `bin/` on 2026-09-02), `bin/docs/router-protocol.md` (304 lines), `bin/docs/router-operations.md` (147 lines), `workstreams-app/test/router/`.
- **Appeared:** 2026-05-26 967b776af "Dev router: lazy-start, path-prefix routed, multi-worktree"; 2026-05-26 96932b6df "Router phase 2: idle shutdown, orphan sweep, CLI, hook wiring, doc updates". Reshaped: 2026-06-09 d7aa208fb "fix(dev-router): survive idle shutdown without storms, wedged tabs, or lost sends"; 2026-07-04 4ecdc9764 "feat(hub): lazy per-box hub mode; dev router unifies serving onto it"; 2026-09-02 3b3ba0df5 "Move dev router into workstreams app".
- **Bottleneck relieved:** running a full dev server per checkout by hand, with port juggling. dev/workstream-story.md: "a worktree cold-starts on the first request and stops after 5 idle minutes." Then: "Spinning up a parallel session became cheap. Which caused the *real* problem."
- **New bottleneck exposed:** shared mutable process state: orphan processes (2026-06-20 9b733e681 "project-scoped, session-safe orphan process reclamation"), concurrent starts (2026-06-20 9ec9e121f "dedupe concurrent worktree starts"), WebSocket reconnects (issues/closed/bugs/2026-08-02-dev-router-worktree-websocket-1006.md), startup timeouts under host load (2026-09-15 2a8d3fa75 "Plan dev-router transient-failure resilience": retries 2s/8s/30s for `waitForHttp` failures only). A rule that one worktree must not restart the router for everyone (root CLAUDE.md: "Do not restart or `panic` the shared router from a worktree without asking the boxholder").
- **Evidence:** router-related doc lines 451 (`wc -l bin/docs/router-*.md`). Commits in the router area: see shared table (bin + workstreams-app). Current per-worktree child logs: 4 (`ls ~/.cache/beebox/logs`).
- **Outcomes:** In use daily; it is the URL scheme in root CLAUDE.md and the host for `/dev/`, exhibits, and the workstreams app. Later techniques built on it: Tailscale exposure (2026-07-21 b12611e80 plan), per-worktree browse daemon (2026-05-26 4f23d00cb), `/dev/` serving, the workstreams app. Judgment: the volume of protocol docs (304 lines of invariants) is the cost of sharing one process across all sessions.
- **Prior-art mention:** yes. dev/workstream-story.md (router diagram, 5-minute idle); dev/meta-practices.html 2026-05-26 "worktrees + dev router".

## Router authentication and Tailscale exposure
- **One line:** the router is a fail-closed authenticating proxy over TCP, with the Unix socket as the trusted local channel, so the whole dev fleet can be reached from a phone.
- **Lives in:** `bin/docs/router-operations.md` "Authentication and exposure"; `beebox/docs/implemented-plans/expose-dev-router.md`.
- **Appeared:** 2026-07-21 b12611e80 "plan: make the shared dev router safely exposable over Tailscale".
- **Bottleneck relieved:** parallel work was only reviewable at the desk. (Doc: "`bbx tailscale setup --target <routerPort>` exposes the whole router.")
- **New bottleneck exposed:** auth gates mis-reported a down worktree as an auth problem; fixed by the 503 `worktree-unavailable` answer (bin/docs/router-operations.md: a down worktree "used to be reported through whichever authorization reason the gate happened to produce").
- **Evidence:** issues/closed/bugs/2026-07-20-dev-router-login-page-broken.md; issues/closed/bugs/2026-08-09-browse-key-ws-upgrade-headers.md.
- **Outcomes:** In use. Judgment: it extended review of parallel work off the laptop; no usage numbers found.
- **Prior-art mention:** no.

## Per-worktree browser daemon (`bin/browse`)
- **One line:** a worktree-aware wrapper around agent-browser, one daemon per worktree, so parallel agents can drive browsers without sharing a session.
- **Lives in:** `bin/browse`, `.claude/skills/browse/SKILL.md`, router reaper.
- **Appeared:** 2026-05-26 74393cc71 "agent-browser: install + bin/browse wrapper for current worktree"; 2026-05-26 4f23d00cb "router: per-worktree agent-browser daemon + dashboard". Reshaped: 2026-06-26 0df685632 "fix(router): reap superseded agent-browser daemons (pidfile-precise)".
- **Bottleneck relieved:** UI verification by agents in parallel checkouts.
- **New bottleneck exposed:** daemon reclamation needed the same liveness oracle as worktree teardown (bin/docs/worktree-lifecycle.md: "A browser daemon under 60 seconds old is spared ...").
- **Evidence:** not counted here (another sweep's area).
- **Outcomes:** In use. Not measured here.
- **Prior-art mention:** dev/meta-practices.html 2026-05-26 "agent-browser · bin/browse".

## launch-worktree-session skill and `bin/launch-worktree-session`
- **One line:** an agent spins off a new session in a fresh managed worktree, opening one terminal tab and passing a briefing that carries the conversation's decisions and authorization.
- **Lives in:** `.claude/skills/launch-worktree-session/SKILL.md` (91 lines), `bin/launch-worktree-session` (319 lines), `bin/lib/launch-session.sh`.
- **Appeared:** 2026-05-27 275a29ffd "Add /launch-worktree-session skill + rename cccb-new" (skill at 139 lines). Reshaped: 2026-06-27 38db00729 "bin: track launch-worktree-session; open exactly one tab/window"; 2026-07-09 47b2d7a94 "add --model flag"; 2026-08-04 a9dcb4029 "launch OpenAI Codex sessions via launch-worktree-session --agent codex"; 2026-08-09 c7f37aa5b "Extract shared session launcher"; 2026-08-20 a0a84452c "Implement workstream routing and briefed resume".
- **Bottleneck relieved:** the human had to open terminals and re-explain context for every parallel line of work.
- **New bottleneck exposed:** concurrent launches raced in `git worktree add` (issues/closed/bugs/2026-08-20-concurrent-workstream-launches-race.md: "The user-facing skill currently needs to say 'launch one at a time'"); a launch-to-agent gap where a new worktree looked dead (issues/closed/bugs/2026-08-20-workstream-launch-liveness-gap.md); spin-offs duplicated existing streams (see "Workstream routing").
- **Evidence:** skill file 36 commits (`git log --format=%h -- .claude/skills/launch-worktree-session/SKILL.md | wc -l`). Claude sessions with a Bash call to it in the 60-day transcript window: 19 (`grep -l '"command":"[^"]*bin/launch-worktree-session' ~/.claude/projects/*beebox*/*.jsonl | wc -l`). dev/agent-knowledge.html: "launch-worktree ... slash:0, prose:69". dev/skills-review-2026-10.md: 15 agent invocations, 0 typed.
- **Outcomes:** In use; launched most of the 191 merged worktrees (judgment: not separable from manual creation in git). dev/skills-review-2026-10.md recommends shrinking it to ~140 lines and settling the default engine.
- **Prior-art mention:** yes. dev/agent-knowledge.html ("spin off" step); dev/skills-review-2026-10.md (row and shrink recommendation).

## Concurrent creation lock and launch lease
- **One line:** per-name serialization of worktree setup with a short repository-wide lock around `git worktree add`, plus a bounded launch lease that marks a workstream `launching` (counted as live) until its agent process is visible.
- **Lives in:** `bin/lib/worktree-create.sh`, `bin/workstreams`, `beebox/docs/implemented-plans/concurrent-workstream-creation.md`, `beebox/docs/implemented-plans/workstream-launch-liveness.md`.
- **Appeared:** 2026-08-24 0300a0185 "fix(workstreams): serialize concurrent lifecycle setup"; 2026-08-24 c69ac5903 "fix(workstreams): protect launches with a bounded lease".
- **Bottleneck relieved:** parallel launches failed after a tab had opened; and "A freshly created branch is normally merged and clean, so the gap could authorize cleanup before the session became visible" (issues/closed/bugs/2026-08-20-workstream-launch-liveness-gap.md).
- **New bottleneck exposed:** not visible.
- **Evidence:** 2 log lines with `launching` in the 40-day cleanup log (`grep -c launching ~/.cache/beebox/worktree-cleanup.log`). dev/skills-review-2026-10.md: "worktree launch race (1)" in its window.
- **Outcomes:** Closed two bugs (above). Judgment: the race appears fixed; one residual occurrence in the skills-review window.
- **Prior-art mention:** no.

## Workstream vs worktree split (`bin/workstreams`, registry, cull/resume)
- **One line:** a workstream is the durable named line of work (registry record, plan, issues, exhibits); a worktree is a disposable checkout attached to it that can be culled and recreated on resume.
- **Lives in:** `bin/workstreams` (1080 lines; `list`, `create`, `resume`, `remove`, `close`, `release`, `reset-test`, `confirm-tested`, `down`, `panic`, `agent-liveness`), `.claude/hooks/session-start-registry.sh`, `~/.cache/beebox/workstreams/*.json`, `beebox/docs/implemented-plans/workstreams.md`, `beebox/docs/plans/worktree-control-surface.md`.
- **Appeared:** CLI first as `bin/worktrees` in 2026-05-26 967b776af; renamed 2026-08-09 a4d74648f "Rename worktree CLI to workstreams". Registry: 2026-08-09 2d88a7f23 "Add workstream session registry"; 2026-08-09 dc55704d3 "Add workstream resume command"; 2026-08-09 32fb3962e "Record workstream cull state"; plan 2026-08-09 c8bd4fddc "docs(plans): /ide/ app + disposable-sessions lifecycle plan"; vocabulary 2026-08-09 1e49fb603 "docs(plans): vocabulary — the unit is a workstream; app is /workstreams/".
- **Bottleneck relieved:** issues/closed/features/2026-08-08-worktree-session-workflow-redesign.md (filed 2026-08-08, 516ebbbe7 "docs(issues): file worktree/session workflow redesign + events.db hazard"): "Sessions are currently doing double duty as a to-do database. A worktree stays open until Ian has verified the work, because the open session is the only record of _what still needs checking_." Same issue: "Closing a session feels lossy, so ~9 accumulate (they were live when this was filed, on a machine that had exhausted its 20 GB of swap)." dev/workstream-story.md restates it: "At peak: ~9 live sessions, 20 GB of swap, gone."
- **New bottleneck exposed:** knowing which workstream should own new work (issues/closed/features/2026-08-20-no-way-to-know-what-a-workstream-covers.md: "A workstream is a name on a branch; nothing records what it covers"), leading to workstream routing; no archive control (issues/closed/features/2026-09-03-workstreams-app-has-no-archive-button.md).
- **Evidence:** 155 registry records in `~/.cache/beebox/workstreams/` (`ls ~/.cache/beebox/workstreams/* | wc -l`) against 7 live worktrees. 181 distinct `Workstream:` trailer values on main. Issues with a `workstream:` owner other than `unattached`: 852 (`git grep -h '^workstream:' -- issues | grep -vc unattached`).
- **Outcomes:** In use. The 2026-08-08 issue was closed as implemented. 155 records vs 7 checkouts shows most workstreams exist without a checkout at any time. Judgment: this split is what made culling safe to automate.
- **Prior-art mention:** yes. dev/workstream-story.md "The tab bar becomes a database" and "The split: workstream ≠ worktree".

## Workstream routing and briefed resume
- **One line:** launch records carry a short description; `list --json` reports `routing.state` and `routing.action` so a launching agent routes related work to an existing stream (resume with a briefing) before creating a new one.
- **Lives in:** `bin/workstreams` (`list --json`, `resume`), `beebox/docs/implemented-plans/workstream-routing.md`, launch skill.
- **Appeared:** 2026-08-20 cd8c97889 "docs(plans): design workstream routing handoffs"; 2026-08-20 a0a84452c "Implement workstream routing and briefed resume".
- **Bottleneck relieved:** issues/closed/features/2026-08-20-no-way-to-know-what-a-workstream-covers.md: "I think there's a workstream that *should* own this (one that already exists), but I'm not sure."
- **New bottleneck exposed:** launcher bug where descriptions were never recorded (issues/closed/bugs/2026-08-24-launcher-cat-error-and-descriptions-never-recorded.md).
- **Evidence:** 191 distinct merged worktree names vs 548 merges: the same name lands about 2.9 times on average (548/191), which is consistent with resume of existing streams (judgment; trailers do not record resume). Claude sessions with a Bash call `bin/workstreams resume`: 8 in the 60-day window.
- **Outcomes:** Closed the issue above. Judgment: repeated landings per name indicate streams are reused.
- **Prior-art mention:** no.

## Tri-state liveness, fail-closed (`wt_other_agent_live`, `agent-liveness`)
- **One line:** one shared guard returns `none`, `launching`, `live`, or `unknown`; only `none` authorizes any destructive action, and `--force` never overrides it.
- **Lives in:** `bin/lib/worktree-*.sh` (`wt_other_agent_live`, `wt_agent_snapshot_capture`), `bin/workstreams agent-liveness`, `bin/docs/worktree-lifecycle.md` "Destructive-operation guard".
- **Appeared:** 2026-08-04 ad6acad97 "Give codex worktree sessions the teardown claude sessions get" (introduces `wt_other_agent_live`); 2026-08-04 2d22bc184 "Fail closed when git can't report worktree state; re-check before removing"; 2026-08-08 8f42c1f53 "Derive worktree paths and share sweep's live-agent guard". `launching` state added 2026-08-24 c69ac5903.
- **Bottleneck relieved:** issues/closed/bugs/2026-08-04-sweep-live-agent-guard-fails-open.md: "`bin/workstreams sweep`'s live-agent guard fails OPEN when ps/lsof can't answer" (found by cross-model Codex review). The redesign issue: "`unknown` no longer reads as 'nothing running', which was a fail-open hole in front of an irreversible delete."
- **New bottleneck exposed:** nested agents (reviewers spawned from a session) could delete their parent's tree; addressed by `--exclude-self-ancestor` and `--setting-sources user` for nested headless Claude (bin/docs/worktree-lifecycle.md: "These independent guards prevent a reviewer from deleting its parent session's tree").
- **Evidence:** cleanup log 2026-08-30..2026-10-09: 793 sweep skips for `agent=live`, 0 for `agent=unknown`, 2 `launching` (`grep -c 'skip .*agent=live' ~/.cache/beebox/worktree-cleanup.log`, etc.).
- **Outcomes:** In 40 days of logs, 793 skip decisions preserved trees with a live agent. No closed issue after 2026-08-24 reports a wrongly deleted live worktree (judgment from issues/closed titles; not exhaustive).
- **Prior-art mention:** yes. dev/workstream-story.md "Cleanup: one rule, applied everywhere" ("unknown counts as live. Even `--force` won't override a liveness check").

## Teardown and culling sweeps (SessionEnd, auto-sweep, `bin/workstreams sweep`)
- **One line:** a single teardown implementation removes worktrees that are merged, clean, unpinned, and have no live agent, triggered at session end, session start, Codex exit, and post-merge.
- **Lives in:** `bin/lib/worktree-teardown.sh`, `.claude/hooks/session-end.sh`, `.claude/hooks/auto-sweep.sh`, `bin/codex-session-end`, `bin/lib/detach.mjs`, `~/.cache/beebox/worktree-cleanup.log`.
- **Appeared:** 2026-05-26 6babebd70 "Add /finish skill + SessionEnd auto-cleanup of merged worktrees"; 2026-05-27 0e2bd0155 "Worktree cleanup: more aggressive + add `bin/worktrees sweep`". Reshaped: 2026-06-09 7e78541a5 "fix(worktrees): timeout-proof cleanup + un-poison the dirty gate"; 2026-07-11 f91df58e4 "hooks: auto-sweep worktrees on post-merge + session-start"; 2026-08-24 03c107933 "fix(dev-loop): stop the sweep, the browse reaper, and the router assuming ownership they don't have" (detached launchd worker).
- **Bottleneck relieved:** merged worktrees and their processes lingering after work landed.
- **New bottleneck exposed:** issues/closed/bugs/2026-08-20-session-end-hook-cancelled-by-slow-sweep.md: sweep was killed with the exiting session's process group: "15 of 109 session-end sweeps lost, against 0 of 44 session-start and 0 of 72 codex". Also exhibits/comments/private worktrees outliving their worktree (orphan reporting).
- **Evidence:** cleanup log window 2026-08-30..2026-10-09: 184 auto-sweep starts, 180 `sweep done` lines; triggers session-end 243, codex-session-end 103, session-start 32 log lines (`grep -o 'auto-sweep trigger=[a-z-]*' ... | sort | uniq -c`); worktrees removed by sweeps 61 (sum of `sweep done: N`); SessionEnd `decision=clean` 83, `decision=skip` 41; skips for unmerged work 1017; for manual-testing pins 238.
- **Outcomes:** In use. About 144 worktree removals (83 + 61) in 40 days with no human step. Judgment: the high repeated skip counts for the same few unmerged trees (each logged ~120 times) mean those trees wait on a human decision; the sweep reports them but cannot resolve them.
- **Prior-art mention:** yes. dev/workstream-story.md "Cleanup" section.

## The seam: lifecycle moved from Claude Code hooks into a CLI (Codex parity)
- **One line:** worktree create/remove/teardown logic moved out of Claude Code hook scripts into `bin/workstreams` and `bin/lib/worktree-*.sh`, so hooks, the launcher, Codex, and the web app are thin clients.
- **Lives in:** `bin/workstreams`, `bin/lib/worktree-create.sh`, `bin/lib/worktree-teardown.sh`, `bin/codex-session-end`, `bin/generate-agents-md.ts`, `bin/generate-codex-agents.ts`, `beebox/docs/plans/worktree-control-surface.md`, `beebox/docs/implemented-plans/codex-worktree-sessions.md`.
- **Appeared:** 2026-08-04 a9dcb4029 "feat(worktrees): launch OpenAI Codex sessions via launch-worktree-session --agent codex"; 2026-08-04 ad6acad97 "Give codex worktree sessions the teardown claude sessions get"; 2026-08-08 6d671837b "Promote worktree creation into `bin/worktrees create`"; 2026-08-08 505615b66 "Add `bin/worktrees list` and document the control surface" (branch `worktree-seam`).
- **Bottleneck relieved:** dev/workstream-story.md: "a second agent CLI (OpenAI's Codex) needed the same lifecycle and had to *impersonate Claude Code's hook JSON* to reach it." The redesign issue: "a new frontend (a web button, a packaged tool) no longer has to impersonate Claude Code to reach the repo's own worktree logic. That is what makes trying Conductor cost one script instead of a bet."
- **New bottleneck exposed:** generated guidance mirrors for Codex (AGENTS.md, `.codex/agents/*.toml`) that must not be hand-edited; a `bin/workstreams sweep` executed on every Codex launch (2026-08-10 ef7ab4fff "fix(launch): stop executing `bin/workstreams sweep` on every codex launch"). Managed Claude worktree sessions are not isolated from main (2026-08-25 83461458b).
- **Evidence:** 797 Codex rollouts reference a managed worktree path; 103 `codex-session-end` sweep triggers in 40 days of cleanup log.
- **Outcomes:** In use. Codex sessions became a regular second engine (103 Codex-exit teardowns in 40 days). The workstreams app shells out to the same CLI (bin/docs/worktree-lifecycle.md: "The resident app shells out to the CLI rather than duplicating guards"). Cross-model review depends on both engines working in the same worktrees.
- **Prior-art mention:** yes. dev/workstream-story.md "The seam test: two different agent CLIs".

## Generated AGENTS.md / Codex agent mirrors
- **One line:** worktree creation regenerates AGENTS.md mirrors of tracked CLAUDE.md files, symlinks skills, and writes `.codex/agents/*.toml` from `.claude/agents/*.md`.
- **Lives in:** `bin/generate-agents-md.ts`, `bin/generate-codex-agents.ts`, `bin/docs/worktree-lifecycle.md` "Sessions and generated guidance".
- **Appeared:** 2026-08-04 a9dcb4029 (with Codex sessions).
- **Bottleneck relieved:** two agent engines needed the same guidance in a single source.
- **New bottleneck exposed:** model-alias mapping must exist or generation fails ("A Claude `model:` alias with no Codex mapping fails generation").
- **Evidence:** `bin/generate-agents-md.test.ts`, `bin/codex-skill-links.test.ts` exist.
- **Outcomes:** In use. Judgment: required for the seam's second engine.
- **Prior-art mention:** no.

## Dev dashboard: workstreams app (`/workstreams/`)
- **One line:** a resident React + tRPC app behind the router listing workstreams with joined git/router/liveness/schedule state, plus issues, plans, testing, asks, and a recency feed.
- **Lives in:** `workstreams-app/` (pages: `WorkstreamsPage`, `WorkstreamDetailPage`, `IssuesPage`, `PlansPage`, `TestingPage`, `AsksPage`, `RecentPage`, `BrowsePage`, `ScheduleAlertPage`), `beebox/docs/plans/workstreams-app.md`.
- **Appeared:** precursors 2026-05-26 010dc2e33 "Router root: HTML index of clickable worktrees"; 2026-07-10 12c9a1137 "feat(bin): add server-rendered issue browser at /dev/issues/"; 2026-08-09 66107a9af "Add read-only workstreams page"; 2026-08-09 1470a5466 "Add workstream web actions". App: 2026-08-13 f64b90215 "Plan resident workstreams application"; 21d0cd1c1 "Add typed workstreams app backend"; 7b49cb0df "Build workstreams React interface". Later: 2026-08-15 2b15809ce ask queue; 2026-08-22 31bf12b13 "the cross-workstream recency feed, as the front door"; 2026-08-10 52dd5e406 "Add agent quota pace to workstreams dashboard".
- **Bottleneck relieved:** "There's no way to see what's outstanding — the list exists only as terminal tabs." (2026-08-08 redesign issue).
- **New bottleneck exposed:** one bad row blanked the issues page (issues/closed/bugs/2026-08-19-one-bad-workstream-row-blanks-the-issues-page.md), leading to independent row parsing ("Rows parse independently").
- **Evidence:** 199 tracked files, 27,241 lines, 127 commits (shared table).
- **Outcomes:** In use; it hosts exhibits, comments, issue next-actions, schedule alerts, and the router itself since 2026-09-02. Judgment: became the human's single view across parallel streams.
- **Prior-art mention:** partial. dev/workstream-story.md mentions the issue browser indirectly; no page covers the app.

## Issue next-actions store (outside git)
- **One line:** the human's triage requests per issue (`discuss`, `reconfirm`, `do-it`, free text) live in a local store beside main, written from the issue browser without commits.
- **Lives in:** `~/src/dev-issue-actions/`, `workstreams-app/src/server/main/issue-next-actions.ts`, `bin/issues next-action`.
- **Appeared:** not traced to a single commit in this sweep (bin/CLAUDE.md section "Searching the issue queue").
- **Bottleneck relieved:** dev/workstream-story.md: "Next actions stay out of git, in a local store, so triage never makes commits."
- **New bottleneck exposed:** not visible.
- **Evidence:** store currently holds one `next-actions.json` (`find ~/src/dev-issue-actions -type f`).
- **Outcomes:** In use (feeds `bbx-issue-actions`). Not measured here.
- **Prior-art mention:** yes. dev/workstream-story.md "Triage is a priority plus a request".

## Document comments (`bin/comments`)
- **One line:** the human selects text in a rendered doc in the workstreams app and leaves a typed or spoken comment; it is stored outside git, routed to a workstream, read and cleared by that workstream's agent.
- **Lives in:** `bin/comments`, `bin/comments.ts`, `workstreams-app/src/server/comments-service.ts`, `workstreams-app/src/shared/comments.ts`, store `~/src/dev-comments/`, `beebox/docs/plans/document-comments.md`, root CLAUDE.md "At pickup run `bin/comments list --workstream <name>`".
- **Appeared:** 2026-08-22 31545f15f "feat(comments): the document-comment store and bin/comments".
- **Bottleneck relieved:** plan job statement: "When I am reading a plan document an agent wrote ... and I disagree with one paragraph of it, I want to say so at that paragraph ... so the next agent that opens this document knows exactly which claim I objected to without me re-explaining it in chat."
- **New bottleneck exposed:** comments on untracked files can outlive a culled workstream and reappear when the name is reused (bin/CLAUDE.md). Related ask (issues/closed/features/2026-08-22-file-asks-agent-flagged-attention.md) for agents to flag a file without an exhibit, resolved by `bbx notify`.
- **Evidence:** Claude sessions with a Bash call `bin/comments list`: 65; `bin/comments clear`: 1 (`grep -l '"command":"[^"]*bin/comments list' ~/.claude/projects/*beebox*/*.jsonl | wc -l`). Store currently empty (`~/src/dev-comments/.dev-comments` is 0 bytes).
- **Outcomes:** The pickup check runs in about a quarter of recent Claude sessions (65/276). Judgment: low `clear` count from Claude suggests either few comments in the window or that clearing happens elsewhere (Codex or the app); not verified. Plan status is still `active`.
- **Prior-art mention:** no.

## Exhibits (`bin/exhibits`, one ask per item)
- **One line:** an agent publishes a labeled page (doc, screenshots with figure labels, or a small interactive page) to a per-workstream store that survives culls, with exactly one ask: `decide`, `confirm`, `react`, or `fyi`.
- **Lives in:** `bin/exhibits`, `workstreams-app/docs/exhibits.md` (213 lines), `workstreams-app/src/server/exhibits/`, `workstreams-app/src/frontend/exhibits/`, store `~/src/workstream-exhibits/<workstream>/`, `beebox/docs/plans/workstream-exhibits.md`, root CLAUDE.md "Record and show work".
- **Appeared:** 2026-08-15 3e3ae0def "docs(exhibits): the page contract for agents writing exhibits"; 2026-08-15 10ad95b6a "feat(exhibits): bin/exhibits CLI, conventions, and discoverability (Track D)"; 2026-08-15 2b15809ce ask queue at `/workstreams/asks`.
- **Bottleneck relieved:** plan: "Chat is the wrong medium for much of what agents produce: it is ephemeral, text-first, and feedback only lands if the developer is present at that moment."
- **New bottleneck exposed:** asks answered outside the container leave no record (see Outcomes); doc overstated container chrome (issues/closed/docs-and-chores/2026-08-22-exhibits-doc-overstates-container-chrome.md).
- **Evidence:** 128 exhibits (`find ~/src/workstream-exhibits -maxdepth 3 -name exhibit.json | wc -l`) across 217 workstream dirs; by ask type fyi 65, react 35, confirm 20, decide 8; by month 2026-08: 12, 09: 85, 10: 31. Answered through the container: 4 `disposition.json`, 3 disposition events in 5 `events.jsonl` files. 19 exhibits have their own `index.tsx`/`index.html`. Claude sessions with a Bash call `bin/exhibits add`: 32.
- **Outcomes:** In use: 128 exhibits in about 8 weeks. Only 4 have a recorded in-app answer, and half the asks are `fyi`. Judgment: exhibits work as a durable display medium; the answer loop through the page is little used, and answers most likely return through chat.
- **Prior-art mention:** no.

## CODING_FEEDBACK retrospective notes (`bin/coding-feedback`)
- **One line:** agents write short retrospective notes at four checkpoints (plan-reviewed, implemented, review-adjudicated, landed) into the exhibits store, outside git, for later retrospective scans.
- **Lives in:** `bin/coding-feedback`, `bin/coding-feedback.ts`, `~/src/workstream-exhibits/<workstream>/coding-feedback/`.
- **Appeared:** 2026-10-07 b8fc4b1aa "CODING_FEEDBACK: retrospective notes at plan, implement, review, and landing".
- **Bottleneck relieved:** process lessons from parallel sessions were lost when sessions ended.
- **New bottleneck exposed:** not visible yet.
- **Evidence:** 54 entries in two days (`find ~/src/workstream-exhibits -path '*coding-feedback/*' -type f | wc -l`).
- **Outcomes:** Too new to judge; 54 notes written since 2026-10-07.
- **Prior-art mention:** no.

## Finish skill, finish agent, `bin/finish-preflight`, `bin/finish-verify`, `bin/land`
- **One line:** when the human says finish, a headless subagent merges main into the worktree, runs the checks named by a preflight decision sheet, reconciles plan docs, closes resolved issues, and lands with a checked `--no-ff` merge; it stops BLOCKED on anything needing a human.
- **Lives in:** `.claude/skills/finish/SKILL.md` (75 lines), `.claude/agents/finish.md` (171 lines), `bin/finish-preflight` + `bin/finish-preflight.ts` + `bin/finish-preflight-lib.ts`, `bin/finish-verify` + `bin/finish-verify.ts`, `bin/land` (252 lines), `bin/doc-lifecycle-check.ts`.
- **Appeared:** 2026-05-26 6babebd70 "Add /finish skill + SessionEnd auto-cleanup of merged worktrees". Reshaped: 2026-07-03 42d39875c "chore(claude): run /finish in a subagent; show model in status line"; 2026-08-08 9786e4895 "feat(bin): add `land` — fast-forward a finished worktree branch onto main"; 2026-08-24 a0093e2ba "bin/land: merge --no-ff instead of --ff-only"; 2026-08-25 803ff20fa "feat(finish): scripts for the landing, and a 150-line agent file".
- **Bottleneck relieved:** landing many parallel branches by hand, with merge and test churn in the main chat thread (agent description: "so the merge and test churn stays out of the main chat thread"). dev/workstream-story.md: "The workstream's records get settled *before* the worktree becomes disposable."
- **New bottleneck exposed:** the agent file grew to 624 lines by 2026-08-08 (9bedffeba) before mechanics moved into scripts (165 lines at 2026-08-30 90b581539); full-suite runs under parallel load timed out (issues/closed/bugs/2026-08-25-webapp-auth-doctests-timeout-under-extreme-parallel-load.md: "11 concurrent `pnpm test`/`pnpm lint` processes from sibling worktree sessions").
- **Evidence:** finish agent line counts by commit: 175 (07-03), 292 (07-19), 532 (08-01), 624 (08-08), 165 (08-30), 171 (10-07) (`for c in $(git log --follow --format=%h -- .claude/agents/finish.md); do git show $c:.claude/agents/finish.md | wc -l; done`). Skill 25 commits, agent 34 commits. 520 worktree merges on main since `--no-ff` (2026-08-24). dev/skills-review-2026-10.md: finish typed in 128 sessions; "`land` or finish-preflight refused 53/20 — by design". Claude sessions with a Bash call to `bin/land`: 35; `bin/finish-preflight`: 12.
- **Outcomes:** In use; the most-typed skill. It is the landing path for the 520 merges since 2026-08-24. 53 `land` refusals and 20 preflight refusals stopped landings that did not meet preconditions (skills-review). Moving mechanics into scripts cut the agent file from 624 to 165 lines.
- **Prior-art mention:** yes. dev/workstream-story.md "`/finish` is how work comes back"; dev/agent-knowledge.html ("ship" step, 104 slash); dev/skills-review-2026-10.md (keep; flake policy contradiction noted).

## Commit provenance trailers (`bin/commit-provenance.ts`)
- **One line:** git hooks stamp `Workstream:` (and `Plan:` when exactly one plan declares the workstream) on worktree commits; `Issue:` trailers are validated against public issue basenames; a CLI queries commits by workstream, plan, or issue.
- **Lives in:** `bin/commit-provenance.ts`, `bin/commit-provenance.test.ts`, `.husky/prepare-commit-msg`, `.husky/commit-msg`, `bin/docs/commit-guards.md`, `beebox/docs/implemented-plans/commit-provenance-trailers.md`.
- **Appeared:** 2026-08-24 685bc1d48 "docs(plans): commit provenance trailers plan"; 2026-08-24 e00c5dcca "feat(bin): commit provenance trailers (Workstream/Plan/Issue)".
- **Bottleneck relieved:** issues/closed/features/2026-08-20-no-way-to-know-what-a-workstream-covers.md, closed note: "`pnpm commit-provenance --workstream <name>` lists every commit a stream produced."
- **New bottleneck exposed:** a nonexistent `Issue:` name blocks a commit; private issues must never be named.
- **Evidence:** 2800 `Workstream:` (181 distinct), 1245 `Plan:` (175 distinct), 1283 `Issue:` (434 distinct) on main; 2196 of 2721 non-merge main commits since 2026-08-24 carry `Workstream:` (`git log main --since=2026-08-24 --no-merges --format=%B%x00 | tr '\0' '\n' | grep -c '^Workstream:'`). By month: 08: 469, 09: 1660, 10: 570. Note: `Issue:` trailers appear before e00c5dcca (earliest 2026-08-01 45c360490), so that convention predates the hook. Claude sessions running `commit-provenance --`: 3.
- **Outcomes:** About 81% of non-merge main commits since introduction are attributed to a workstream. Querying is rare from Claude (3 sessions); `bbx-issue-actions` queries `Issue:` first (2026-08-24 ae8f9779c). Judgment: the data is mostly consumed by tooling and retrospectives (including this inventory) rather than ad hoc.
- **Prior-art mention:** no.

## Manual-testing pins and `confirm-tested`
- **One line:** an issue that landed but needs a human to try it carries `needs: [manual-testing]`; this pins the workstream's test box against culling until the human confirms, and `confirm-tested` clears it on main.
- **Lives in:** `issues/CLAUDE.md`, `bin/confirm-tested.ts`, `bin/workstreams confirm-tested`/`release`, `workstreams-app/src/frontend/pages/TestingPage.tsx`.
- **Appeared:** 2026-07-19 7bf895a48 "issues: add needs: [manual-testing], and de-XML the card-prominence issue"; 2026-08-09 fd1299085 "Add manual testing workflow"; 2026-08-09 c462271d9 "Pin workstreams with testing state"; 2026-08-09 6c97db73b "docs(plans): Track G — the manual-testing flow".
- **Bottleneck relieved:** "Merged + needs verification — the code is on `main`; the worktree has nothing unique about it. Nothing to resume; you only need a record of what to check." (2026-08-08 redesign issue).
- **New bottleneck exposed:** pinned trees accumulate while waiting on the human (238 sweep skips for pins in 40 days).
- **Evidence:** 25 open issues need manual testing (`git grep -l manual-testing -- 'issues/*.md' ':!issues/closed' | xargs grep -l '^needs:.*manual-testing' | wc -l`); 68 issues have ever carried the line, in 96 commits (`git log main --format=%h -G'^needs:.*manual-testing' -- issues | wc -l`); 238 pin skips in the cleanup log.
- **Outcomes:** In use: 68 issues routed through it, 25 still waiting. Could not verify how many were cleared by `confirm-tested` versus by hand (no distinctive commit subject found).
- **Prior-art mention:** yes. dev/workstream-story.md "The life of an issue" (manual-testing pins the test setup).

## Private-issues shadow repo (mechanism only)
- **One line:** a separate gitignored repository mounted by symlink at `private-issues/`, with a matching private worktree per public worktree, holds issues with private content; public files never link into it.
- **Lives in:** `bin/private-issues`, `bin/CLAUDE.md` "Private-issues shadow repo", `issues/CLAUDE.md`, `beebox/docs/implemented-plans/private-issues-shadow-repo.md`.
- **Appeared:** 2026-08-01 1f9a650cb "private-issues: shadow repo, lifecycle wiring, doc-check guard".
- **Bottleneck relieved:** parallel agents filing issues in a public repo had nowhere to put private specifics; the mechanism keeps one issue workflow for both. Cleanup "removes a private worktree only when merged and strictly clean, otherwise preserving and reporting an orphan."
- **New bottleneck exposed:** every worktree now has a second worktree to tear down; orphan reporting.
- **Evidence:** 79 `SessionEnd private-issues result=removed` lines in the 40-day cleanup log (`grep -c 'private-issues result=removed' ~/.cache/beebox/worktree-cleanup.log`). Contents not read.
- **Outcomes:** In use, wired into lifecycle teardown. Not measured further (contents off limits).
- **Prior-art mention:** no.

## `/dev/` pages served by the router, doc browser, `dev/tools.json`
- **One line:** tracked HTML and rendered Markdown in each checkout's `dev/` are served at `/<worktree>/dev/` without cold-starting the worktree, with a doc browser and tool cards declared in `dev/tools.json`.
- **Lives in:** `dev/README.md`, `dev/tools.json` (1 tool), `workstreams-app/src/router/` (router-docs, router-markdown, router-doc-browser).
- **Appeared:** 2026-06-23 0c180c857 "feat(dev): add the /dev/ visualization space + markdown doc browser". Reshaped: 2026-06-30 5f6d8565a "VS-Code-style Cmd-P quick-open in the doc browser"; 2026-07-24 4f7c88a68 "router: declare per-worktree /dev/ tool cards via dev/tools.json"; 2026-08-19 30400a662 "fix(dev-router): remove the /dev sandbox CSP — normal HTML and markdown just work".
- **Bottleneck relieved:** reviewing a worktree's docs and visualizations without starting its servers.
- **New bottleneck exposed:** scripted apps under `/dev/` needed a separate origin (issues/closed/features/2026-07-24-dev-scripted-apps-separate-origin.md), which fed into exhibits.
- **Evidence:** `dev/tools.json` 5 commits; `dev/` holds 12 HTML/MD pages at top level (`ls dev | grep -cE "\.(html|md)$"`).
- **Outcomes:** In use; dev/workstream-story.md, meta-practices.html and agent-knowledge.html are served this way. Interactive pages moved to exhibits or `dev/apps/`.
- **Prior-art mention:** no.

## Path-scoped commits for multiple agents in one worktree
- **One line:** agents sharing a worktree commit with `git add <paths> && git commit -- <paths>` (or `stageAndCommitPaths`) and work in different packages, since a bare commit can capture another agent's staging.
- **Lives in:** `bin/CLAUDE.md` "Commit safety" and "Multiple agents sharing one worktree".
- **Appeared:** 2026-07-09 f01f36084 "docs(worktrees): document the path-scoped-commit convention; close the parallel-agent race issue".
- **Bottleneck relieved:** issues/closed/bugs/2026-07-06-parallel-agent-git-commit-race.md: "`git add <my-files>` followed by `git commit` is not atomic across processes".
- **New bottleneck exposed:** pre-commit typecheck covers a whole package, so parallel agents in one worktree must split by package.
- **Evidence:** the fix swept "~31 stage→commit sites" (issue text).
- **Outcomes:** Closed the issue; still the rule. Judgment: intra-worktree parallelism stayed a secondary mode.
- **Prior-art mention:** no.

## Machine-wide test semaphore and host-pressure gate
- **One line:** whole-tree test, lint, and typecheck runs take one of two machine-wide slots (a `careful` tier takes both), and the scheduled full suite defers when the host is swapping.
- **Lives in:** `bin/test-locks.ts`, `bin/with-slot.ts`, `bin/host-pressure.ts`, `schedules/full-suite/`.
- **Appeared:** 2026-08-25 40411eb35 "feat(test-ledger): machine-wide run semaphore, two slots"; 2026-08-25 6e565471b "perf(tooling): lint what the change implicates, cache what it doesn't" (with-slot); 2026-09-11 b47af3add "full-suite: gate on memory pressure, defer instead of running loaded".
- **Bottleneck relieved:** host contention from parallel worktrees. `bin/with-slot.ts` header: "six concurrent whole-tree eslint runs in one worktree took 29–51 minutes each against a solo minute." issues/closed/bugs/2026-08-25-webapp-auth-doctests-timeout-under-extreme-parallel-load.md: load averages 19.82/39.93/37.11 with 11 concurrent test/lint processes.
- **New bottleneck exposed:** `bin/host-pressure.ts` header: "load looked quiet at times while 18GB of swap was in use"; open issues/bugs/2026-10-06-full-suite-does-not-recheck-host-during-run.md and issues/bugs/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md.
- **Evidence:** see the testing sweep for ledger numbers.
- **Outcomes:** In use. Judgment: the parallelism ceiling moved from git/process conflicts to machine memory; the swap anecdote recurs (20 GB in 2026-08-08, 18 GB in 2026-09-11).
- **Prior-art mention:** no.

## Port isolation for tests across worktrees
- **One line:** tests bind non-default ports so concurrent `pnpm test` in sibling worktrees does not collide.
- **Lives in:** beebox tests (e.g. `beebox/test/hub.e2e.doctest.md`).
- **Appeared:** fix recorded in issues/closed/bugs/2026-08-14-hub-e2e-fixed-default-port-collides-across-worktrees.md (closed 2026-08-14).
- **Bottleneck relieved:** "Several worktree sessions run `pnpm test` concurrently on one machine as a matter of course, so two runs fought over one port and the loser hung for the full 120-second startup timeout."
- **New bottleneck exposed:** not visible.
- **Evidence:** one closed issue.
- **Outcomes:** Closed one bug. Minor.
- **Prior-art mention:** no.

## "Agents that show their work" (exhibits + comments + coding-feedback as one channel)
- **One line:** the stance that agent output for the human goes to a durable, addressable medium with an explicit ask, and human responses come back through a store the next agent reads.
- **Lives in:** root `CLAUDE.md` "Record and show work"; `beebox/docs/plans/workstream-exhibits.md`; `beebox/docs/plans/document-comments.md`.
- **Appeared:** the phrase itself is not in the repo (`grep -rni 'show their work'` finds only unrelated "show its work" uses in box docs and issues/features/2026-03-12-transcript-processing-labeled-subagents.md). The mechanisms: 2026-08-15 exhibits, 2026-08-22 comments, 2026-10-07 coding-feedback.
- **Bottleneck relieved:** human attention across many parallel streams; chat feedback "only lands if the developer is present at that moment" (exhibits plan).
- **New bottleneck exposed:** see exhibits outcome (few in-page answers).
- **Evidence:** see exhibits, comments, coding-feedback entries.
- **Outcomes:** Judgment: display side is used (128 exhibits); return side is thin in recorded data.
- **Prior-art mention:** no.

## Router retry and failure classification
- **One line:** a worktree that fails to start because the host was too busy is retried automatically (2s/8s/30s, three times), other failures park at once; the failure page says which.
- **Lives in:** `bin/docs/router-operations.md` "Startup failures and automatic retry"; `beebox/docs/implemented-plans/router-transient-failure-resilience.md`; `router.log` with `load1` stamps.
- **Appeared:** 2026-09-15 2a8d3fa75 "Plan dev-router transient-failure resilience".
- **Bottleneck relieved:** host load from parallel work parked worktrees as broken.
- **New bottleneck exposed:** not visible.
- **Evidence:** not counted.
- **Outcomes:** In use. Not measured.
- **Prior-art mention:** no.

---

## Summary

Found 24 techniques in this area. The chain visible in git and issues: worktrees + router (2026-05-26) made parallel sessions cheap; tabs then became the to-do list (issues/closed/features/2026-08-08-worktree-session-workflow-redesign.md, filed 2026-08-08 in 516ebbbe7, with the "~9 sessions, 20 GB of swap" anecdote; dev/workstream-story.md restates it). The fix was the workstream/worktree split, registry, culling, and manual-testing pins (2026-08-09), then the CLI seam for Codex (2026-08-04..08), the workstreams app (2026-08-13), exhibits (08-15), comments (08-22), provenance trailers and `--no-ff` landing (08-24), and finish scripts (08-25). The next limit was host capacity: test semaphores, swap gating, router retries.

Could not verify:
- Merge counts before 2026-08-24 undercount landings (fast-forward era), and the 2026-09-02 history rewrite may affect older shas.
- Whether `confirm-tested` or hand edits cleared manual-testing needs.
- How exhibit asks are actually answered (only 4 in-app dispositions).
- The cleanup log covers 2026-08-30..2026-10-09 only; Claude transcripts start 2026-08-10. Codex usage counts are inflated by AGENTS.md text, so I did not use them.
- The first commit for the issue next-actions store.
- Whether the 45 box clones vs 7 worktrees are orphans or `keep`-preserved.
