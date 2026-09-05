---
title: "Complete the manual Bee Box external cutover"
workstream: unattached
area: docs
labels: [rename, release, operations]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-name-change-plan — collecting the owner-operated steps after the repository rename
priority: important
---

The repository uses the Bee Box identity, but several external systems require
owner access or a deliberate production cutover. Complete this checklist in
order. The [name history](../../beebox/docs/name-history.md) owns the mapping
from retired names to current names; do not repeat that vocabulary here.

## 1. Land the repository rename

- [x] Merge the rename workstream into `main`.
- [x] Confirm the post-merge hook finishes successfully before changing
  production or external service names.
- [x] Run `pnpm retired-product-name-check` on `main`.

## 2. Rename the GitHub repository

- [x] Rename the repository to `ianb/beebox` in GitHub Settings.
- [x] Change the local `origin` remote to `git@github.com:ianb/beebox.git` or
  the equivalent HTTPS URL.
- [x] Check branch protection, Actions permissions, deploy keys, webhooks,
  GitHub Pages settings, and repository topics after the rename.
- [x] Open the README and several documentation links through the new GitHub
  URL. Confirm that images, badges, and source links resolve.

## 3. Move the local checkout when ready

- [x] After the repository and external cutover are otherwise settled, stop the
  shared dev router and move the current main checkout to `~/src/beebox`.
- [x] Restart `pnpm dev` from `~/src/beebox` and confirm the router reports that
  path as the `main` root and discovers worktrees under
  `~/src/beebox-worktrees`.
- [x] Update any shell aliases, editor workspaces, terminal profiles, scripts,
  and bookmarks that still point at the previous local checkout path.

The worktrees moved to `~/src/beebox-worktrees`, and Git's linked-worktree
metadata was repaired. A compatibility symlink preserves old paths. Claude
project directories and Codex thread indexes retain access to sessions created
before the move.

## 4. Publish the npm package

- [ ] Confirm that the `beebox` npm package name is still available to the
  correct npm account.
- [ ] Publish `beebox` from `beebox/package.json`.
- [ ] Install it in a clean temporary package and confirm that `bbx --help`
  runs.
- [ ] Deprecate the previous package with a short migration message that points
  users to `beebox`, if that package was ever published publicly.

## 5. Configure `beebox.run`

- [ ] Complete domain registration and attach the domain to the intended
  Cloudflare account.
- [ ] Configure the production DNS record and Cloudflare proxy/TLS settings.
- [ ] Set the canonical production URL to `https://beebox.run`, including
  `BBX_PUBLIC_URL` and the gitignored deploy `public-url` file.
- [ ] Confirm that `https://beebox.run` reaches the production server and that
  the certificate is valid before changing OAuth redirects.
- [ ] Decide whether the previous hostname redirects to `beebox.run` and, if
  so, keep that redirect for bookmarks and inbound links.

## 6. Update Google OAuth

- [x] Treat the OAuth client as personal-box configuration. There is no public
  OAuth service or public-app launch to prepare.
- [ ] Add `https://beebox.run/auth/callback` to the existing client for owner
  login.
- [ ] Add `https://beebox.run/auth/google-services/callback` to the existing
  client for Google connector authorization.
- [ ] Keep the previous redirect URIs during the cutover if active sessions can
  still return through the previous hostname.
- [ ] Confirm that owner login and one Google connector authorization complete
  through `https://beebox.run`.

## 7. Cut over the production server

- [ ] Take a current backup or snapshot of the production home, install tree,
  `.env`, and service definitions.
- [ ] Run `beebox/deploy/migrate-to-beebox-user.sh` as root from the renamed
  checkout. Read its output before continuing.
- [ ] Run the normal setup/deploy flow from the renamed checkout to install and
  start the Bee Box systemd units.
- [ ] Confirm that the retired units are stopped and disabled.
- [ ] Confirm that the `beebox` account owns `/home/beebox`, and that the live
  checkout is `/opt/beebox/beebox`.
- [ ] Confirm that `/usr/local/bin/bbx` resolves to the renamed checkout and
  that the service `PATH` resolves the same executable.
- [ ] Check `beebox-hub`, `beebox-scheduler`, and recycle services with
  `systemctl` and `journalctl`.
- [ ] Verify owner login, one existing box, schedules, Google connectors,
  browser automation, push delivery, and one agent turn through
  `https://beebox.run`.
- [ ] Keep the retired account and unit files until the new deployment has run
  successfully long enough to make rollback unnecessary. Remove them only in
  a separate, deliberate cleanup.

## 8. Update the community and public identity

- [x] Create the Bee Box Discord server and choose it as the project's
  community channel.
- [x] Record the stable invite URL: [join the Bee Box Discord](https://discord.gg/FQYn6zyv).
- [x] Confirm that the README community link opens the invite and joins the
  intended server.
- [ ] Update any public profiles, repository descriptions, pinned posts,
  release notes, or announcement links that are not stored in this repository.

## 9. Apple records and local devices

- [ ] If Apple Developer records exist, rename the app display record to
  **Bee Box** and confirm the bundle IDs `app.beebox.ios`,
  `app.beebox.ios.share`, and `app.beebox.ios.tests`. No distributed-app
  compatibility work is required because no build has been distributed.
- [ ] Build and pair a fresh development install after the production hostname
  changes.
- [ ] Remove and reinstall each saved PWA so its name, icon, start URL, and
  service-worker scope use Bee Box.
- [ ] Update browser bookmarks, pinned tabs, home-screen links, and shortcuts.
- [ ] Trigger one deployment and confirm that terminal notifications use the
  Bee Box title and `beebox-deploy` group.

## Completion check

- [ ] Search the boxholder's password manager, bookmarks, shell configuration,
  and service dashboards for the retired vocabulary described in the name
  history.
- [ ] Confirm that GitHub, npm, Cloudflare, Google, Discord, production, Apple
  records, and personal devices all use the current identity.
- [ ] Record the completion date here, then close this issue as implemented.

> 2026-09-03 survey (main session): section 7 is done in fact though unchecked
> here. The production server today runs `beebox-hub.service` and
> `beebox-scheduler.service`, the boxes live under `/home/beebox/boxes`, the
> live checkout is `/opt/beebox/beebox`, and `/usr/local/bin/bbx` resolves
> there; the deploy sweep converged all six boxes through it today. The
> hostname (section 5), OAuth redirects (6), and everything after remain open;
> the boxholder's own links still use the previous hostname.
