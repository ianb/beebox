---
title: "Adopt GoogleChrome/modern-web-guidance, whole or in part, for dev and box agents"
workstream: unattached
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
eval method is in the separate `modern-web-guidance-src` repo, which nobody
has read yet.

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
- **`legacy-scan`** as a one-time audit of `beebox/src/frontend` and the
  stock views, separate from adoption.
- **Evals.** Read `modern-web-guidance-src` to see what the evals measure,
  and whether our knowledge audits (`knowledge-audit` skill) could check that
  the guidance takes effect here.
