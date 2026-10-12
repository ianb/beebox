---
title: "Site links to generated card reference pages break on main unseen, then block other workstreams' finish"
workstream: finish-tooling
area: docs
labels: [site, doc-check, finish]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
resolution: implemented
---

**Closed 2026-10-12 (finish-tooling).** doc-check now resolves `site/docs/`
links under `reference/` against the engine's generated doc set
(`beebox/src/dev/doc-check/site-reference-links.ts`). Pre-commit runs that
check alone (`doc-check --site-reference`) on a `beebox/src` change with no
doc staged, which is the commit shape that removes a card page.
`finish-verify` adds an "unchanged from main" line for any file a red
non-test check names that has no difference from main.

Moving a built-in card type into a plugin removes its generated
`site/docs/reference/cards/<type>.md`. Site docs that link to it break, but
neither pre-commit nor doc-check runs the site build, so the break lands on
main. The next workstream to finish then fails its site check on files it did
not touch, and `finish-verify` does not say the failure is in files identical
to main.

Seen twice: courseware (`site/docs/capabilities/courses.md` →
`reference/cards/course.md`) blocked an unrelated workstream's finish twice
(siri-app-intents/20261010T140704Z-landed.md,
siri-app-intents/20261010T141303Z-landed.md); recipe broke two site links at
its own finish (plugins-planning/20261010T234714Z-landed.md).

Wanted: a doc-check rule that resolves site links into generated reference
pages at commit time, and a finish-verify note when a failing file is
byte-identical to main.
