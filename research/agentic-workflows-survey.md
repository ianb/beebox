---
title: "Agentic coding workflows: practitioner reports surveyed"
date: 2026-10-07
status: snapshot
---

# Agentic coding workflows: practitioner reports

Dated snapshot, 2026-10-07. Scope: experience reports, "how I work" posts,
team write-ups and vendor practice guides about running coding agents. Skill
repositories are out of scope (see `external-skills-harvest.md`); Beads is
covered schema-by-schema in `beads-vs-issues.md`. "Secondary" marks a claim
read through someone else's summary because the primary was unreachable
(openai.com returned 403; the Cherny thread is on X).

Each item: source, practice, the author's evidence, disposition for this
repo. "Already done" names the existing thing.

## 1. Autonomy: how much to hand over

**1.1 Anthropic, "Measuring AI agent autonomy in practice" (Feb 2026; figures secondary via [The Decoder](https://the-decoder.com/ai-agents-are-thriving-in-software-development-but-barely-exist-anywhere-else-anthropic-study-finds/)).**
Full auto-approve rises from ~20% of sessions for new users to >40% after ~750 sessions; experienced users also interrupt more (~5% to ~9% of steps). Experts shift from approving each step to letting the run go and stepping in on failure. 99.9th-percentile turn length grew from <25 to >45 minutes, Sep 2025 to Jan 2026.
*Disposition: already done.* Managed worktrees run unprompted; the gates are `bin/finish-preflight`/`bin/land`, not per-step approval. No action.

**1.2 Simon Willison, ["Embracing the parallel coding agent lifestyle"](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/) (2025-10-05).**
YOLO mode only when no untrusted text can enter the context; riskier tasks go to cloud agents so a bad run has a bounded blast radius.
*Disposition: already done.* `box-work` skill, private-content rules in root `CLAUDE.md`, prod impersonation boundary. The research workstreams read the open web in bypass mode; the existing rule that fetched content is data covers it.

**1.3 Amp (Alex Kemper), ["Pave the road"](https://ampcode.com/notes/pave-the-road) (2026-08-10).**
"Isolation over permission, quick reversibility over careful review, parallelism over queues." Engineers push straight to main; >85% of commits come from cloud sandboxes ("orbs"); commit velocity +65% in the month after orbs launched.
*Disposition: already done.* Headless `finish` merges to main and deploys; worktrees plus per-worktree box clones are the isolation. Reject the "skip careful review" half: cross-model review stays required above small fixes.

**1.4 Mitchell Hashimoto, ["My AI adoption journey"](https://mitchellh.com/writing/my-ai-adoption-journey) (2026-02-05).**
Overnight triage agents were "NOT allowed to respond, I just wanted reports the next day." Agent notifications off: "it was my job as a human to be in control of when I interrupt the agent."
*Disposition: already done.* Filing an issue does not authorize implementation (`issues/AGENTS.md`); the dashboard and exhibits are pull, not push.

**1.5 Standing per-workstream autonomy (synthesis of 1.1-1.4).** None of the sources defines tiers; each person states the boundary per task ("report only", "commit", "land"). Here those grants live in scattered memory notes (land docs continuously; `/finish` means deploy).
*Disposition: later.* If more standing grants accrue, put one line in the `launch-worktree-session` briefing stating the run's ceiling (report / commit / land). Not now: it would be a second vocabulary beside exhibit asks.

## 2. Session length and compaction

**2.1 Thorsten Ball, ["How I use Amp"](https://ampcode.com/notes/how-i-use-amp) (2025-05-15).** New thread per distinct task; past ~100k tokens the model forgets early instructions or enters a "doom loop" of repeated failed fixes. Stage what works, discard the rest; build to throw away.
**2.2 Amp, ["Handoff (no more compaction)"](https://ampcode.com/news/handoff).** Compaction is lossy and encourages summary-of-summary threads (one thread compacted 68 times). Handoff drafts a new thread's prompt and file list from a stated goal; the user edits it.
**2.3 Claude Code docs, ["Best practices"](https://code.claude.com/docs/en/best-practices).** "After two failed corrections, /clear and write a better initial prompt incorporating what you learned." Compaction can be steered ("preserve the full list of modified files and test commands").
**2.4 HumanLayer, ["Advanced context engineering for coding agents"](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md) (Aug 2025).** Keep utilization at 40-60%; "intentional compaction" means distilling search/test noise into a research or progress file, then restarting from it.
**2.5 Boris Tane, ["How I use Claude Code"](https://boristane.com/blog/how-i-use-claude-code/) (2026-02-10).** Counter-report: one long session through research, plan and implementation, no degradation seen past 50%, because the plan file survives compaction and is re-read.
**2.6 Armin Ronacher, ["A year of vibes"](https://lucumr.pocoo.org/2025/12/22/a-year-of-vibes/) (2025-12-22).** "Discarding the paths that led you astray means that the model will try the same mistakes again."
*Disposition (2.1-2.6): adapt.* The repo already does the cross-session version: the launch briefing is a handoff, and plans are files. Two gaps: (a) failed approaches vanish at compaction because no file records them (see 3.4); (b) no stated restart rule. Land (b) as one sentence in root `CLAUDE.md` "Implement and verify": after two failed corrections on one problem, write what was tried to the plan or a scratch note and restart from it.

## 3. Plans: when, how big, how kept

**3.1 Boris Cherny, thread [x.com/bcherny/status/2007179832300581177](https://x.com/bcherny/status/2007179832300581177) (Jan 2026; via [InfoQ](https://infoq.com/news/2026/01/claude-code-creator-workflow/)).** Plan mode, iterate until the plan is right, then auto-accept; "Claude can usually one-shot it."
**3.2 Boris Tane (above).** `research.md` then `plan.md`; the human annotates the plan inline 1-6 rounds, "don't implement yet"; then one prompt runs it: "I want implementation to be boring." On a wrong turn, revert and narrow rather than patch.
**3.3 Claude Code docs (above).** "If you could describe the diff in one sentence, skip the plan."
*Disposition (3.1-3.3): already done.* `bbx-plan` has skip criteria and walkthrough rules; `bin/comments` is the inline annotation round.

**3.4 OpenAI cookbook, ["ExecPlans" / PLANS.md](https://developers.openai.com/cookbook/articles/codex_exec_plans).**
Plans for multi-hour Codex runs must keep four living sections, "not optional": Progress (timestamped checklist reflecting actual state), Surprises & Discoveries (with short evidence such as test output), Decision Log (decision, rationale, date), Outcomes & Retrospective. Validation lists commands plus expected output, phrased as observable behavior. Plans are self-contained for a novice reader. Claimed result: Codex working 7+ hours from one prompt.
*Disposition: adapt.* `bbx-plan/TEMPLATE.md` covers design-time sections (Failure modes, NOT in scope, Knowledge audits) but has no section the implementer updates while working. Add one section, "Execution log", holding surprises with evidence and decisions taken mid-implementation; `finish` reconciles it at landing (it already reconciles plan docs). Also add "expected output" to the template's verification wording.

**3.5 HumanLayer RPI (above); later QRSPI (secondary, [chensg substack](https://chensg.substack.com/p/beyond-vibe-coding-the-engineering)).** Monolithic plans reached ~1,000 lines and could not be reviewed; Horthy split them and went back to reviewing code because implementation drifted from plans.
*Disposition: already done.* Matches the "scope anchored to the incident" rule and the plan's "Smallest fix and budget" section. Evidence for keeping it.

**3.6 Harper Reed, ["My LLM codegen workflow atm"](https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/) (2025-02-16); Matt Pocock `grill-me`/`to-prd`/`to-issues` (skills, [mattpocock/skills](https://github.com/mattpocock/skills)).** One-question-at-a-time interview producing `spec.md`, then a prompt plan and `todo.md`.
*Disposition: reject* as a separate step. Design discussion with the boxholder already does this, and the boxholder prefers discussion to stay discussion until agreed.

## 4. Parallel agents and coordination

**4.1 Cherny (above).** 5 local sessions, each in its own checkout, plus 5-10 web sessions; 10-20% of sessions are abandoned.
**4.2 Peter Steinberger, ["Just talk to it"](https://steipete.me/posts/just-talk-to-it) (Oct 2025).** 3-8 Codex agents in one folder, no worktrees (one dev server, OAuth callback domains); a `/commit` command tells each agent to commit only its own files. About 20% of time is agent-run refactoring (dead code, duplication, splitting files, slow tests).
**4.3 Willison (1.2).** He can review and land one significant change at a time; parallel slots go to research, codebase explanations, small maintenance, and "scouting": give an agent a hard task with no intent to merge, to learn which files it touches.
**4.4 Hashimoto (1.4).** One agent at a time; last 30 minutes of the day starts research or triage agents; background agent runs 10-20% of the day.
**4.5 Ronacher, ["Agentic coding recommendations"](https://lucumr.pocoo.org/2025/6/12/agentic-coding/) (2025-06-12).** Shared state (ports, DB, Redis) is the limit; a process manager writes a pidfile and refuses a second dev server; all output also goes to a log file the agent reads.
**4.6 Amp, ["Putting an agent in an orb"](https://ampcode.com/notes/putting-an-agent-in-an-orb) (2026-07-02).** `ensure-dev-server.sh` reuses/restarts/starts; ports written to `.amp/dev-ports.json`; dev-only `/__dev/log-me-in/<email>` and `/__dev/preflight` (JSON readiness); browser console tagged into the server log; 41 directory `AGENTS.md` files. Login flows were the main blocker.
*Disposition (4.1-4.6): already done* for isolation and shared state: managed worktrees, the shared router, per-worktree box clones, `bin/doctor`, `bin/browse` auth. Scouting (4.3) is not done: *adapt*, see top-10. Abandonment rate (4.1): see 8.3.

**4.7 Cursor (Wilson Lin), ["Scaling long-running autonomous coding"](https://cursor.com/blog/scaling-agents) (2026-01-14).** Hundreds of agents. Lock files failed (held too long; 20 agents performed like 2-3); flat peers avoided hard tasks; an integrator role became a bottleneck. What worked: planners create tasks, workers ignore each other, a judge decides whether to continue, periodic fresh starts against drift. Models assigned by role.
**4.8 Nicholas Carlini (Anthropic), ["Building a C compiler with parallel Claudes"](https://www.anthropic.com/engineering/building-c-compiler) (2026-02-05).** 16 agents, ~2,000 sessions, ~$20k. Task claim = file in `current_tasks/` pushed through git. Test output kept to a few lines with `ERROR` + reason on one grep-able line; `--fast` runs a deterministic 1-10% sample that differs per agent. When every agent hit the same Linux-kernel bug, GCC was used as an oracle to split the failure. One agent ran `pkill -9 bash` and killed its own loop.
*Disposition (4.7-4.8): reject* the swarm structure for a one-person queue. Carlini's test-output rules are *already done* in spirit (`bin/test-select`, routine-success output behind debug).

## 5. Review

**5.1 Claude Code docs (above), "adversarial review step".** A reviewer prompted to find gaps "will usually report some, even when the work is sound"; tell it to flag only correctness or stated requirements.
*Disposition: already done.* `cross-model` skill plus the bounded-review-loops rule.

**5.2 Ronacher, ["The final bottleneck"](https://lucumr.pocoo.org/2026/2/13/the-final-bottleneck/) (2026-02-13); Willison, ["Your job is to deliver code you have proven to work"](https://simonwillison.net/2025/Dec/18/code-proven-to-work/) (2025-12-18) and [anti-patterns](https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/).** Human review does not scale with generation; the human stays accountable; do not hand others code or descriptions you have not read.
*Disposition: already done* as principle (boxholder merges via `finish`). The concrete aid is 5.3.

**5.3 Willison, ["Linear walkthroughs"](https://simonwillison.net/guides/agentic-engineering-patterns/linear-walkthroughs/) (2026).** The agent writes a step-by-step walkthrough of code it produced, pulling every snippet with `sed`/`grep`/`cat` rather than retyping, so excerpts cannot be hallucinated.
*Disposition: adapt.* For diffs above a size threshold, `finish` (or the cross-model run) emits a walkthrough exhibit with ask `fyi`, so the boxholder reads a guided path instead of a raw diff.

**5.4 Steinberger via [Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/the-creator-of-clawd-i-ship-code) (2026-01-28).** "I ship code I don't read"; PRs are "prompt requests"; architecture talk replaces code review.
*Disposition: reject.* Conflicts with the accountability rule above and with the boxholder's review of plans and exhibits.

**5.5 Ghostty [AI_POLICY.md](https://github.com/ghostty-org/ghostty) and vouch gate (Aug 2025-Jan 2026, secondary).** Contributors disclose tool use; unvouched PRs auto-close.
*Disposition: reject* for now; no outside contributors. Revisit if the repo takes external PRs.

## 6. Verification before "done"

**6.1 Cherny (above).** A feedback loop (bash command, tests, browser) improves final quality "2-3x"; every claude.ai/code change is checked in Chrome.
**6.2 Anthropic, ["Effective harnesses for long-running agents"](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (2025-11-26).** Failure modes: declaring victory early, marking features done without testing. Fixes: JSON feature list where agents may only flip `passes` ("unacceptable to remove or edit tests"; JSON chosen because models alter it less than markdown); each session runs an end-to-end smoke check first; browser automation caught what unit tests and `curl` missed.
**6.3 Kent Beck, ["Augmented coding: beyond the vibes"](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes) (2025-06-25).** Warning signs to stop the agent: loops, unrequested functionality, "cheating" by disabling or deleting tests.
**6.4 Willison, ["Agentic manual testing"](https://simonwillison.net/guides/agentic-engineering-patterns/agentic-manual-testing/) and "First run the tests" (2026).** Showboat's `exec` records the command and its real output into a markdown log, so the agent cannot write what it hoped happened. Start sessions by running the existing tests. A good test "should fail if the implementation is reverted."
**6.5 Claude Code docs (above).** "Have Claude show evidence rather than asserting success." Gates in rising strength: in-prompt, `/goal`, a Stop hook that blocks the turn until a script passes, a refuting subagent.
**6.6 Amp (Lewis Metcalf), ["Feedback loopable"](https://ampcode.com/notes/feedback-loopable) (2026-02-05).** Make a bug text-checkable: URL query parameters encode each repro; a headless CLI prints frame data the agent chooses.
**6.7 Birgitta Böckeler, ["Harness engineering"](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html) (2026-04-02).** Computational sensors (tests, lint) vs inferential (LLM review); silent sensors may mean weak detection; mutation testing as the coverage measure.
*Disposition (6.1-6.7):* doctests, `bin/browse`, `bin/finish-verify`, `bin/smoke`, `field-probe` are *already done*. Three gaps, *adopt/adapt*: (a) revert check: `finish-verify` runs newly added or changed doctests against the merge-base implementation and expects failure; (b) test-weakening guard: a pre-commit check that flags removed doctest blocks or added skips unless a commit trailer gives the reason; (c) evidence in reports: worktree final reports quote the commands run and their output tails, and `finish` checks the quoted commands match what `finish-verify` would select. A Stop hook is *later*: Ronacher (7.4) found hooks gave little, and `finish` already gates the merge.

## 7. Keeping instruction files small

**7.1 Hashimoto (1.4).** "Each line in that file is based on a bad agent behavior, and it almost completely resolved them all." Simple failures go to `AGENTS.md`; others get a tool (screenshot script, filtered test runner).
**7.2 Cherny (above).** CLAUDE.md ~2.5k tokens; team adds lessons during PR review by tagging `@claude`.
**7.3 OpenAI, ["Harness engineering"](https://openai.com/index/harness-engineering/) (Feb 2026; read via [Charlie Guo](https://www.ignorance.ai/p/the-emerging-harness-engineering) and Böckeler).** A large single AGENTS.md failed by crowding out task context; replaced with a short map into versioned docs; custom linters whose messages say how to fix; background "garbage collection" agents open PRs for stale docs. 3 engineers, ~1M lines, 3.5 PRs/engineer/day.
**7.4 Ronacher, ["Agentic coding things that didn't work"](https://lucumr.pocoo.org/2025/7/30/things-that-didnt-work/) (2025-07-30).** Most slash commands and hooks went unused; delete unused automations; automate only what you have done by hand several times; accept an automation only if three runs of the same task all come out acceptable.
**7.5 Steinberger (4.2).** ~800-line AGENTS.md, trimmed as models improve, no caps or shouting. **7.6 Claude Code docs.** Per line: "Would removing this cause Claude to make mistakes?"; emphasize at most one line; move always-rules to hooks.
**7.7 Jesse Vincent, ["Superpowers"](https://blog.fsck.com/2025/10/09/superpowers/) (2025-10-09).** Skills tested like code: quiz questions were passed too easily, so he moved to subagent pressure scenarios (time pressure, sunk cost) and strengthened wording after each failure.
*Disposition (7.1-7.6): already done.* Compact-instructions rule, `bin/skill-lint`, `bin/skill-usage` (usage and recurring human instructions from transcripts), `agent-docs-refresh`, `knip-sweep`, remediation-style messages in `personal-vibe-check/rules/`. 7.7 is not done for dev-repo guidance: `knowledge-audit` covers box agents only. *Adapt*, see top-10.

## 8. Measuring whether a practice helps

**8.1 Anthropic, ["Agentic coding and persistent returns to expertise"](https://www.anthropic.com/research/claude-code-expertise) (2026-06-16).** 400k sessions. Users make ~70% of planning decisions and ~20% of execution decisions. Verified success: novice 15%, intermediate+ 28-33%; novices abandon troubled sessions 19% vs 5-7%.
**8.2 Built-in `/insights` (secondary, [Artem Zhutov](https://artemxtech.substack.com/p/3-claude-code-skills-that-make-claude)).** Reads 30 days of transcripts; one user found 46 "wrong approach" cases where the agent acted before direction was approved; suggests monthly runs.
**8.3 Cherny's 10-20% abandonment (4.1); Amp's +65% commit velocity (1.3).** Both are outcome counts the tooling already has.
*Disposition: adapt.* (a) Build the open issue `issues/features/2026-05-28-retrospective-session-scan.md` (corrections, repeated tool errors, clarifying questions), starting from `bin/skill-usage`'s transcript scanner and run as a monthly schedule; (b) dashboard shows per-month worktrees landed vs culled unmerged and median time to land.

## 9. Agent-native process

**9.1 Steve Yegge, ["Introducing Beads"](https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a) (2025-10-13); "land the plane" (secondary, [paddo.dev](https://paddo.dev/blog/beads-memory-for-coding-agents)).** Session-end routine: update issues, clean git state, remove debug artifacts, then emit a ready-to-paste prompt for the next session from the highest-priority unblocked work.
*Disposition: already done* except the last step: `SessionEnd` hook tears down merged worktrees; `bbx-pick-issues` chooses work. *Adapt:* a BLOCKED `finish` result ends with a draft next-session briefing. Low priority.
**9.2 Ronacher (2.6).** Wants version control that keeps prompts and failed attempts.
*Disposition: already done* in part: commit trailers carry `Claude-Session` URL, `Workstream`, `Plan`, `Issue`.
**9.3 Greg Brockman, "agents captain" per team ([x.com/gdb](https://x.com/gdb/status/2019566641491963946), secondary).** *Reject:* solo developer.
**9.4 Geoffrey Huntley, ["Ralph"](https://ghuntley.com/ralph/) (2025-07-14).** `while :; do cat PROMPT.md | claude-code; done`; one item per loop from `fix_plan.md`; tests as backpressure; failures (placeholder implementations, `rg` false negatives causing duplicate code) are fixed by adding a "sign" to the prompt. Suited to greenfield.
*Disposition: reject* for feature work (brownfield, review-gated). The scheduled sweeps are the bounded form of it here.
**9.5 Hashimoto, ["Vibing a non-trivial Ghostty feature"](https://mitchellh.com/writing/non-trivial-vibing) (2025-10-11).** 16 sessions, $15.98, ~8 hours. Four sessions failed on one bug, so he changed the design; one backend session was thrown away. Dedicated "anti-slop" cleanup sessions after the feature worked. Ends by asking the agent what he might be missing.
*Disposition: adapt.* A cleanup pass on the branch before `finish` (dead code, docs, naming), as a step in the launch briefing rather than a new skill. Overlaps `/simplify`; check that first.

## Top 10 ideas not already present, ranked

1. **Execution log in plans** (OpenAI ExecPlan, Ronacher 2.6): add a living "Execution log" section (surprises with evidence, mid-course decisions) to `.claude/skills/bbx-plan/TEMPLATE.md`; `finish` reconciles it.
2. **Revert check for new tests** (Willison 6.4, Beck 6.3): `bin/finish-verify` runs added/changed doctests against the merge-base code and requires them to fail.
3. **Test-weakening guard** (Anthropic 6.2, Beck 6.3): pre-commit flags deleted doctest blocks and new skips unless a trailer gives a reason.
4. **Evidence, not assertion, in final reports** (Claude docs 6.5, Showboat 6.4): worktree reports quote commands run with output tails; `finish` cross-checks them against its selection.
5. **Retrospective session scan** (Hashimoto 7.1, `/insights` 8.2): build the existing 2026-05-28 issue on `bin/skill-usage`'s scanner; monthly schedule; human-reviewed digest.
6. **Pressure tests for dev-repo skills** (Vincent 7.7): scenario runs with and without a skill in a subagent; the dev-repo counterpart of `knowledge-audit`.
7. **Linear walkthrough exhibit for large diffs** (Willison 5.3): emitted by `finish` or `cross-model` above a size threshold, ask `fyi`.
8. **Scouting runs** (Willison 4.3): a throwaway worktree attempt at a hard task, never landed, whose touched-files report feeds the plan's "What already exists".
9. **Two-failed-corrections restart rule** (Claude docs 2.3, Ball 2.1, Amp 2.2): one sentence in root `CLAUDE.md`; write tried approaches down, restart from the note.
10. **Outcome metrics on the dashboard** (Cherny 4.1, Amp 1.3): worktrees landed vs culled unmerged per month, median time to land.

## Rejected

- Swarm coordination with locks, planners and judges (Cursor 4.7, Carlini 4.8, Gas Town): built for hundreds of agents on one target; one person's queue does not need it, and Cursor reports locks failed.
- Shipping unread code / PRs as "prompt requests" (Steinberger 5.4): conflicts with human accountability for what deploys.
- Ralph loops for feature work (Huntley 9.4): greenfield-oriented; the review gate here is the point.
- Shared-folder parallel agents (Steinberger 4.2): box clones and the router already make worktrees cheap; shared folders reintroduce commit collisions.
- Separate interview/spec step (Reed, Pocock 3.6): duplicates design discussion with the boxholder.
- Contributor disclosure and vouch gates (Ghostty 5.5), "agents captain" (Brockman 9.3): no outside contributors or team.
- Autonomy tier vocabulary now (1.5): would add a second vocabulary beside exhibit asks; revisit if standing grants multiply.
