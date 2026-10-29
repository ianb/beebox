---
description: "Bee Box Desktop, the Mac menu-bar app: runs a box on your Mac, and connects your Mac to boxes anywhere, sending new files from watched folders or a Photos album."
---
# Bee Box Desktop (Mac app)

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Bee Box Desktop is a Mac app that lives in the menu bar. It does two
things, and you can use either one, or both:

- **Run a box on your Mac**, with no server and no Docker.
- **Connect your Mac to boxes**, wherever they run, and send them new files
  from folders and Photos albums automatically.

You use a box itself in your web browser, either way.

**Download:** the latest release is at
[github.com/ianb/beebox/releases/latest](https://github.com/ianb/beebox/releases/latest).
Open the DMG and drag Bee Box Desktop into Applications. The app is signed and
notarized by Apple and updates itself.

**Running a box on your Mac**

- Under Preferences → Box on this Mac, turn on hosting. The app downloads the
  Bee Box engine and runs a box in a small virtual machine on the Mac, so
  the Mac itself is the machine the box lives on.
- The box opens in your browser from the menu, at
  `http://localhost:3280/box/`. It is reachable from this Mac only.
- Its files are ordinary files in `~/BeeBox/<name>/`, which you can show in
  Finder from Preferences.
- Until you turn hosting on, the app downloads nothing for it.

**Connecting your Mac to boxes**

- **Pairing.** Open a box's Settings → Companion Apps, choose Copy Link
  (Mac), then choose Pair with a Box… in the app's menu; the app offers the
  link it finds on the clipboard. It pairs with several boxes at once: on a
  home server, a VPS, or this Mac. Each paired box opens in your browser from
  the menu.
- **Watched folders.** Under Preferences → Watched Folders, choose a folder
  (for example, the one a document scanner saves to) or a Photos album, and
  the box it goes to. Each new file is sent once and filed in the box like a
  scan. For a folder, you choose what happens to a file after it is sent:
  keep it, move it to an "imported" folder beside it, or move it to the
  Trash. The app checks when a file appears, every 15 minutes, and when the
  Mac wakes, and sends one notification when files go out or a box refuses
  one.
- **Who can.** Anyone who can open a box can pair a Mac with it and set up a
  watched folder for it; the Mac acts as the person who made the pairing
  link. Each Mac's upload credential shows by name in the box's Settings →
  Scan uploaders, where that person or the box owner can revoke it.
- **Cleaning up.** Removing a box, or Uninstall in Preferences → General,
  first revokes the credentials the app holds on each box.

**What it does not do**

- It has no window of its own for using a box: no chat, cards, or browsing in
  the app. Those stay in the browser.
- It has no quick capture yet: no global shortcut, voice input, sending the
  current selection, or drop target. On a phone, the iOS app does capture
  ([phone-capture.md](phone-capture.md)); for web pages, use the Chrome
  extension ([web-clipping.md](web-clipping.md)).
- It does not copy a box's files to the Mac or keep them in sync. Watched
  folders send files one way, into the box.
- A box on your Mac is not reachable from your phone or other computers, and
  the app runs one such box at a time.
- It is not needed to use Bee Box. A box works the same from any browser.

**What it needs**

A Mac with Apple silicon running macOS 26 or later. Running a box on the Mac
also needs your own coding-agent login and a few gigabytes of disk for the
engine and virtual machine (see
[../08-what-it-requires.md](../08-what-it-requires.md)). Connecting to a box
elsewhere needs a box you can sign in to.

**How it works, briefly**

A box on your Mac runs the published Bee Box container image in a virtual
machine using Apple's Containerization framework; shared data (the image,
logins, logs) is in `~/Library/Application Support/Bee Box/`. Pairing
exchanges a one-time link for a device credential, the same way the iOS app
pairs; the credential is kept in the Mac's Keychain. For watched folders, the
app asks the box for a separate upload credential and sends files to the
box's scan upload endpoint, the same one the command-line `scan-uploader`
script uses; a record on the Mac keeps a file from being sent twice. The app
keeps a log at `~/Library/Application Support/Bee Box/logs/app.log`.

**Engine updates**

The app and the engine release separately. Each time the box starts, the app
checks the daily published engine image, and downloads it when it is newer and
the app can run it. If the image needs a newer app, the app leaves it alone and
Preferences says so. The update waits when the box has uncommitted edits, and a
running box is never stopped for one. If the new engine fails to start, the app
goes back to the previous engine and the box starts again. After an update has
finished there is no automatic rollback. Preferences → Box on this Mac has a
"Check for Engine Updates…" button that stops the box, checks, and starts it.

**Backups**

The app can keep encrypted backups of the box it hosts in a restic repository
you choose. It checks for a due backup while it runs, waits ten minutes after
reopening before an overdue one, and runs none while the app is closed. You set
the repository up with the app's `backup` command line, or from the box's
Admin page. See [backups](../install/backups.md) and [your data and safety](../10-your-data-and-safety.md).

**Limits**

The app is new (first release October 2026) and has had little use beyond its
author.
