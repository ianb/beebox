---
title: "Bee Box for Mac as a shell around a box: design"
status: draft
workstream: app-shell
issues: []
---
# Bee Box for Mac as a shell around a box: design

**Parent plan:** [mac-app-shell.md](mac-app-shell.md), Tracks D–G.

The app lives in the menu bar. Boxes open in the browser; the app has no
web view (boxholder, 2026-10-17: "no window at all, only web access"). It has
one window of its own, Preferences, which holds pairing, upload folders, and
the hosting switch (boxholder, 2026-10-17: "There should probably be
preferences? And some pairing interface"). The menu is for glancing and
opening.

## Situations

- When Priya feeds a stack of receipts through the ScanSnap at the kitchen
  desk, I want them to reach the Home box without my opening anything, so I
  can put the paper in the recycling and forget it.
- When Tomas's box runs on a server and he sits down at his Mac, I want to
  connect the Mac to that box once, by copying a link from the box's
  settings page, so I can send scans there without the terminal setup the
  old uploader needed.
- When Priya adds phone photos of the kids' school notices to a "Bee Box"
  album, I want them uploaded from the Mac that syncs her library, so I can
  capture on the phone and let the Mac carry them in.
- When the network drive that holds the scan folder is unmounted, or the box
  is down for a day, I want to see that uploads are stuck when I next glance
  at the menu bar, so I can fix it before a week of scans piles up unseen.
- When Noor wants to try Bee Box without a server, I want to turn on "Run a
  box on this Mac", so I can see whether it suits me before setting anything
  else up.
- **Quiet case:** when Idris only uses his box in the browser, I want the app
  to do nothing and download nothing, so I can keep it installed for later
  without it costing disk space or attention. The same holds for Bram, whose
  old command-line uploader already works: the app must not take over his
  folder behind his back.

## Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Scans land | Act: upload; show only what is new | One notification per sweep that uploaded or was refused something ("3 scans sent to Home"); nothing for a quiet sweep | Background |
| First connection to a box | Show and confirm | Preferences → Boxes → "Pair with a Box…" sheet, pre-filled from the clipboard, previews the box before Add | Person-started |
| A `beebox://pair` link clicked in the browser | Show and confirm | The app opens Preferences → Boxes with the same sheet filled in | Person-started |
| Photos album | Act after one setup | Preferences → Uploads → "Add Photos Album…" asks for Photos access once, then lists the albums | Background |
| Uploads stuck | Show, don't interrupt | A mark on the menu-bar icon; the menu line and the Uploads row read "Stuck since Tue: drive not mounted" | Waits to be found |
| Trying a local box | Act on the person's switch | Preferences → General → "Run a box on this Mac"; the menu shows download and start progress | Person-started |
| Browser-only person | Quiet | The menu shows "No boxes paired" and "Preferences…"; nothing runs | None |
| Old uploader on the same folder | Show, refuse | Adding that folder shows an inline message naming the old agent and the command that removes it | Person-started |

A stuck folder never notifies: it would repeat every sweep with nothing new
to say (`scan-uploader/src/cli/notify.ts:17-26`). The icon mark is the place
for that, and it goes away when the next sweep succeeds.

## Menu and Preferences

The menu, for glancing and opening:

```
Bee Box
  Home — Open                       (each paired box; opens in the browser)
  Workshop — Open
  ─────────
  Scans → Home: last sent 9:14      (one status line per upload folder)
  Photos "Bee Box" → Home: stuck, no Photos access
  ─────────
  Local box: running                (only when hosting is on; Start / Stop)
  ─────────
  Pair with a Box…                  (opens Preferences → Boxes with the sheet)
  Preferences…                ⌘,
  Quit
```

Preferences, a standard macOS settings window with three tabs:

- **Boxes.** The paired boxes as a list: label, host, and state (connected,
  "credential refused — pair again", unreachable). Buttons: "Pair with a
  Box…", "Open in Browser", "Remove…".
  - **The pairing sheet** has a link field, filled from the clipboard when it
    holds a `beebox://pair` link, and one line of help: "On your box, open
    Settings, choose Create QR, then Copy Link."
  - As soon as the field parses, the sheet previews the box's label, host,
    and scheme, with "not encrypted" for http. A link that does not parse
    gets an inline message.
  - "Add" redeems the ticket and shows progress in the sheet. A failure stays
    in the sheet with the box's message, so the person can paste a new link
    without starting over.
- **Uploads.** One row per upload folder: folder, box, what happens after
  upload (Keep / Move to "imported" / Move to Trash), an optional Photos
  album, and status (last sent, counts, current problem). Buttons: "Add
  Folder…" (system folder picker), "Add Photos Album…", "Remove…".
- **General.** "Run a box on this Mac" (off by default; shows download size and
  progress when turned on), "Open at Login", and "Remove downloaded box image".

## Spirit

- **Serves:** "The best stuff comes from the people" — Priya's paper and
  photos reach the box as they are, and nothing is moved or deleted unless she
  chose a disposition for that folder.
- **Serves:** "You should be able to see the gears" — each folder shows when it
  last sent and why it is stuck; the scanner credential carries a readable
  name (`mac-<host>-…`) in the box's Settings → Scan uploaders.
- **Risks:** "It should feel like a place" — a menu-bar utility can read as
  plumbing rather than part of the box. The guard: the app says nothing about
  itself beyond status; what the scans become happens in the box, where the
  person already looks.

## Trust

- **Pairing:** confirmation every time. The sheet previews what will be added,
  and nothing is redeemed until "Add".
  Nothing moves it to automatic: a link can come from anywhere.
- **Turning on upload for a folder:** confirmation, once. Adding the folder
  says it creates a scanner credential on that box. After that, uploading is
  automatic: the folder choice is the standing instruction.
- **What happens to the file after upload:** the person's choice per folder;
  the default is Keep. The app never deletes; "Move to Trash" is recoverable.
- **Hosting:** the person's switch. With it off the app downloads nothing.
- **Removing a box or a folder:** confirmation, because it revokes the
  scanner credential on the box.

## The box's settings page

The pairing section is headed "iOS Companion", with the hint "Pair the native
app with this box using a short-lived QR code"
(`beebox/src/frontend/src/components/settings/CompanionPairingSection.tsx:124-128`).
Track D changes the copy to "Companion apps" and "Pair the iPhone or Mac app
with this box. Scan the QR code on a phone, or copy the link into the Mac
app." The behavior does not change.

## When it goes wrong or does nothing

- **The clipboard holds no pairing link:** the sheet opens with an empty field
  and its help line.
- **The link has expired or was used:** the box's own message, then "Make a
  new link on the box and try again."
- **An http link to a public address:** refused: "This link is not encrypted
  and does not point at a local network address."
- **The box refused the scanner credential** (paired by a member who is not
  the owner): the Uploads row reads "Only the box owner's pairing can send
  scans."
- **A file the box rejected:** it stays in the folder, and the notification
  names it once. The Uploads row keeps the count.
- **Nothing to do:** the menu shows the last sweep time and nothing else.

## Walkthrough

Tomas connects his Mac to the server box "Workshop" for scans.

1. In the browser he opens Workshop's Settings. In the companion pairing
   section he clicks "Create QR", then "Copy Link". The box creates a ticket
   that lasts 10 minutes.
2. He chooses "Pair with a Box…" from the menu-bar icon. Preferences opens
   on Boxes with the sheet; the link is filled in, and the preview reads
   "Workshop — workshop.example.ts.net (https)". He clicks Add. The app
   redeems the ticket, stores the device credential in the Keychain, and
   clears the clipboard. Workshop appears in the list and in the menu.
3. On the Uploads tab he chooses "Add Folder…" and picks `~/Scans` in the
   system folder picker, then Workshop as its box. The app checks for the old
   uploader's agent on that folder and finds none. The row says "Sending new
   files creates a scanner credential named mac-tomas-mbp-3f2a on Workshop"
   and he clicks "Start Uploading". The app
   creates the scan token through his pairing and stores it in the Keychain.
4. He scans two pages. About ten seconds after the scanner finishes writing,
   the sweep uploads the PDF, and a notification reads "1 scan sent to
   Workshop". The folder line reads "last sent 9:14". The file stays in
   `~/Scans`, because Keep is the default.
5. What is left behind: a device and a scan token listed by name in
   Workshop's settings, the scan in Workshop's scan quarantine, and the file
   in `~/Scans`.
