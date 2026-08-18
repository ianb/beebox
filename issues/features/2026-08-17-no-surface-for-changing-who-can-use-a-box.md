---
title: "Adding a person to an existing box means hand-editing JSON on the server"
workstream: unattached
area: callback-box
labels: [access, provisioning]
filed-by: agent
discovered-by: agent
discovered-in: worktree-add-box-process — provisioning a box with a second member
---

Access to a box is `allowedEmails` in its `content/config/box.json`, read by
`src/webapp/box-access.ts`. There is exactly one supported way to write it:
`deploy/add-box.sh --allow EMAIL`, at creation time, and only for a box that
does not already have a `box.json`. Every later change is hand-editing JSON on
the server.

The script says so itself when it declines:

```
Access: box.json exists — leaving it unchanged (add by hand: someone@example.com)
```

That refusal is correct — clobbering hand-tuned access on a re-provision would
be much worse. The gap is that "by hand" is the only other option.

## Job stories

*When someone new starts helping me with a project the box is about, I want to
give them access from wherever I already am, so I can do it while I'm thinking
of it instead of writing myself a note to SSH somewhere later.*

*When someone stops being involved, I want to remove them and be confident it
took effect, so that a stale invitation is not a thing I have to remember.*

The second is the sharper one: there is currently no removal path at all short
of editing the file, and no way to see who currently has access to a box
without reading it.

## Why this is probably not a CLI feature

The obvious patch is `cb box allow <email>`. That is likely the wrong surface:
the boxholder works in the web UI and chat, and the `cb` CLI is agent and script
plumbing. Membership is an ordinary owner task, not a provisioning task — it
happens long after the box exists, at moments that have nothing to do with a
deploy. A person who wants to add a family member should not be at a terminal.

So the likely shape is an owner-facing view: who can use this box, add, remove.
Notably the hub already knows the accessible-box list per user (it builds
`/auth/me`'s list), so the read side has a natural home.

Open questions:

- Where does it live — per-box settings, or a fleet-level view across boxes the
  owner owns? The second is more useful and more work.
- Does adding someone need an invitation flow, or is naming an email enough?
  Today access is fail-closed on an email match with no notification, so an
  added person is not told anything.
- Is the owner always exactly one person? `allowedEmails` never lists the owner,
  so the model today is owner-plus-guests, with no way to express co-ownership.
  Worth deciding before building a UI that hardcodes the distinction.

Until something exists, `deploy/add-box.sh --allow` at creation time and a
hand-edit afterwards is the honest documented answer, and
[`docs/adding-a-box.md`](../../callback-box/docs/adding-a-box.md) says so.
