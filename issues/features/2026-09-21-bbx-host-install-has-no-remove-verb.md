---
title: "bbx host install has no remove/unrecord verb, and no dry-run before recording"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

`bbx host install <pkg> --why "<reason>"` (`beebox/src/cli/commands/host.ts`)
records the package in `_config/host-packages.json` via `recordHostPackages`
and then installs it through the `bbx-host-apt` root wrapper. The wrapper's
own policy comment says it holds "distro sources only, nothing upgraded or
removed" (`beebox/src/cli/commands/host.ts:1-14`) — removal is deliberately
out of the wrapper's scope, not merely unimplemented in the CLI.

A box agent installed a package as a diagnostic guess (to test whether a
rendering tool needed a display), the guess did not help, and there was then
no way to take it back out: no `bbx host remove`, no `--try`/dry-run mode that
installs without recording until confirmed. `grep -n "remove\|unrecord" `
across `beebox/src/core/host-packages.ts`,
`beebox/src/core/host-packages-system.ts`, and
`beebox/src/cli/commands/host.ts` finds nothing — the record-then-install path
is one-way today.

## Why resolution is not obvious

The wrapper's safety model is "install-only, nothing removed" by design, so a
literal `apt-get remove` verb may be a deliberate non-goal. A narrower fix —
un-recording a package from `_config/host-packages.json` without touching the
installed binary, so the visible list stays honest even though the disk state
doesn't roll back — would satisfy the reported need without extending the
wrapper's privileges. Choosing between "just drop it from the record" and
"also uninstall" is a policy call for whoever owns `box-host-packages`.

Related: `issues/closed/features/2026-09-16-box-installs-distro-packages.md`
(the base feature, already implemented) and
`issues/features/2026-09-16-box-python-library-path-and-policy.md`,
`issues/features/2026-09-16-sandboxed-trick-helpers.md` (adjacent open work
from the same triage).
