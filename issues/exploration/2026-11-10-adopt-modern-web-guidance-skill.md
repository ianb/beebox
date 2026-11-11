---
title: "Adopt GoogleChrome/modern-web-guidance, whole or in part, for dev and box agents"
workstream: web-guidance-scan
area: beebox
labels: [agent-guidance, frontend, views]
needs: [decision]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — boxholder request, 2026-11-10"
---

[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)
is a set of agent skills about the current web platform: about 250 features (CSS
and layout, HTML and DOM, JavaScript APIs) and about 200 use-case guides
under `skills/modern-web-guidance/guides/<category>/`. Its categories include
accessibility, forms, performance, security, PWA, and UI components. It favors
native APIs and small fallbacks over polyfills. The Chrome, Edge, Firefox,
and MDN teams maintain it under Apache-2.0. It ships plugin manifests for
Claude Code, Codex and others, an install wizard
(`npx modern-web-guidance@latest install`), and a CLI with `search`,
`retrieve <guide-id>`, and `legacy-scan .`.

The boxholder is considering adopting it in whole, against their usual
preference. The reason is its evals: the project prunes guidance that models
already know, so what remains is the part a model would get wrong without it.
An eval dashboard is at googlechrome.github.io/modern-web-guidance-src/. The
eval method is in the separate `modern-web-guidance-src` repo.

## Apply it to the existing code and the lint rules

The developer wants this to be a large part of the work, besides guiding
future agent edits:

- **Go back over existing code.** Run `legacy-scan` on `beebox/src/frontend`,
  the stock views and templates, `workstreams-app/`, and `beebox-clerk/`. Fix
  what it finds, guide by guide. The scanner
  (`src/analyzing/` in `modern-web-guidance-src`) has one static matcher for
  each guide (`src/analyzing/rules/<guide>.ts`), an LLM verifier that drops
  false positives, and `--json` output for agents. Its findings are
  "provisional" and come with keep/drop criteria.
- **Put what we can into lint.** Where a static matcher is deterministic,
  port it to an ESLint rule in `personal-vibe-check/`. Then the rule holds for
  every later edit. Where it is not deterministic, run `legacy-scan` against a
  baseline, the way the weekly `supplemental-lint` schedule
  (`schedules/supplemental-lint/`) treats oxlint and cycle findings: it
  reports only new findings.
- **Box-authored views.** Box agents write views in boxes, and lint does not
  run there. The view check (`bbx view check`) could run the same matchers.

## Fit to our models (2026-11-10)

The published guides are one set for all agents: the evals drop content that
"models already know", across the models evaluated. Nothing selects guides
for one model. The eval harness (`docs/EVALS.md` in the source repo) has a
Claude Code agent with the model set by `ANTHROPIC_MODEL`. Each guide has a
task, a Playwright grader, and golden solutions. We could run the suite on
Claude Code with Opus 5.5 and keep only the guides that the model fails
without the guide. Not yet checked: whether the harness already compares
runs with the guide to runs without it. The cost is real model spend
(about 250 guides, several runs each), and the subset needs a re-run after
each model change. On-demand `search`/`retrieve` may make this unnecessary:
a guide that is never retrieved costs nothing.

## Questions

- **Whole or in part.** Use the upstream plugin as is (updates are free,
  and its evals cover what we load), or copy selected guides (smaller, but
  they go stale and the evals no longer cover them).
- **Which agents.** Dev agents writing `beebox/src/frontend`, and box agents
  writing views and cards. Box agents author HTML/CSS/JS in boxes, so they
  might gain the most. Their guidance goes through
  the box guide and schema instructions, not Claude Code plugins, so they
  would probably use the `search`/`retrieve` CLI (or a `bbx` wrapper) on
  demand rather than load the guidance up front.
- **Cost.** Whether the skill loads only when triggered, or on every
  session.
- **Overlap and conflict** with our frontend rules, the shared lint preset,
  and the view-authoring guidance. Find where its advice disagrees with ours,
  for example a native element we replaced with a component.
- **Order.** Whether the code sweep and lint rules come before, after, or
  without adopting the guidance for agents.
- **Evals.** Read `modern-web-guidance-src` to see what the evals measure,
  and whether our knowledge audits (`knowledge-audit` skill) could check that
  the guidance takes effect here.

## Scan and adoption plan (2026-11-11)

The scan ran, and a plan for discussion is at
[`beebox/docs/plans/modern-web-guidance-adoption.md`](../../beebox/docs/plans/modern-web-guidance-adoption.md).
The guide-by-guide evidence is in
[`research/modern-web-guidance/`](../../research/modern-web-guidance/README.md).

- `legacy-scan` (33 rules, about 20% of the guides) found 7 candidates; 4
  were real (IME-unsafe Enter handlers). Its CSS matchers cannot see Tailwind
  classes.
- Reading all 209 guides against the code gave 47 adopt or adopt-with-changes
  entries, 52 reject, and 140 that do not apply. The plan groups them into
  categories A–I, each with a recommendation to decide on its own.
- Three sample fixes are committed on `worktree-web-guidance-scan`: the IME
  fix with a ported ESLint rule, field hint/error linking, and modal scroll
  containment with `min-h-dvh`.
- Decide first: the browser floor (iOS 17.0 today, unwritten), which sets
  about 30 of the leans.

**2026-11-11:** The plan's adoption work landed on `main` (see the "Implementation
status" section of the plan). Still open: whether to install the skill for dev
agents, the modal-toast behaviour (B11), an HSTS check at the edge, and Trusted
Types (F4, held).
