# Skills review, October 2026

Scope: the 24 skills under `.claude/skills/` (mirrored to `.agents/skills/` for Codex), the user-level skills in `~/.claude/skills/`, and what the transcripts say about how they are used. Usage data comes from `bin/skill-usage.ts` over 60 days (2026-08-08 to 2026-10-07): 228 Claude sessions plus 1,699 subagent transcripts, 492 Codex sessions plus 287 subagent rollouts. Counts are aggregate only.

Already done in this worktree (not yet landed): `browser-task` is a managed box skill installed by `bbx init`; the dev-repo copy is deleted.

## Reading the usage numbers

- The human types a skill name almost never. In Claude only `finish` (128 sessions), `bbx-pick-issues` (8) and `bbx-issue-actions` (4) were typed. Everything else is reached by an agent reading the description.
- Codex "agent invocations" are reads of the SKILL.md file, often in bulk (an agent reading ten skills at once). The "focused" count (session read at most 3 skills) is the honest Codex signal.
- Loaded-but-unused could not be shown. The proxy (session ends within 3 turns of the load, or the body loads twice) fires only for `finish`, which hands off to a subagent by design.
- Agent-written briefings used a bare `/finish` or `$finish` sigil in 61 Claude and 22 Codex sessions (114 for finish, 44 for cross-model), against the rule in the root CLAUDE.md.

| skill | lines | Claude sessions (agent invoked) | Codex focused sessions | last used | recommendation |
| --- | ---: | ---: | ---: | --- | --- |
| cross-model | 187 + 190 refs | 140 | 32 | 10-07 | shrink to ~130; runner prose becomes a script |
| finish | 75 | 35 (+129 typed) | 11 | 10-07 | keep; drop "checkpoint" from the description |
| browse | 83 + 251 refs | 51 | 9 | 10-06 | keep; fix 2 stale paths in references |
| bbx-plan | 134 + 175 template | 52 | 14 | 10-07 | keep; fix `--box` in TEMPLATE.md:146 |
| issues | 30 | 24 | 9 | 10-07 | keep |
| bbx-frontend | 229 | 12 | 1 | 10-07 | shrink to ~160; fix `useWSS` (line 67) |
| launch-worktree-session | 218 | 15 | 0 | 10-02 | shrink to ~140; settle the default engine (line 77 says Codex, memory says Fable/Opus) |
| knowledge-audit | 59 | 9 | 2 | 10-07 | merge into bbx-context |
| doctest | 64 | 6 (subagents) | 7 | 10-06 | merge with bbx-guide-testing (~80 lines total); fix flake paragraph (61-64) |
| bbx-authoring-schedules | 274 | 7 | 4 | 10-06 | shrink to ~120; mechanics already in `bin/docs/schedules.md`; says "four" schedules, there are 14 |
| bbx-context | 145 | 5 | 4 | 10-06 | shrink to ~80 and absorb knowledge-audit; fix lines 46, 118, 132 |
| security-report | 277 | 5 | 2 | 10-07 | keep (~240); script the surface-map existence check |
| bbx-ios-overlap | 75 | 4 | 5 | 10-06 | shrink to ~35; name the `mobile-contract-check` hook and `Contract-Unchanged:` trailer; drop the stale issue list |
| bbx-issue-actions | 232 | 1 (+4 typed) | 3 | 10-06 | shrink to ~110; lines 154-155 cite a finish.md protocol that no longer exists |
| bbx-guide-api | 38 | 3 | 0 | 10-05 | keep; fix path on line 19 |
| bbx-migration | 150 | 3 | 0 | 09-29 | keep; fix `_config/migrations.jsonl` (11) and `src/scripts/migrate` (48) |
| bbx-guide-schemas | 77 | 2 | 1 | 09-29 | keep; fix paths on lines 56 and 66 |
| bbx-pick-issues | 118 | 2 (+8 typed) | 2 | 10-06 | keep |
| bbx-guide-testing | 79 | 1 | 2 | 10-06 | merge with doctest; it duplicates the table in `beebox/docs/testing.md` and is staler |
| bbx-debug | 163 | 1 | 2 | 10-06 | keep at ~145; fix line 42 (no `/api/debug-log` route) and line 46; description: "flaky behavior outside a single doctest" |
| field-probe | 92 | 1 | 0 | 09-24 | keep; fix `content/.beebox/` to `.beebox/` (53, 61) |
| canvas-loop-sketch | 53 | 1 | 0 | 10-01 | keep; drop "data visualizations" from the description (collides with the harness `dataviz` skill) |
| bbx-codehealth | 211 | 0 | 1 | 09-12 | rewrite to ~120 or retire; see finding 1 |
| browser-task | 75 | 0 | 1 | 09-12 | done: moved to the product |

