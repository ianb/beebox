---
title: "add-box.sh does not set up a box's push credential, and nothing detects the omission"
workstream: deploy-separation
area: beebox
filed-by: agent
discovered-in: worktree-deploy-separation — a production box was found never to have pushed
---

`deploy/add-box.sh` does the whole add: clone, `bbx init`, access and connector
secrets, both manifests, service restart, and a canary that proves the box
really serves. What it does **not** do is give the box a way to push.

The established pattern is one GitHub **deploy key per box repo** — a deploy key
can only attach to a single repo, hence one per box — reached through a host
alias so ssh picks the right one:

```
Host github.com-box-<name>
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_box_<name>
  IdentitiesOnly yes      # without this ssh offers every key and trips
                          # GitHub's max-auth-attempts limit
```

…with the box's remote set to `git@github.com-box-<name>:<owner>/<repo>.git`.
None of those three steps — generate the key, append the stanza, point the
remote at the alias — is in `add-box.sh`, and the fourth (registering the public
key on GitHub with **write** access) necessarily is not, since it needs the
operator's account.

**The failure is silent, which is the real problem.** A box with no usable push
credential works normally in every visible way: it serves, agents run, commits
land locally. It simply never reaches its remote, and nothing says so — not the
add, not the deploy, not any health check. A box found this way had accumulated
hundreds of unpushed commits with no offsite copy.

Fix direction:

- `add-box.sh` does steps 1, 2 and 4 (keygen, ssh config stanza, aliased
  remote), then **prints the public key as its final instruction** with the
  "Allow write access" reminder, the same way it already ends on a canary
  rather than assuming success.
- Registering the key stays manual. That is the one step that cannot be
  automated from the server, and it is also the one that grants write access,
  so a human confirming it is right rather than an inconvenience.
- Separately, the silence deserves a detector: an unpushed-commit count is
  cheap and already surfaced per box in Admin → Backup
  (`src/core/box/backup-status.ts`). A fleet-level version, or an alert when a
  box goes N days without reaching its remote, is the piece that would have
  caught this without anyone looking.

Related: the Admin → Backup section reports the symptom (remote present,
commits unpushed) but not the cause, and cannot fix it.
