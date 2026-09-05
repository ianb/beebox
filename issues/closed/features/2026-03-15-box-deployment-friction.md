---
title: "Box deployment friction"
workstream: unknown
needs: [design]
area: beebox
resolution: superseded
---

**Closed (2026-07-15): superseded / out of date.** The box-deployment model has
moved on: `add-box.sh` now runs a post-add health check (point 3), and the
boxes-as-packages (v2) migration reshaped the ownership / standard-dirs landscape
the 2026-03 notes describe. These specific frictions are stale — refile any
concrete add-a-box friction that actually recurs (a `bbx deploy-check` command is
still a reasonable idea if it does).

Several things go wrong when adding a new box to the server that are easy to forget:

1. **Missing secrets** — see above
2. **File ownership** — `add-box.sh` clones as root, then chowns. But if new box directories are introduced in a code update (e.g., `people/`), existing boxes won't have them until `bbx init` runs. The script now runs `bbx init --skip-git` as the callback user after pulling, but edge cases remain (e.g., background agents creating directories while running as the wrong user).
3. **No validation after deploy** — there's no health check or `bbx validate` run after `add-box.sh` completes. A broken box (missing config, bad permissions) won't be caught until someone tries to use it.

Longer term: `add-box.sh` or a `bbx deploy-check` command could verify: all standard dirs exist and are writable, required secrets are present, `bbx validate` passes, and the web endpoint responds.
