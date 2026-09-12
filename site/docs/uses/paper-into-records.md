---
description: "Photograph or scan the things and papers you own, and end up with records you can search and ask questions of."
---
# Paper into records

There is a drawer, a folder of receipts, or a tray of odds and ends accumulated
over years, and you do not know what is in it. You buy a fourth glue stick
because you forgot the three you had. A **box** is one directory of your data, a
**card** is one markdown file in it, and **the agent** is the coding agent that
turns what you photographed into those cards.

**What you do.** Open the capture page on a phone, photograph things, and talk
while you do it, in as many takes as you like: what a thing is, where it lives,
that the pan is the good one for baking. Or drop in a folder of files, or run a
stack of pages through a scanner.

**What the box does.** A capture becomes a capture-session card: a timeline of your
transcribed speech with each photo placed where it was taken. A bulk drop becomes
an upload-batch card with a manifest. A scanned stack becomes one image card per
page, each carrying the text read off it and a description. The agent then
extracts one record card per thing: a name, where it is, dates, and links back to
the photo and to the words it came from. Asides that fit no field stay on the card as your words.

**What it needs.** A phone or a scanner, and a box the device can reach.
[Phone capture](../capabilities/phone-capture.md),
[triage](../capabilities/triage.md),
[the scanner contract](../contracts/scan-upload.md),
[what it requires](../08-what-it-requires.md).

**Where it is still rough.** A recorded walk of this exact task (one workroom
tray, 2026-08-24) produced twenty reviewed records and answered "do I have a glue
stick?" with "yes, four". In that walk the agent wrote counts as prose instead of
using the record card's quantity field in eighteen of the twenty. There is no
item or inventory card type: an inventory is a set of record cards, and the type
named `inventory` is the built-in Storage screen. The same walk found no screen
showing every container and its counts, and implementation words showing through
the interface. Capture is owner-gated, and photos rotated a quarter turn render
upside down.

**What makes it possible**

- **Capture sessions** ([phone capture](../capabilities/phone-capture.md)): one session is grouped into one timeline, which is how the agent knows which words describe which photograph.
- **Typed cards with validated fields** ([cards](../concepts/cards.md)): a count written into a sentence cannot be summed or sorted; a checked field can.
- **Triage** ([triage](../capabilities/triage.md)): categories are learned from where you file things, so a tray of unlike objects needs no taxonomy first.

**Read next.** [Triage](../concepts/triage.md),
[capture-session](../reference/cards/capture-session.md),
[image](../reference/cards/image.md),
[upload-batch](../reference/cards/upload-batch.md),
[record](../reference/cards/record.md), [pdf](../reference/cards/pdf.md).
