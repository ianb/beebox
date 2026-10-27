---
title: "The npm shellcheck wrapper installs 126 packages on the production server"
workstream: unattached
area: dev-tooling
labels: [dependencies]
filed-by: agent
discovered-in: dep-reduction — dependency inventory, 2026-10-27
resolution: implemented
---

Closed 2026-10-27 on the dep-reduction workstream. Decision: use the system shellcheck. The npm wrapper is gone from the root devDependencies. `bin/precommit-security.ts` and `bin/lib/schedules-lint.ts` run `shellcheck` from PATH and name the install command when it is missing, and `bin/doctor` checks for it. The production server has the apt package (0.9.0, installed 2026-10-27), and `deploy/hetzner/cloud-init.yaml` lists it for new servers. The Mac uses Homebrew's (0.11.0). The deploy's required-tools check does not list it yet; the box-card shell linting feature adds that when server code runs it.

The root devDependency `shellcheck` is an npm wrapper that downloads the
shellcheck binary. It pulls in 126 transitive packages (7.3 MB that no other
dependency reaches). Deploy installs root devDependencies on the production
server, so they land there too. Today only the pre-commit hook and the lint
schedule run it.

Options:

- require a system `shellcheck`, with a `bin/doctor` check and an install
  hint;
- keep the npm package, but declare it in a workspace that deploy does not
  sync;
- keep it as it is, if box-side card linting will run shellcheck on the
  server ([box-content linting](../../features/2026-07-24-box-content-card-linting.md),
  [shellcheck in box cards](../../features/2026-08-25-shellcheck-shell-in-box-cards.md)).

The third option depends on where that feature runs, so decide it there
first.
