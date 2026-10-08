---
title: "An unreadable picked image is reported as a format fault or a network fault"
workstream: unattached
area: beebox
labels: [low]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walk (second walk), 2026-10-08
---

The second B-inventory walk picked an image file that could not be decoded.
The composer said, in effect, that the JPEG format was refused, and in the
same sentence that JPEG works. The walker: the message contradicts itself.

`beebox/src/frontend/src/lib/image-paste.ts:219-226` (`unsupportedImageMessage`)
names the file's format and blames the browser ("this browser can't read that
format. JPEG, PNG, GIF and WebP work.") for any decode failure. A file that
cannot be read after it was picked, or a damaged JPEG, gets the same text.
Reproduced with the unreadable file.

In this walk the trigger was the harness: `bin/browse upload` passed a
relative path, and the page received an empty file that failed on read (fixed
in `ee5289dd1`). The first B-inventory walk the same day sent JPEGs damaged in
the repository (see
[rename-damaged binaries](../closed/bugs/2026-10-08-rename-damaged-binaries-still-in-tree.md)).
Real triggers are rarer, but the copy is wrong whenever one occurs.
A decode failure of a format the app accepts needs its own message, such as
"This image file looks damaged".

Report: [B2](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 7).
