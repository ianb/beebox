---
title: "Box deployment friction"
needs: [design]
area: callback-box
---

Several things go wrong when adding a new box to the server that are easy to forget:

1. **Missing secrets** — see above
2. **File ownership** — `add-box.sh` clones as root, then chowns. But if new box directories are introduced in a code update (e.g., `people/`), existing boxes won't have them until `cb init` runs. The script now runs `cb init --skip-git` as the callback user after pulling, but edge cases remain (e.g., background agents creating directories while running as the wrong user).
3. **No validation after deploy** — there's no health check or `cb validate` run after `add-box.sh` completes. A broken box (missing config, bad permissions) won't be caught until someone tries to use it.

Longer term: `add-box.sh` or a `cb deploy-check` command could verify: all standard dirs exist and are writable, required secrets are present, `cb validate` passes, and the web endpoint responds.
