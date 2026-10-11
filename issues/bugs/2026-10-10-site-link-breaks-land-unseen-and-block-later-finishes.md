---
title: "Site links to generated card reference pages break on main unseen, then block other workstreams' finish"
workstream: unattached
area: docs
labels: [site, doc-check, finish]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
---

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
