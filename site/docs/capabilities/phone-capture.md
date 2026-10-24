---
description: "A paired iOS app for capturing photos, voice, and files into your box from your phone, and a Chrome extension for clipping web pages."
---
# Phone and browser capture

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Capture is how content from your phone or browser gets into the box.

**What it does for you**

- Pairs your iPhone to a box by scanning a QR code or opening a link, so
  captures are attributed to you without signing in each time.
- Lets you record voice, take photos, or upload files from the native app,
  landing in the box's web chat as a normal message.
- Keeps an interrupted or backgrounded capture uploading instead of losing
  it, and tells you plainly if a recording got cut off.
- Groups everything from one recording session into a single timeline you
  can read back, with silences and photos in place.
- Saves a thought by voice through Siri ("Save a thought in Bee Box"), starts
  and stops a voice note by phrase, from the Action Button, or from a Control
  Center or Lock Screen control (iOS 18 and later), and takes a shared image,
  web link, or text clipping from any app's share sheet, optionally with a few
  words saying what the box should do with it. Each goes to one chosen "capture
  default" box, so browsing another box does not change where a private thought
  lands. The phone confirms "Saved on your phone", which means kept locally, not
  yet delivered; offline captures stay visible and upload when the box is
  reachable, and you can add context to a saved item later. A shared item with
  no words at all is not left unread: about two minutes after the last one of a
  burst, the box's agent gives each a title and a description and files it under
  the place that fits, or leaves it in the box's captures folder when none does.
  It only files; it does not act on what the item says, and it never deletes.
  If words arrive within the wait, they are taken as the request and the item is
  not filed on its own.
- Receives the box's notifications as iPhone push: a tap opens the chat, card,
  or question the notification is about, on the box that sent it. See
  [notifications.md](notifications.md).
- Lets you see and revoke paired devices, and lock a paired box behind Face
  ID or your device passcode.

**What it needs**

An iPhone (iOS 17 or later) for the native app, or Chrome for the extension.
Both need a box already reachable from your device. See
[../install/index.md](../install/index.md).

**How it works, briefly**

The iOS app is a native shell around the same web chat you use in a
browser; it adds native pairing, recording, and speech input, delivered into
the chat over a bridge. It opens on a native box screen, with a text box for a
thought, your recent chats, and your other boxes; the chat itself loads when
you open one. A thought typed or spoken there waits in an outbox on the phone
if the box is unreachable, and the app retries. A finished capture becomes a `capture-session` card
with typed cards for what it contains (`image`, `audio`, `file`). Capture
runs when you use it, not on a schedule. Clipping web pages is a separate
capability: [web-clipping.md](web-clipping.md). The Siri, Shortcuts, Action
Button, and share-sheet paths are described in
[../reference/siri-shortcuts.md](../reference/siri-shortcuts.md).

**Limits**

The Siri, voice-note control, and share-with-instructions paths are built and
pass their automated tests, but the project's own plan lists the physical-phone
checks (Siri matching the phrases, the microphone, the lock screen, background
upload after a force quit) as not yet run. A box set to require device unlock
cannot be reached through Siri at all, even with the phone unlocked. A voice
note stops and saves itself at ten minutes, and a sudden termination can lose
the last unfinished segment (up to ten seconds). Owner-gated surfaces like device pairing require signing in as the box owner;
a shared or guest device cannot pair itself. Push notifications to the app have
been tested on a simulator but the documentation says the walk-through on a real
iPhone has not been run, and they rely on an Apple key held by whoever builds
and installs the app. The app's record button does not yet show narration mode
or paused state the way the web button does. Importing from Apple Photos is a
separate Mac-side path that needs system permissions, and the documentation
says it has not been verified on a real Mac. The documentation does not
describe an Android app.

**Go deeper**

[../reference/cards/capture-session.md](../reference/cards/capture-session.md),
[../reference/cards/image.md](../reference/cards/image.md),
[../reference/cards/audio.md](../reference/cards/audio.md),
[../reference/cards/upload-batch.md](../reference/cards/upload-batch.md),
[../contracts/mobile-contract.md](../contracts/mobile-contract.md)
