# Knowledge-audit full rerun — 2026-10-22

All 414 box audits ran with Claude against copies of the `knowledge-audit-refresh`
worktree's test1 clone, in eight parallel shards. All 10 dev audits ran with
`--dev` (claude-opus-5-5). Codex did not run: the test box has no Codex key.
Each failure was rerun once to separate noise. The entries carry per-audit
`Refresh (2026-10-22, Claude)` comments; this page is the summary.

## Results

| | Box | Dev |
|---|---|---|
| First pass | 349 pass, 65 fail | 6 pass, 4 fail |
| Passed on rerun (noise or wording luck) | 30 | 3 |
| Failed twice or more | 35 | 1 |
| Failing after fixes | 3 (below) | 0 |

Still failing: `cooking-guide-awareness` and `cooking-follow-recipe-pattern`
(test1 has no cooking guide; [issue](../../../issues/decisions/2026-10-22-cooking-guide-audits-need-a-guide.md)),
and `speak-outcome-not-mechanics` (2 of 5 runs pass after the fix;
[reopened issue](../../../issues/bugs/2026-10-08-chat-agent-narrates-implementation-steps.md)).
Follow-up, 2026-10-23: the chat now folds lines written between steps into
the activity row ([plan](../plans/chat-progress-fold.md)), and the audit grades
the text the chat shows (`final_reply`); 3 of 4 runs pass.

## What the failures were

- **Plain words, literal checks.** Most consistent failures. The box agent
  now answers the boxholder in plain words ("its file", "a pointer",
  "following", "the session card"), and checks that required `.ics`,
  `email-outbound`, `bbx drive mount`, `two-way` or a filename failed on
  correct answers. These checks now test the outcome: a Bash command, a file
  read, or a regex that accepts the plain wording.
- **Stale answers.** `bbx upgrade` is `bbx engine upgrade`; the docs now give
  a no-agent watch (`changes-since`); the theme fallback is the system theme's
  default, not `plain`; test1's courseware plugin is off.
- **Runner environment.** The runner has no box server, no notification
  channel, and a linked engine outside the box. `bbx remind` needs
  `BBX_NOTIFY_FAKE=1`; `bbx drive` cannot run; fixture `@node_modules/beebox/…`
  imports load nothing. The three import audits (`box-screen-box-wide-pages`,
  `quick-chat-rubric-maintenance`, `migration-recovery-boundaries`) passed
  on a copy with a real `node_modules/beebox` directory. Recorded in
  [knowledge audits](../testing/knowledge-audits.md#running-it).
- **Runner crashes.** An agent that deleted its own working directory, or hit
  its turn limit, ended the whole run. Both now fail that one audit.

## Guidance fixes

| Audit | Gap | Fix |
|---|---|---|
| `agent-feedback-skill-opportunity` | The feedback skill reuses `_config/feedback/AGENTS.md`, whose "this directory" pointed at the skill folder; one run wrote its card there. | The text names `_config/feedback/` (`src/core/box/templates.ts`). |
| `health-inconclusive-meaning` | Agents read `?` as "could not tell whether it ran". | `bbx health` prints `inconclusive: work done, no verdict` (`src/cli/commands/health.ts`). |
| `gmail-rule-procedure` | Agents built a `bbx changes` watch and missed Gmail rules. | Scheduled-script instructions point at Gmail rules (`src/schemas/scheduled-script/instructions.ts`). |
| `speak-outcome-not-mechanics` | The opening line announced the build ("I'll build a card type"). | The chat prompt's bookkeeping rule covers the opening and gives an example (`src/core/chat/session/prompts.ts`). Openings are fixed; build-step lines between tool calls remain (issue reopened). |
| `landmarks-dont-create-quietly` | Asked for a landmark on a folder that did not exist, the agent created an empty folder and chose its label and emoji. Landmark curation covered only landmarks the agent proposes. | `docs/box/landmark-curation.md`: a request settles whether, not where or what; confirm, and do not create an empty folder. 3/3 after. |
| `dev-design-handoff` | The prompt let a session answer from the skill listing. | The prompt asks what the design opens with. |
