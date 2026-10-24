---
description: "A Chrome extension for saving a web page, a comment on it, or your current browser tabs straight into your box (added: not on the original capability list, but a distinct and substantial capture path)."
---
# Web clipping

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Web clipping is a Chrome extension, called Bee Box Clerk, that sends
things from your browser into your box.

**What it does for you**

- Saves a web page you're looking at into a chosen destination in the box
  (a chat, or a landmark you've set up), keeping a readable copy plus a
  frozen snapshot of the page as it looked.
- Lets you attach a comment to the page you're saving, so your reaction is
  captured alongside the page itself.
- Sends your current browser tab arrangement to the box, which can propose
  which tabs to close; you review and apply or undo the proposal, staying in
  control of what actually happens in your browser.
- Lands a clipped page in a chat you can immediately talk to the agent
  about, rather than only filing it silently.
- Sends the page you are on, with an optional note, to the box with one
  "Send to box" button. The box saves the page in an incoming folder that git
  does not track, and a routing model chooses which conversation it belongs
  in, the same way as a thought typed on the box screen. When the choice is
  clear the page is posted there and that chat's agent files it; when it is
  not, the popup offers up to four destinations. The popup says where it went,
  with a link to open that chat, and a failed send can be tried again.

**What it needs**

The Chrome extension installed and pointed at a reachable box. See
[../install/index.md](../install/index.md).

**How it works, briefly**

The extension talks to the box over a small set of connections built just
for it. A saved page becomes a `webpage` card, with any comment attached as
a `commentary` card. A sent tab arrangement becomes a `tab-arrangement` card
the box can propose edits to; applying or undoing it relays back to the
extension in your browser. Nothing here runs on a schedule: it acts when you
use the extension.

**Limits**

Send to box needs the same OpenRouter key as quick chat; without it the page is
saved and the popup offers recent chats to choose from. The routing model sees the page's
title, address and site and your note, not the page text.
Tab arrangements always land in one fixed destination; only the page/comment
path lets you choose where it goes. The documentation does not describe a
non-Chrome browser extension.

**Go deeper**

[../reference/cards/webpage.md](../reference/cards/webpage.md),
[../reference/cards/commentary.md](../reference/cards/commentary.md),
[../reference/cards/tab-arrangement.md](../reference/cards/tab-arrangement.md),
[phone-capture.md](phone-capture.md)
