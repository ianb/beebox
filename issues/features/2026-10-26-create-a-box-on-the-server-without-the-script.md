---
title: "Create a box on the server without running add-box.sh from a laptop"
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
