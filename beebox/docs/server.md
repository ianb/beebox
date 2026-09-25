# The production server

One operator's pipeline: a long-lived Ubuntu VPS that serves many boxes behind
nginx and systemd, deployed by rsync from a built commit. It is in the repo
because it is real and exercised daily, not because it is the recommended
shape; the supported install is [Docker](install/docker.md). The scripts live
in `beebox/deploy/` ([map](../deploy/README.md)); nothing there runs until a
gitignored `deploy/target.env` names a server.

## Members

| Member | What it covers |
|---|---|
| [Provisioning](server/provisioning.md) | Creating and setting up the host: prerequisites, the provisioners, server layout, systemd units, DNS and HTTPS. |
| [Configuration](server/configuration.md) | `/home/beebox/.env`, the service user's Claude and Codex logins, box login and invites, per-box access control. |
| [Deploying](server/deploying.md) | `deploy.sh`, the maintenance boundary, the deploy page, rollback, what production actually executes. |
| [Boxes](server/boxes.md) | Adding a box to the hub, by hand or with `add-box.sh`; the box's push credential; troubleshooting. |
| [Operations](server/operations.md) | Connecting, running `bbx` on the server, scripts that run there, diagnostics, the nightly Claude Code update. |
| [Health checks](server/health-checks.md) | The runbooks: hub endpoints, engine quota, box growth, template updates, connectors, drafts, the updater. |

## Owned elsewhere

- Connector credentials: the machine [secret store](secrets.md); a box gets one by grant.
- Box data migrations and recovery: [migrations](migrations.md).
- Google OAuth credentials: [Google setup](google-setup.md).
- The security posture of the whole: [security overview](security-overview.md).
