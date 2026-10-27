---
title: "better-sqlite3's install script prints a Node DEP0176 warning on deploy"
workstream: unattached
area: deploy
labels: [deploy, noise, dependencies]
filed-by: agent
discovered-in: dep-reduction — deploy log for 11e6c5bfa, 2026-10-27
---

When a deploy reinstalls dependencies (lockfile change), the log shows:

```
node_modules/better-sqlite3 install: (node:…) [DEP0176] DeprecationWarning: fs.R_OK is deprecated, use fs.constants.R_OK instead
```

The warning comes from better-sqlite3's install step (its prebuilt-binary
download path), not from beebox code. Options: a better-sqlite3 version
whose installer no longer uses `fs.R_OK`, or `NODE_OPTIONS=--no-deprecation`
scoped to that install. Moving to `node:sqlite` (an open dependency-inventory
row, `dev/dependency-inventory-2026-10.md`) would remove it.
