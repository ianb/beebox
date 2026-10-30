---
title: "Deploy's tool check prints a codex warning about a CODEX_HOME under /tmp"
workstream: unattached
area: deploy
labels: [deploy, noise]
filed-by: agent
discovered-in: dep-reduction — deploy logs for 738fcbddb and 11e6c5bfa, 2026-10-27
resolution: implemented
---

**Closed (implemented, 2026-10-30):** Re-reviewed 2026-10-30: fixed in 729a3deae; deploy.sh now makes the throwaway Codex home under ~/.cache.

Every deploy's "Verifying required external tools..." step prints:

```
WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/tmp" (codex_home: AbsolutePathBuf("/tmp/tmp.…"))
```

`beebox/deploy/deploy.sh` points `CODEX_HOME` at `codex_check_home=$(mktemp -d)`
to run codex for the check, and codex refuses to put helper binaries under
`/tmp`. The check passes, so the line is routine-success noise in every
deploy log. A likely fix is a check home outside `/tmp` (for example under
the beebox user's state directory), or a codex invocation that does not
create aliases.
