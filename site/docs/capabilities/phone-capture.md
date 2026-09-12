---
description: "A paired iOS app for capturing photos, voice, and files into your box from your phone, and a Chrome extension for clipping web pages."
---
# Phone and browser capture

A box is a directory of your data kept in git; a card is a markdown file
with structured frontmatter; the agent is the coding agent (Claude Code or
Codex) that operates the box. Capture is how content from your phone or
browser gets into the box.

**What it does for you**

- Pairs your iPhone to a box by scanning a QR code or opening a link, so
  captures are attributed to you without signing in each time.
- Lets you record voice, take photos, or upload files from the native app,
  landing in the box's web chat as a normal message.
- Keeps an interrupted or backgrounded capture uploading instead of losing
  it, and tells you plainly if a recording got cut off.
- Groups everything from one recording session into a single timeline you
  can read back, with silences and photos in place.
- Lets you see and revoke paired devices, and lock a paired box behind Face
  ID or your device passcode.

**What it needs**

An iPhone (iOS 17 or later) for the native app, or Chrome for the extension.
Both need a box already reachable from your device. See
[../install/index.md](../install/index.md).

**How it works, briefly**

The iOS app is a thin native shell around the same web chat you use in a
browser; it adds native pairing, recording, and speech input, delivered into
the chat over a bridge. A finished capture becomes a `capture-session` card
with typed cards for what it contains (`image`, `audio`, `file`). Capture
runs when you use it, not on a schedule. Clipping web pages is a separate
capability: [web-clipping.md](web-clipping.md).

**Limits**

Owner-gated surfaces like device pairing require signing in as the box owner;
a shared or guest device cannot pair itself. The documentation does not
describe an Android app.

**Go deeper**

[../reference/cards/capture-session.md](../reference/cards/capture-session.md),
[../reference/cards/image.md](../reference/cards/image.md),
[../reference/cards/audio.md](../reference/cards/audio.md),
[../reference/cards/upload-batch.md](../reference/cards/upload-batch.md),
[../contracts/mobile-contract.md](../contracts/mobile-contract.md)