`bbx-debug`, the example in the brief: in Claude one agent invocation in one session, eight briefing mentions, never typed. Investigate-or-debug instructions appear in 31 Claude sessions, so the work exists and the skill does not fire for it. Its description has a negative clause ("Not needed for an obvious one-line bug") and no symptom keywords; a Claude session reasons from the listing and proceeds without loading it.

## Findings that change what to do

1. **bbx-codehealth contradicts a boxholder decision.** Lines 27-35, 154 and 204 call an `index.ts` re-export surface "the codehealth move the boxholder most wants"; `beebox/code-style.md:117` bans barrels (2026-07-12). It also re-runs what the `knip-sweep` and `supplemental-lint` schedules already run weekly, names the Claude-only `simplify` skill, and has zero Claude use. Rewrite or retire.
2. **The figure card repeats the browser-task mistake.** `beebox/src/schemas/figure.ts:180` and `box-docs/card-figure.md:142` tell box agents to "verify headlessly" through the canvas-loop authoring loop, which exists only in the dev-repo `canvas-loop-sketch` skill and is not resolvable from a box. Either ship a box-side render command plus managed skill, or remove the instruction from the figure guidance.
3. **finish fires on "checkpoint the work".** Memory records that finish means merge plus deploy. Remove or qualify the word.
4. **Stale box paths where diagnostics run.** `config/` is now `_config/` (bbx-context 46, bbx-migration 11, browse references 31); `content/.beebox/` is now `.beebox/` (field-probe 53, 61); `--box <box>` in bbx-context 132, bbx-debug 46 and the plan TEMPLATE 146 contradicts knowledge-audit's absolute-path rule, which exists because of a real tree-reset hazard.
5. **Flake policy contradicts finish.md.** doctest 61-64 and bbx-issue-actions 154-155 tell agents to rerun suites and file flake issues; `.claude/agents/finish.md` says never rerun to chase green and file no flake issue (`beebox/test/careful.txt` is the channel).
6. **Codex mirror drift.** The main checkout's `.agents/skills/` still holds three real directories from July (cb-prompt-review, codex, skill-creator); `generateSkillLinks` in `bin/lib/codex-skill-links.ts` prunes symlinks only. Claude-only frontmatter (`allowed-tools`) and the `simplify` reference are silently ignored under Codex.
7. **Descriptions are the whole trigger, and the listing has a budget.** Claude Code 2.1.293 caps the skills listing at 1% of context and drops descriptions of the least-invoked skills first; `/context` shows the post-budget size. With 24 repo skills plus the user-level and synced ones, the rarely used skills are the ones that lose their trigger text. `/skill-doctor` is feature-flagged and not available in this install, so `bin/skill-usage.ts` is the measurement.

## Proposed merges and shrinks

| change | lines now | budget |
| --- | ---: | ---: |
| bbx-guide-testing + doctest, pointing at the `docs/testing.md` instruments table | 143 | 80 |
| knowledge-audit into bbx-context, with the trimming playbook pointed at `box-docs/reducing-claude-md.md` | 204 | 100 |
| cross-model: runners to one script under `bin/` | 377 | 130 |
| bbx-authoring-schedules, bbx-issue-actions, bbx-ios-overlap, bbx-frontend, launch-worktree-session: mechanics to existing docs and scripts | 1,028 | 565 |

Optional: fold `issues` into `bbx-issue-actions` (262 to ~120). Not proposed: `issues` is the most-invoked small skill and its 30 lines are a pointer.

