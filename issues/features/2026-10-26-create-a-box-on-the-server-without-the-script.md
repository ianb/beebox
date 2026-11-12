---
title: "A management plane for the server: create boxes and grant secrets without add-box.sh or SSH"
workstream: box-isolation
area: beebox
needs: [decision, design]
labels: [deploy, provisioning, hub, admin]
filed-by: agent
discovered-by: Ian
discovered-in: "box-isolation — after retiring the single-user layout, 2026-10-26: the boxholder said we should have some way to allocate boxes without a script"
---

Today a new box on the server exists only through `deploy/add-box.sh`, run
from a laptop checkout with `deploy/target.env` and root SSH. The boxholder
wants a way to allocate a box that does not go through that script.

What the script does that needs root, in order (`deploy/add-box.sh`):
create the user `bbx-<slug>` (UID 2000–2999, group `beebox-boxes`) and its
home at `/var/lib/beebox/<slug>` with the private subdirectories; clone and
`bbx engine init` the box as that user; export the box's share of the master
secret store into the box user's own store; `systemctl enable --now
beebox-box@<slug>.socket`; write the scheduler manifest into `beebox-sched`'s
home; register the slug with the hub (`bbx engine hub add-box --socket`, as
the hub user) and restart the hub, since `hub.json` does not hot-reload. The
hub itself holds no sudo and joins no box group (settled in
`docs/implemented-plans/per-box-units.md`), so an Admin button cannot do these
steps directly.

Shapes to decide between:

- **A root helper with one operation, the pattern the scheduler uses.**
  `bbx-box-run` is a root wrapper with a fixed set of operations that one
  account may call through sudo (`deploy/server-bin/bbx-box-run`). A
  `create <slug> <repo>` operation, callable by the hub user, would let an
  Admin page or a `bbx` command on the server allocate a box. The wrapper
  would own the slug validation and the UID choice; the hub would gain its
  first sudo grant, narrowed to that one verb.
- **A server-side CLI for root.** `bbx engine box create <slug> <repo>` run
  by the operator over SSH, doing what the script does with no laptop
  checkout. Smallest change; still a shell step, not a UI.
- **A systemd template.** `beebox-create@<slug>.service`, started by the hub
  through a socket or a path unit, with the repo passed through a file the
  hub writes. More moving parts for the same result as the wrapper.

Related: the hub restart on every add is what makes this an operator step;
a hub that reloads `hub.json` on SIGHUP would shrink any of the above.
`issues/bugs/2026-08-17-add-box-script-targets-a-service-that-no-longer-exists.md`
is the earlier "one clean process" ask for the script itself.

## Which server: the target is implicit (2026-11-11)

The boxholder asked how `add-box.sh` knows which server to use, and wants
that improved as part of managing the server, not only box creation. Today:

- The server is whatever `beebox/deploy/target.env` names
  (`BBX_DEPLOY_HOST`, `BBX_DEPLOY_SSH_USER`, default root), loaded by
  `deploy/deploy-target.sh`. The file is gitignored; its presence is the
  switch that makes a checkout deploy at all.
- A worktree without its own `target.env` borrows the main checkout's, so
  every checkout on the laptop points at the same server without saying so.
- There is exactly one target. Nothing names the server in the command or
  its output, nothing lists the servers an operator has, and there is no
  way to point one command at a second server.
- Server layout (`/opt/beebox`, `/home/beebox`, the `beebox` account, port
  3210) is fixed, and every step runs as root over SSH.

What a better version would answer: the command or its dry run names the
server it will change; an operator can have more than one server (or a
staging one) and pick it explicitly; and the "manage the server" operations
(create a box, list boxes, grant secrets, check health — today spread across
`add-box.sh`, `prod-ssh`, `bin/deploy-status` and `bbx engine` commands run
over SSH) have one documented home. The shapes above for box creation are
one part of that.

## Granting secrets belongs here too (2026-11-11)

Since boxes run as their own users, a box's Admin page reads only that
box's copy of the secret store (`secrets.machineView` reports
`scope: "box"`). It cannot see the machine's other keys, so its "Add a key
to this box" picker for existing keys never appears, and granting a key the
server already holds takes SSH: `bbx engine secrets grant <box> <name>` as
the hub user, then re-exporting the box's copy (the export-and-verify step
in `add-box.sh`). The boxholder found this on a new box that had only the
Claude token.

The boxholder's direction: the management plane that creates boxes also
grants and revokes secrets. One owner-only surface over the machine (the
hub user's master store and the box list) instead of each box's Admin page
reaching for machine state it can no longer see. Its operations, at least:

- create a box (the shapes above);
- grant and revoke a machine secret for a box, re-exporting that box's copy;
- add or replace a machine secret's value;
- list boxes, their grants, and their health.

The root-helper shape above extends naturally: the same narrow sudo verb set
gains `grant` and `revoke`, or the hub (which already owns the master store)
does the store edit and asks the helper only to install the box's copy.
Each box's Admin page then links to the management plane for anything
machine-wide, and keeps its box-scoped view.
