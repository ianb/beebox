---
title: "At the box root, browse shows only the raw listing — the root landmark's view and its links are unreachable in place"
workstream: landmark-in-browse
area: beebox
labels: [navigation, ui]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — when in the root landmark, it doesn't show the folder/landmark view, and then you can't open links in that landmark"
resolution: implemented
---

> Resolved by `0de51bccd`: landmarked directories now lead with the landmark's
> resolved links while retaining the raw directory listing below.

Browsing the box root (`/browse/`) renders the plain directory listing —
folders, then files, with `Box` appearing only as a card row — and no
landmark-flavored view. So the root landmark's curated links aren't openable
from the place itself; you'd have to know to click the landmark card row.
Reproduced on test1 (screenshot: raw listing at `/`, `Box  [landmark]` as
row 11).

What the code says (verified):

- The browse page uses a directory's landmark for the **tab title only**
  (`BrowsePage.tsx:153` `landmarks.forDir`, consumed by `useBrowseTitle`);
  the directory renderer (`renderers/directory.tsx`) has no landmark
  awareness at all.
- The links-rendering component (`LandmarkSection` → `LandmarkLinks`,
  `components/landmarks/LandmarkSection.tsx:124`) is consumed only by
  `LandmarksList` — the Landmarks page. Nothing renders a landmark's links
  in the browse/folder surface, for the root OR any directory.

So the root may just be where it's most noticeable (the root is every box's
front door, and its landmark is guaranteed to exist by `bbx init`) rather than
special-cased — unless the boxholder's "folder/landmark view" refers to a
surface I haven't identified; **clarify which view was expected** before
building: (a) the browse directory listing growing a landmark header with the
links when the dir has one, (b) the folder menu, or (c) something else.

Direction if (a): the directory view for a landmarked dir leads with the
landmark's label/symbol and links (the `LandmarkLinks` component exists and
caps+expands already), listing the raw entries below — root treated like any
landmarked dir. Note the links-become-file-metadata proposal
(`../features/2026-08-29-landmark-links-become-file-metadata.md`) redefines
where links come from; this issue is about the *surface*, and whichever link
source wins, the browse view should show them.