## Proposed new skills or scripts (from recurring instructions)

| pattern | sessions (Claude/Codex) | proposal |
| --- | --- | --- |
| deploy or prod state questions | 22/7 | `bin/deploy-status` (last deploy, health, pending migrations) plus a 15-line skill; no skill covers this today |
| harness blocked a foreground `sleep` | 104/0 | not a skill: one line in root CLAUDE.md pointing at the until-loop or Monitor pattern |
| worktree isolation guard retried | 137 events in 10 sessions | the guard's message should say what to do instead; agents retry the same command |
| missing file or directory, often `cd` to the old `callback-*` paths | 118/106 | stale briefings and memories; a one-time sweep of memory files and the launch briefing template |
| `land` or finish-preflight refused | 53/20 | by design; no change |
| make it shorter or simpler | 19/4 | covered by the harness `simplify` skill under Claude; nothing for Codex |

Rare in the window, so no action: stale Vite modules (0), better-sqlite3 rebuild (1), worktree launch race (1).

## User-level skills

Only cloudflare, wrangler and cloudflare-email-service fired at all (2, 2 and 1 sessions, all for `beebox/pub-worker`). agents-sdk ("MCP servers, chat applications, scheduled tasks, browser automation") and web-perf ("page is slow"; needs a chrome-devtools MCP server that is not configured) can fire on this repo's vocabulary and never usefully did. Proposal: move cloudflare, wrangler and workers-best-practices to a project scope near pub-worker; remove agents-sdk, durable-objects, sandbox-sdk, turnstile-spin, cloudflare-email-service, cloudflare-one, cloudflare-one-migrations and web-perf. The `synced/` bucket is the claude.ai account sync (13 Anthropic skills; only deep-research and pdf fired once each) and is managed at the account level.

## Outside ideas worth adopting

- **Trigger evals.** `claude plugin eval` runs prompt cases with free `tool_used: Skill` graders; it targets a skills-directory plugin (a `.claude-plugin/plugin.json` under `.claude/skills/`). A ten-case suite for the confusable clusters (debug / field-probe / testing / doctest; issues / pick-issues / issue-actions; finish / launch-worktree-session), with should-not-trigger prompts. Docs: code.claude.com/docs/en/plugin-evals.
- **Descriptions carry triggers, not workflow.** Anthropic's best-practices page and obra/superpowers' writing-skills agree on symptom keywords first; superpowers adds "never summarize the workflow, the agent follows the summary and skips the body". Lands in every description rewrite above.
- **Rules first in long skills.** After compaction only the first 5,000 tokens of an invoked skill are re-injected. Lands in finish, cross-model, security-report.
- **`context: fork` for report-producing skills.** cross-model, security-report, knowledge-audit and codehealth produce a report and their intermediate output is noise. finish already does this through its agent.
- **Hooks for must-run gates.** The "cross-model before done" rule is guidance only; a hook that checks for a review marker before `bin/land` would enforce it. Lands beside the existing husky hooks.
- **Blind brief, read-only reviewer, verify before reporting** (jensvanbellen/second-opinion, johnpsasser/codex-pr-review). Check cross-model against these four properties.
- **Pressure-test discipline skills** (superpowers writing-skills): run the scenario without the skill, record the rationalizations, write counters. The memory file already holds several ("dry-run only tests parse"). Lands in bbx-debug, doctest, finish.
- **A size lint** for skills: body under 500 lines, description under 1,024 characters, reference files one level deep. Lands in `bin/` next to the doc checks.

Rejected: large community collections, wholesale adoption of superpowers or similar sets, Beads for the backlog, third-party eval harnesses, auto-writing skills from conversations.

## Decisions for the boxholder

1. Which bundle to apply: hygiene only (findings 3-6 and the stale paths), hygiene plus merges and shrinks, or everything including new scripts and the user-level cleanup.
2. bbx-codehealth: rewrite or retire.
3. The figure card's headless-verify instruction: ship a box-side command or remove the line.
4. launch-worktree-session's default engine.
5. The 28-word raise of the always-loaded budget (ledger.yaml) for the new browser-task description, versus trimming elsewhere.
