---
name: bbx-theme
description: Explore, preview, and refine Bee Box themes from visual references or promote an approved study. Keep the visual feedback loop fast; defer automated verification until landing.
---

# Theme iteration

Read `beebox/docs/theme-authoring.md` for the studio and material hooks.

The boxholder's rule: **do not run tests when showing a theme; wait for landing.**
During exploration and implementation for feedback:

- Edit the theme, capture it with `bin/theme-check`, fix what it reports, and
  show a labeled exhibit.
- Do not run tests, tours, change-selected suites, typecheck/lint sweeps,
  knowledge audits, or formal cross-model reviews before showing the result.
- Do not add a plan/review gate for ordinary theme styling; raise architecture
  changes separately.
- Keep drafts in the studio. “Go with this” authorizes promotion of that choice;
  it does not request landing checks.
- Do not bypass commit hooks. If committing would start deferred checks, leave
  the iteration uncommitted and say so. Never claim deferred checks passed.

At an explicit finish/landing request, use the finish workflow and its required
checks. A direct request for a specific test or review overrides this deferral.
