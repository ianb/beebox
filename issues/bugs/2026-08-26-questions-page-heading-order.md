---
title: "/questions fails axe heading-order — an h3 with no h2 above it"
workstream: unattached
area: callback-box
labels: [a11y, tours]
filed-by: agent
discovered-by: agent
discovered-in: tour-health — nav-pages tour axe report, both viewports
---

The `nav-pages` tour reports one axe violation on `/questions` at desktop
and mobile: `heading-order`, first node
`<h3 class="text-warm-900 text-lg font-bold mb-2">Brain-dump-pattern</h3>`.
The question cards render their title as `h3` under the page's `h1` with no
`h2` in between. Either the card title is an `h2`, or the section has an
`h2`. Small; the weekly tour check will keep reporting it until fixed.
