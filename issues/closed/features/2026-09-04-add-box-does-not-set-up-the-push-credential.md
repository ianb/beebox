---
title: "add-box.sh does not set up a box's push credential, and nothing detects the omission"
workstream: deploy-separation
area: beebox
filed-by: agent
discovered-in: worktree-deploy-separation — a production box was found never to have pushed
resolution: implemented
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

> 2026-09-04 implemented in `add-box.sh`. It now creates the per-box key when
> absent, writes the ssh host-alias stanza, and points the box's `origin` at the
> aliased remote — the three steps that were manual. The dry-run plan names all
> of them, because a step that grants write access should be visible where the
> operator decides whether to let it happen.
>
> On `--create`, where `gh` is already authenticated and already creating the
> repo, the key is registered automatically with write access. Sticky by
> boxholder's decision, and changes are explicit: the already-registered check
> matches **key material, not the title** (verified against a real repo whose
> key had been added by hand under an unrelated title — a title check would have
> missed it and added a duplicate), and the script never rotates or replaces a
> credential on its own. Replacing one means removing the old key on GitHub and
> re-running deliberately.
>
> Two things deliberately NOT done:
>
> - **The detector.** This issue also asked for something that notices a box
>   that has stopped reaching its remote. Admin → Backup now reports the symptom
>   per box (`src/core/box/backup-status.ts`), but nothing watches it — a
>   fleet-level view or an alert after N days is still unbuilt. That is the half
>   that would have caught the original incident without anyone looking, and it
>   deserves its own item rather than being implied closed here.
> - **A key added through `gh` is tied to gh's auth token** — de-authorizing the
>   GitHub CLI later removes it and the box stops pushing silently. The script
>   prints this caveat when it registers. Unavoidable on that path; worth
>   knowing before relying on it.
>
> A cross-model review then found four defects in that first implementation,
> all fixed: a **read-only** deploy key matching by key material counted as
> "registered" (it fetches and never pushes — the same failure in disguise);
> an `https://github.com/...` repo argument, which the usage line accepts,
> skipped credential setup entirely and reproduced the original bug through a
> documented input; the ssh-config idempotency check was a regex, so the dots
> in the alias were wildcards (verified: it false-matched `githubXcom-box-…`),
> and it proved only that *some* Host line existed, not that the alias resolved
> to this box's key; and a failed auto-registration on `--create` still exited
> zero. The alias is now verified with `ssh -G`, and `--create` exits non-zero
> when the key is not registered.

