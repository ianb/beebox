# gstack skills — index & status

See [README.md](README.md) for the status legend.

## Planning & persona prompts

| Skill | Status | Reaction / notes |
|---|---|---|
| [office-hours](https://github.com/garrytan/gstack/blob/main/office-hours/SKILL.md) | `try` | YC-style "demand reality" interrogation. Want to experiment, but not committed — I'm not building a YC company. |
| [plan-ceo-review](https://github.com/garrytan/gstack/blob/main/plan-ceo-review/SKILL.md) | `try` | Similar caveat to office-hours. Curious whether "challenge premises, separate right-problem from sound-tech" generalizes outside startup framing. |
| [plan-eng-review](https://github.com/garrytan/gstack/blob/main/plan-eng-review/SKILL.md) | `integrate (parts)` | Read — see [notes/plan-eng-review.md](notes/plan-eng-review.md). Adopting: stated-preferences-as-review-spine (→ callback `engineering-principles.md`), failure-modes table format, user-flow edge-cases checklist. Rejecting: 8-files scope gate (Ian uses AI for giant changes deliberately), Cognitive Patterns (feels like superstition), numeric confidence. Parked: TODOs format, ASCII coverage diagram, diagram maintenance, dual effort scale. |
| [plan-design-review](https://github.com/garrytan/gstack/blob/main/plan-design-review/SKILL.md) | `reference` | Dimension-rated scorecard, 0-10. Compare against any design review we do. |
| [plan-devex-review](https://github.com/garrytan/gstack/blob/main/plan-devex-review/SKILL.md) | `skip` | Devex doesn't really apply — unclear who "the developer" is for callback. |
| [plan-tune](https://github.com/garrytan/gstack/blob/main/plan-tune/SKILL.md) | `skip` | Question sensitivity tuning, v1 observational only. |
| [autoplan](https://github.com/garrytan/gstack/blob/main/autoplan/SKILL.md) | `skip` | Read — see [notes/autoplan.md](notes/autoplan.md). Pipeline too heavy and doesn't match callback's process. Parked. Component ideas (dual voices, decision taxonomy, restore point) noted separately for possible future use. |
| [retro](https://github.com/garrytan/gstack/blob/main/retro/SKILL.md) | `reference` | Weekly retrospective from commits + work patterns. |

## Code review & shipping

| Skill | Status | Reaction / notes |
|---|---|---|
| [review](https://github.com/garrytan/gstack/blob/main/review/SKILL.md) | `skip` (mine ideas) | See [notes/ship-pipeline.md](notes/ship-pipeline.md). Too dense to adopt as a unit. Keep individual ideas: verification gate (citation discipline), scope drift check, red team subagent, specialist checklists (`review/specialists/*.md`). Reject: numeric confidence levels — prefer prose reasoning. |
| [ship](https://github.com/garrytan/gstack/blob/main/ship/SKILL.md) | `skip` (mine ideas) | See [notes/ship-pipeline.md](notes/ship-pipeline.md). Pipeline too heavy. Keep: merge-base-before-tests, Review Readiness Dashboard concept (track stale reviews against commit hash). |
| [land-and-deploy](https://github.com/garrytan/gstack/blob/main/land-and-deploy/SKILL.md) | `skip` (mine ideas) | See [notes/ship-pipeline.md](notes/ship-pipeline.md). Keep: first-run dry-run with hash-detect re-validation, persona-driven voice experiment. |
| [cso](https://github.com/garrytan/gstack/blob/main/cso/SKILL.md) | `try` | Security audit (STRIDE + OWASP), dual-mode daily/comprehensive. Worth running once on beebox. |
| [review specialists](https://github.com/garrytan/gstack/tree/main/review/specialists) | `reference` | Sub-prompts: api-contract, data-migration, maintainability, performance, red-team, security, testing. Worth raiding individually. |
| [landing-report](https://github.com/garrytan/gstack/blob/main/landing-report/SKILL.md) | `skip` | Read — see [notes/landing-report.md](notes/landing-report.md). Solves VERSION-number collisions across parallel Conductor workspaces (5-10 at once). Not our situation. Three small transferable ideas: shared-resource-on-branches needs queue awareness, "active sibling" 3-signal heuristic, show-the-choice-space pattern. |
| [codex](https://github.com/garrytan/gstack/blob/main/codex/SKILL.md) | `integrate` | Read — see [notes/codex.md](notes/codex.md). Codex CLI + subscription already in place. Plan is a minimum-viable port (three modes, filesystem boundary, DIFF delimiters, forced synthesis line) — skip the gstack preamble, JSONL parser, and session continuity for v1. Not executing yet. |

## QA / browser

| Skill | Status | Reaction / notes |
|---|---|---|
| [qa](https://github.com/garrytan/gstack/blob/main/qa/SKILL.md) | `reference` | Standard QA + fix loop. Compare against our QA story. |
| [qa-only](https://github.com/garrytan/gstack/blob/main/qa-only/SKILL.md) | `reference` | Report without fixing. |
| [browse](https://github.com/garrytan/gstack/blob/main/browse/SKILL.md) | `reference` | Headless QA browser cheatsheet (911 lines). |
| [scrape](https://github.com/garrytan/gstack/blob/main/scrape/SKILL.md) | `tbd` | Read — see [notes/scrape-skillify.md](notes/scrape-skillify.md). Pattern is great; requires gstack's `$B` browser daemon as infrastructure. Likely not worth porting wholesale; keep as a reference pattern. |
| [skillify](https://github.com/garrytan/gstack/blob/main/skillify/SKILL.md) | `tbd` | Partner to `scrape`. Same notes. |

## Design

| Skill | Status | Reaction / notes |
|---|---|---|
| [design-shotgun](https://github.com/garrytan/gstack/blob/main/design-shotgun/SKILL.md) | `tbd (mine ideas)` | Read — see [notes/design-shotgun.md](notes/design-shotgun.md). Skill itself probably skip (heavy `$D`/`$B` infrastructure, callback isn't visual-design-bottlenecked). Three ★★★ ideas worth keeping standalone: concept-before-expensive-generation, anti-convergence swap-test, anti-shortcut rules with named failure modes. |
| [design-review](https://github.com/garrytan/gstack/blob/main/design-review/SKILL.md) | `reference` | Visual QA + fix loop. |
| [design-consultation](https://github.com/garrytan/gstack/blob/main/design-consultation/SKILL.md) | `tbd (mine ideas)` | Read — see [notes/design-consultation.md](notes/design-consultation.md). Skill heavy; ★★★ adoption candidates: SAFE/RISK split (broadly portable), memorable-thing forcing question, "consultant not form wizard" posture, "would a competent human be embarrassed?" self-gate, naming the convergence traps. |
| [design-html](https://github.com/garrytan/gstack/blob/main/design-html/SKILL.md) | `reference` | Approved design → production HTML. |
| [devex-review](https://github.com/garrytan/gstack/blob/main/devex-review/SKILL.md) | `skip` | Doesn't apply — unclear who the developer is. |

## Coordination / multi-agent

| Skill | Status | Reaction / notes |
|---|---|---|
| [pair-agent](https://github.com/garrytan/gstack/blob/main/pair-agent/SKILL.md) | `skip` | Read — see [notes/pair-agent.md](notes/pair-agent.md). Less novel than triage suggested — it's OAuth-style credential handoff for sharing the `$B` browser daemon across AI runtimes, not multi-agent coordination. Built on `$B` which we've already rejected. Keep one idea: the "human-as-courier between two AIs" handoff UX gesture. |

## Documentation / output

| Skill | Status | Reaction / notes |
|---|---|---|
| [document-generate](https://github.com/garrytan/gstack/blob/main/document-generate/SKILL.md) | `reference` | Diataxis-framed doc generation. |
| [document-release](https://github.com/garrytan/gstack/blob/main/document-release/SKILL.md) | `reference` | Post-ship doc sync. |
| [make-pdf](https://github.com/garrytan/gstack/blob/main/make-pdf/SKILL.md) | `skip` | Not relevant. |
| [learn](https://github.com/garrytan/gstack/blob/main/learn/SKILL.md) | `reference` | Project learnings manager. Compare against our memory system. |

## Observability / health

| Skill | Status | Reaction / notes |
|---|---|---|
| [health](https://github.com/garrytan/gstack/blob/main/health/SKILL.md) | `reference` | Aggregates existing tools (lint/types/tests) into a score. |
| [benchmark](https://github.com/garrytan/gstack/blob/main/benchmark/SKILL.md) | `skip` | Perf regression detection. Not a priority. |
| [benchmark-models](https://github.com/garrytan/gstack/blob/main/benchmark-models/SKILL.md) | `skip` | Cross-model AI perf comparison. |
| [canary](https://github.com/garrytan/gstack/blob/main/canary/SKILL.md) | `skip` | Post-deploy monitoring. Not where callback is. |
| [investigate](https://github.com/garrytan/gstack/blob/main/investigate/SKILL.md) | `integrate (parts)` | Read — see [notes/investigate.md](notes/investigate.md). Adopting: Iron Law, fail-then-pass regression test discipline, DEBUG REPORT format, callback-specific Pattern Analysis table. Possible artifact: callback debugging guide (CLAUDE.md section or docs/debugging.md). 3-strike rule kept as a "know it's there" idea, not enforced. |

## Safety / state / session

Not pursuing this group — but the meta-pattern of **hooks-as-guardrails** is worth remembering.

| Skill | Status |
|---|---|
| [careful](https://github.com/garrytan/gstack/blob/main/careful/SKILL.md) | `skip` |
| [freeze](https://github.com/garrytan/gstack/blob/main/freeze/SKILL.md) | `skip` |
| [unfreeze](https://github.com/garrytan/gstack/blob/main/unfreeze/SKILL.md) | `skip` |
| [guard](https://github.com/garrytan/gstack/blob/main/guard/SKILL.md) | `skip` |
| [context-save](https://github.com/garrytan/gstack/blob/main/context-save/SKILL.md) | `skip` |
| [context-restore](https://github.com/garrytan/gstack/blob/main/context-restore/SKILL.md) | `skip` |

## Model overlays

| File | Status | Notes |
|---|---|---|
| [opus-4-7.md](https://github.com/garrytan/gstack/blob/main/model-overlays/opus-4-7.md) | `deferred` | Per-model behavioral nudges. Deferred deliberately: better to discover which Claude behaviors actually annoy me in practice than to pre-load a fix list for problems I haven't hit. Revisit if/when specific friction surfaces. |
| claude / gpt / gemini / o-series / gpt-5.4 | `skip` | Per-model tweaks, mostly conciseness + completion-bias. |

## Infra / setup / iOS — all `skip`

gstack-upgrade, setup-browser-cookies, setup-deploy, setup-gbrain, sync-gbrain, open-gstack-browser, ios-* (clean / design-review / fix / qa / sync).
