---
title: "Embed real JSON Schema in per-card-type agent docs (RFC idea, never built)"
workstream: github-pages-site
area: callback-box
filed-by: agent
discovered-in: worktree-github-pages-site — story-extraction triage of cards-as-markdown-rfc.md
priority: important
---

The cards-as-markdown RFC argued that **"agents read JSON Schema natively"**
— per-card-type docs should embed the actual schema as a JSON code block so
the agent gets the spec in a format it reasons about directly, no prose
rendering in between. During story-nugget triage (2026-07-22) the boxholder
kept this beat with the note: **"Not actually implemented! But yes..."** —
i.e. the idea is endorsed and unbuilt.

The adjacent single-source machinery exists (the schema `.ts` is already
the source for runtime validation; `docs-gen` produces agent-facing docs),
so the shape is plausibly: docs-gen emits the Zod schema's JSON Schema into
each card-type doc, keeping doc and validation drift-free by construction.

Not scheduled work — filed so the endorsed-but-missing state is recorded
somewhere actionable rather than only inside a frozen RFC.
