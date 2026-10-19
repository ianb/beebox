---
description: "Bee Box Desktop, the Mac menu-bar app: pairs with boxes, opens them in the browser, sends new files from watched folders or a Photos album, and can optionally run a box on the Mac."
---
# Bee Box Desktop (Mac app)

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Bee Box Desktop is a small Mac app that lives in the menu bar and
connects a Mac to one or more boxes. You use the box itself in your web
browser, as before.

**Download:** the latest release is at
[github.com/ianb/beebox/releases/latest](https://github.com/ianb/beebox/releases/latest).
Open the DMG and drag Bee Box Desktop into Applications. The app is signed and
notarized by Apple and updates itself.

**What it does for you**

- **Opens your boxes.** Pair it with a box, and the box opens in your
  browser from the menu. To pair, open the box's Settings → Companion Apps,
  choose Copy Link (Mac), then choose Pair with a Box… in the app's menu; the
  app offers the link it finds on the clipboard. It can pair with several
  boxes, wherever they run: a home server, a VPS, or this Mac.
- **Sends new files to a box from watched folders.** Under Preferences →
  Watched Folders, choose a folder (for example, the one a document scanner
  saves to) or a Photos album, and the box it goes to. Each new file is sent
  once and filed in the box like a scan. For a folder, you choose what happens
  to a file after it is sent: keep it, move it to an "imported" folder beside
  it, or move it to the Trash. The app checks when a file appears, every 15
  minutes, and when the Mac wakes, and sends one notification when files go
  out or a box refuses one.
- **Can run a box on this Mac.** Under Preferences → Box on this Mac, it can
  run a box in a small virtual machine, reachable from this Mac only (at
  `http://localhost:3280/box/`). This is off until you turn it on, and while
  it is off the app downloads nothing.
- **Cleans up after itself.** Removing a box, or Uninstall in Preferences →
  General, first revokes the credentials the app holds on each box.

Anyone who can open a box can pair a Mac with it and set up a watched folder
for it; the Mac acts as the person who made the pairing link. Each Mac's
upload credential shows by name in the box's Settings → Scan uploaders, where
its owner or the box owner can revoke it.

**What it does not do**

- It has no window of its own for using a box: no chat, cards, or browsing in
  the app. Those stay in the browser.
- It has no quick capture yet: no global shortcut, voice input, sending the
  current selection, or drop target. On a phone, the iOS app does capture
  ([phone-capture.md](phone-capture.md)); for web pages, use the Chrome
  extension ([web-clipping.md](web-clipping.md)).
- It does not copy a box's files to the Mac or keep them in sync. Watched
  folders send files one way, into the box.
- It is not needed to use Bee Box. A box works the same from any browser.
- A box on this Mac is not reachable from other devices, and the app runs
  one such box at a time.

**What it needs**

A Mac with Apple silicon running macOS 26 or later, and a box you can sign in
to. Running a box on the Mac also needs your own coding-agent login and a few
gigabytes of disk for the box image and virtual machine (see
[../08-what-it-requires.md](../08-what-it-requires.md)).

**How it works, briefly**

Pairing exchanges a one-time link for a device credential, the same way the
iOS app pairs; the credential is kept in the Mac's Keychain. For watched
folders, the app asks the box for a separate upload credential and sends files
to the box's scan upload endpoint, the same one the command-line
`scan-uploader` script uses; a record on the Mac keeps a file from being sent
twice. A box on this Mac runs the published Bee Box container image in a
virtual machine using Apple's Containerization framework; its files are in
`~/BeeBox/<name>/`, and shared data (the image, logins, logs) is in
`~/Library/Application Support/Bee Box/`. The app keeps a log at
`~/Library/Application Support/Bee Box/logs/app.log`.

**Limits**

The app is new (first release October 2026) and has had little use beyond its
author. Photos album export and running a box on the Mac have been exercised
less than pairing and folder uploads. The box on this Mac updates its engine
only when the app itself updates.
