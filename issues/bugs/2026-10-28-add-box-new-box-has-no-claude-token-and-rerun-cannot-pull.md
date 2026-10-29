---
title: "`add-box.sh`: a new box gets no Claude token, and a re-run cannot pull once the push alias is set"
workstream: unattached
area: beebox
labels: [deploy, provisioning, secrets]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — creating a research box on production, 2026-10-28"
---

Two defects found while creating a box with `deploy/add-box.sh --create`.

**A new box cannot run its agent.** The script grants a box nothing unless
`--secrets-from <box>` is passed, and that flag copies every grant the
source box holds, connector credentials included. The boxholder expected a
new box to start with Claude signed in. `docs/server/configuration.md`
("The long-lived token") says the token is granted to every box, so the
script should grant `claude-oauth-token` by default when the master store
holds it, and say so in the dry-run. The workaround used:
`bbx engine secrets grant <slug> claude-oauth-token` as the hub user, then
the export-box and install steps from the script by hand.

**A re-run fails at the pull.** The first run points the box's `origin` at
the per-box ssh alias `github.com-box-<slug>`. A re-run pulls as root
(`git -C "$BOX_PATH" pull --ff-only`), and root's ssh config has no such
alias, so the run stops with `Could not resolve hostname
github.com-box-<slug>`. The script's header says re-running is idempotent;
since the alias step it is not. The pull could run as the box owner (who has
the alias and key), or skip the pull for an existing box.

Fixed in the same session: the push-key identity check expanded its
variables on the laptop and stopped every GitHub-remote run with
`RESOLVED: unbound variable` (f0bcd8c8b).

**2026-10-28 (retrospective 20261028-234100):** No test covers `add-box.sh`;
both defects reached production. Prevention to land with the fix: the
dry-run names the token grant and who runs the pull, a test in
`beebox/test/deploy/` checks that dry-run text for a new box, and a test with
stubbed `git`/`sudo` checks that a re-run on an existing box pulls as the box
owner (or skips the pull).
