---
title: "Rename callback-box to Bee Box?"
workstream: unattached
area: docs
labels: [soft-launch]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-public-site — public-site design conversation
resolution: implemented
---

## Closed 2026-09-13 — decided yes, and shipped

`next-action: fixed` was right. The decision this issue asked for was made and
carried out in `dab834811` ("feat!: rename Callback Box to Bee Box", 2026-08-30).

Checked the scope list this issue itself named, rather than trusting the commit
subject:

- **Package and CLI** — `beebox/package.json` is `beebox`; the CLI is `bbx`.
- **Prod hostnames/slugs** — the server runs `beebox-hub.service` and
  `beebox-scheduler.service` (confirmed live over ssh, both active).
- **Every old string in source** — there is now a pre-commit guard,
  `bin/retired-product-name-check.ts`, wired into `.husky/pre-commit`, so the
  old name cannot come back by accident. That is stronger than a one-time sweep.
- **The Zulip org** in the scope list is moot on its own terms: the community
  moved to Discord, and `README.md` links the Bee Box server there.

The collision question the issue raised ("bee box" is an existing beekeeping
term, several products use the name) was answered by the boxholder choosing the
name anyway; it is not an open item.

`needs: [decision]` removed with the close — the decision exists and shipped, so
the field would misreport a closed item as still awaiting one.

The developer floated renaming the project to **Bee Box**, alongside a design
direction for the public site: a worker-bee character (a beset-upon bee
drafted into office work it doesn't understand — along for the ride, not
selling the system), possibly a small cast of characters, in the expository
register of the Brown Paper School books (*The I Hate Mathematics! Book*,
*Math for Smarty Pants*).

The site direction can proceed under either name; the rename itself is a
separate, larger decision:

- **Scope**: repo name, package names, the `cb` CLI, prod hostnames/slugs,
  the Zulip org (callback-box.zulipchat.com), docs, and every "callback-box"
  string in source. Cheapest before launch; cost grows with each public
  surface.
- **Collisions**: "bee box"/"beebox" is an existing beekeeping term (nuc
  boxes) and several product names use it; domain and package-name
  availability unchecked.
- **What the current name carries**: "callback" describes the mechanism
  (things come back to you); "bee" describes the worker and the hive
  metaphor maps well (box = hive, wakeup = foraging rounds, cards = cells).
  The two aren't exclusive — a mascot/character can exist without a rename.

Decision is the developer's; nothing in the site work is blocked on it, but
the front-door letter and any character art would bake the name in, so it
should be settled before the site goes public.
