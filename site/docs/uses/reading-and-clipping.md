---
description: "Save pages from your browser with your own remarks attached to the passage, and find them again when you need them."
---
# Reading and clipping

You read a lot and keep almost none of it. Bookmarks rot into a list of titles
you cannot evaluate, and the thought you had while reading is gone entirely. A
**box** is one directory of your data, a **card** is one markdown file in it, and
**the agent** is the coding agent that can search across everything you saved.

**What you do.** Install Bee Box Clerk, the Chrome extension, and point it at
your box. Save the page you are reading, or select the passage you are looking
at, write what you think, and save that with the page. Send your open tabs to the
box when there are too many. Later, ask the box about what you read.

**What the box does.** A saved page becomes a webpage card, designed to hold
a readable text version of the page plus a frozen snapshot of how it looked
(markdown and HTML, for the curious), so the copy survives the original
changing; see below for how much of that has been seen working. A remark
becomes a commentary card attached to that page, anchored to the passage and
shown inline when you open the page. A sent tab set becomes a
tab-arrangement card the box proposes an arrangement for, which you apply or undo
back in the browser. Saved pages are ordinary cards, in box search and in the
agent's context, and you can open a chat with the page beside it.

**What it needs.** Chrome, the extension, and a box the browser can reach.
[Web clipping](../capabilities/web-clipping.md),
[chat](../capabilities/chat.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** Chrome only; the documentation describes no
extension for another browser. Tab arrangements always land in one fixed
destination; only the page-and-comment path lets you choose where a clipping
goes. Nothing here happens on a schedule, so a reading list you never clip stays
outside the box. The extension cannot be driven by the project's automated
browser checks, so saving a page and arranging tabs are verified in the code and
not in use; in a checked box, neither saved page carried a frozen snapshot or a
capture date.

**What makes it possible**

- **Typed cards with validated fields** ([cards](../concepts/cards.md)): a page and a remark on it are two checked types, so a clipping carries its passage anchor and its readable copy.
- **Landmarks** ([landmarks](../concepts/landmarks.md)): a flat tree weights every directory equally; a landmark is the editorial layer, and marks where a clipping may be filed.
- **Triage** ([triage](../capabilities/triage.md)): a new category is promoted by dropping a landmark rather than by defining a taxonomy first.
- **Provenance** ([where a fact came from](../capabilities/provenance.md)): your exact words are kept as a quote and a fact points at its origin, so what the agent inferred is always distinguishable from what you said.
- **Integrity** ([it keeps itself coherent](../capabilities/integrity.md)): links between cards are checked and rewritten when a card moves, so a collection that grows for years stays navigable rather than accumulating dead references.

**Read next.** [Webpage](../reference/cards/webpage.md),
[commentary](../reference/cards/commentary.md),
[extfile](../reference/cards/extfile.md),
[tab-arrangement](../reference/cards/tab-arrangement.md).
