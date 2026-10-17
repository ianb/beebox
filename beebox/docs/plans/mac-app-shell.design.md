---
title: "Bee Box for Mac as a shell around a box: design"
status: draft
workstream: app-shell
issues: []
---
# Bee Box for Mac as a shell around a box: design

**Parent plan:** [mac-app-shell.md](mac-app-shell.md), Tracks D–G.

The app lives in the menu bar and has no windows of its own (boxholder,
2026-10-17: "no window at all, only web access"). Everything below is a menu
item, a system alert, or the system's folder picker. Boxes open in the
browser.

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
| First connection to a box | Show and confirm | "Pair with a Box…" in the menu → a system alert, pre-filled from the clipboard, that names the box, host and scheme | Person-started |
| Photos album | Act after one setup | "Add Photos Album…" asks for Photos access once, then offers the albums as a submenu | Background |
| Uploads stuck | Show, don't interrupt | A mark on the menu-bar icon; the folder's menu line reads "Stuck since Tue: drive not mounted" | Waits to be found |
| Trying a local box | Act on the person's switch | "Run a box on this Mac" toggle; the menu shows download and start progress lines | Person-started |
| Browser-only person | Quiet | The menu offers "Pair with a Box…" and "Run a box on this Mac", both off | None |
| Old uploader on the same folder | Show, refuse | Adding that folder shows an alert naming the old agent and the command that removes it | Person-started |

A stuck folder never notifies: it would repeat every sweep with nothing new
to say (`scan-uploader/src/cli/notify.ts:17-26`). The icon mark is the place
for that, and it goes away when the next sweep succeeds.

## Menu shape

```
Bee Box
  Home — Open                          (paired boxes; ⌘-click opens settings page)
  Workshop — Open
  ─────────
  Upload Folders
    ~/Scans → Home         last sent 9:14   ▸  Box ▸ Home ✓ / Workshop
                                               After upload ▸ Keep ✓ / Move to "imported" / Move to Trash
                                               Remove Folder…
    Photos "Bee Box" → Home  stuck: no Photos access ▸ …
    Add Folder…
    Add Photos Album…
  ─────────
  Pair with a Box…
  Run a box on this Mac                 (toggle; off by default)
  Open at Login                         (toggle)
  ─────────
  Quit
```

Each box line also has a "Remove Box…" item, and "Pair Again…" when the box
refused its credential.

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

- **Pairing:** confirmation every time. The alert names what will be added.
  Nothing moves it to automatic: a link can come from anywhere.
- **Turning on upload for a folder:** confirmation, once. The alert says it
  creates a scanner credential on that box. After that, uploading is
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

- **The clipboard holds no pairing link:** the alert opens with an empty field
  and says "On your box, open Settings, choose Create QR, then Copy Link, and
  paste it here."
- **The link has expired or was used:** the box's own message, then "Make a
  new link on the box and try again."
- **An http link to a public address:** refused: "This link is not encrypted
  and does not point at a local network address."
- **The box refused the scanner credential** (paired by a member who is not
  the owner): the folder line reads "Only the box owner's pairing can send
  scans."
- **A file the box rejected:** it stays in the folder, and the notification
  names it once. The folder line keeps the count.
- **Nothing to do:** the menu shows the last sweep time and nothing else.

## Walkthrough

Tomas connects his Mac to the server box "Workshop" for scans.

1. In the browser he opens Workshop's Settings. In the companion pairing
   section he clicks "Create QR", then "Copy Link". The box creates a ticket
   that lasts 10 minutes.
2. He chooses "Pair with a Box…" from the menu-bar icon. The alert shows
   "Add Workshop at workshop.example.ts.net (https)?" with the link filled in.
   He clicks Add. The app redeems the ticket, stores the device credential in
   the Keychain, and clears the clipboard. "Workshop — Open" appears in the
   menu.
3. He chooses "Add Folder…" and picks `~/Scans` in the system folder picker.
   The app checks for the old uploader's agent on that folder and finds none.
   An alert asks "Send new files in Scans to Workshop? This creates a scanner
   credential named mac-tomas-mbp-3f2a on Workshop." He confirms. The app
   creates the scan token through his pairing and stores it in the Keychain.
4. He scans two pages. About ten seconds after the scanner finishes writing,
   the sweep uploads the PDF, and a notification reads "1 scan sent to
   Workshop". The folder line reads "last sent 9:14". The file stays in
   `~/Scans`, because Keep is the default.
5. What is left behind: a device and a scan token listed by name in
   Workshop's settings, the scan in Workshop's scan quarantine, and the file
   in `~/Scans`.
