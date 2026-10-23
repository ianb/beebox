---
title: "Knowledge audits cannot run with a plugin enabled, and several courseware audits test the wrong thing"
workstream: knowledge-audit-refresh
resolution: implemented
area: beebox
labels: [harness]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-knowledge-audit-refresh — full knowledge-audit rerun, 2026-10-22
---

**Closed:** implemented as a per-audit `plugins:` field (`beebox/src/dev/lib/box-audits/plugins.ts`), see `beebox/docs/implemented-plans/knowledge-audit-plugins.md`. Divergence: the build-a-course audit does not require a skill read.

`test1` activates only the recipe plugin. Courseware is off, so its 13 audits (tag `courseware` in `beebox/src/dev/knowledge-audits.yaml`) ran on 2026-10-22 against a box that has no course types and no courseware skill. Agents answered from the plugin's source under `node_modules/beebox/src/plugins/courseware/`. Several checks were loosened so that answers without the plugin pass (see the `Refresh (2026-10-22, Claude)` comments).

## Plugin-enabled audits

A fixture cannot enable a plugin. The runner writes fixtures after it regenerates docs (`beebox/src/dev/lib/box-audits.ts`, `beebox/src/dev/lib/test-runner/runner/run-test.ts`), so a fixture `box.json` does not produce the plugin's card docs or skill.

Options:

- A per-entry `plugins:` field. The runner activates those plugins, writes their schema and view stubs, and regenerates docs before the audit, then resets as it already does.
- A second test box with the plugin enabled, passed with `--box`.

## Courseware audits, by what they test

- **Plugin knowledge, valid only with courseware on:** `courseware-course-composition`, `-concept-map-edges`, `-concept-map-cycles`, `-progress-evidence`, `-exposition-plan`, `-lesson-plan`, `-material-convention`, `-lesson-vs-exposition`, `-good-concept-map`, `-bloom-steers-teaching`, `-run-a-course`. Most ask what a card type holds. That is recall of the card docs. Keep the ones that test a behavior (`-material-convention`, `-run-a-course`, `-concept-map-cycles`); consider cutting the rest.
- **Plugin off, valid in test1:** `plugins-discover`, `plugins-activate`. They test that the agent finds and offers an inactive plugin. Courseware is the only inactive plugin, so it is the only example.
- **A general rule shown through a course:** `agents-md-course-entry` tests which instruction file a scoped chat loads, but its example is a course. One run answered "a briefing card". Test the rule with a non-course directory, or move the entry to the plugin-enabled set.
- **Conflicts with the plugin-off answer:** `courseware-build-a-course` asks "teach me how chemical reactions work". With courseware off, `plugins-discover` expects the agent to notice that the box has no course type and offer the plugin. The 2026-10-22 check passes an answer that only asks the learner questions and ignores the plugin. It belongs in the plugin-enabled set, with its original `probe`/`courseware` check restored.
