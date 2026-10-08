---
title: "The web app should know the current iOS app version and gently warn when the installed app is out of date"
workstream: unattached
area: beebox
labels: [ios]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

The iOS app is installed by hand (Xcode builds), so the installed copy on a
phone can lag behind the source for weeks, and nothing says so. A fix that
landed in `ios-app/` looks like it did not work when the phone simply runs an
older build. The boxholder wants the site to know which iOS version it
expects and to show a not-obnoxious warning when the app talking to it is
older.

## Only real iOS changes should count

Today the app stamps the repository's HEAD commit into its Info.plist at
build time (`CBGitCommit`, the "Stamp git commit into Info.plist" build
phase in `ios-app/BeeBox.xcodeproj`). That changes on every commit anywhere
in the monorepo, so it cannot be compared: almost every installed build
would look "old". The version must change only when the app itself
changes. Options:

- Stamp the last commit that touched the app's own sources
  (`git log -1 --format=%h -- ios-app/`), and have the server compute the
  same value from its deployed checkout. A mismatch then means `ios-app/`
  changed since the installed build.
- Or a content hash of `ios-app/` sources, or a hand-bumped version. A
  hand-bumped version is easy to forget; prefer the derived one.

Consider whether changes to the shared web/native contract
(`beebox/docs/mobile-contract.md`) should also count, since a contract change
can require a new app even when `ios-app/` changes little.

## Reporting and warning

- The app reports its version to the web: the native bridge already passes
  state to the web view, and native HTTP calls send
  `User-Agent: BeeBox-iOS/0.1` (never branched on today). Use the bridge or a
  query/header the web reads at load.
- The server includes the expected version (computed at build or deploy
  time) in what the web loads.
- On a mismatch, the web shows a small, dismissible notice (for example in
  the settings menu or a quiet line in the app bar), saying the iPhone app
  is older than the server and how to update it. Not a modal, not on every
  page load after dismissal; reappear only when the expected version changes
  again.
- Equal versions or a missing report (an older app that does not report)
  show nothing, or at most one gentle "this app does not report its version"
  note.

Related, the reverse direction: [stale web bundle detection](2026-08-12-stale-web-bundle-detection.md)
(the web client noticing a newer deployed web bundle). This is a shared web
and iOS surface; use the bbx-ios-overlap skill.
