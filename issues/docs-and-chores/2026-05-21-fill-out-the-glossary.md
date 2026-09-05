---
title: "fill out the glossary"
workstream: unknown
area: docs
---

`docs/glossary.md` is scoped to Proper Nouns — names we coined and general words we've narrowed to project-specific meanings. The starter set covers box, card, attach scope, attachment, asset, asset manifest, wakeup cycle, connector, procedure, service, cardworks, inbox, archive, bbx, bbx attachments. Things to add:

- **Card-related**: tagName, ref, ref graph, schema instructions, validation, virtual `attach/` prefix, basename, card title
- **Layout**: store/, box/inbox/, box/jobs/, box/commands/, box/questions/, config/, .beebox/, landmark
- **Wakeup / agent loop**: command, question, job, dispatch, agent invocation, Claude Code harness
- **Connectors / services**: sync, fake vs real, observable state, the service/connector boundary
- **Procedures**: run, step, scenario
- **Capture / intake**: capture session, scan-import, intake, source (the `<filename source>` enum)
- **Frontend**: page, renderer, UI primitive, semantic palette, restrict-component-classes
- **Persistence**: pre-commit hook, post-commit hook, deploy, trailer (git trailer), `bbx commit`
- **Testing**: doctest, makeTestServer, makeTmpBox, the three tiers
- **Misc**: hunch, knowledge audit, landmark, file-lock

Method: do one sweep through `CLAUDE.md`, `FRONTEND.md`, the schemas, and `docs/` collecting terms-of-art, then write entries. Keep them short (one paragraph), link to deeper docs rather than restating. The glossary is for *naming the thing*, not explaining it in full.

Worth treating as a single pass — partial glossaries are worse than none because readers stop trusting them as comprehensive.

**2026-08-25 addendum (from [research/opencode/inspiration.md](../../research/opencode/inspiration.md)).**
OpenCode's `CONTEXT.md` gives each term an `_Avoid_:` line naming the wrong word, and
follows the terms with a list of one-line invariant relationships between them. Both
are cheap and would have caught the duplicate `asset` entry the glossary carried until
today. Adopt the form when filling this out.
