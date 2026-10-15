# When only a human on a phone can confirm it
## Supporting: an open issue with needs: [manual-testing]
- The tag means "landed, and nobody has looked at it yet"; the issue says exactly what to do and what counts as passing
- 25 open, 27 closed; the queue is the developer's catch-up list

```markdown
---
title: "A capture that succeeds says nothing — success is a chip disappearing,
        so the user assumes it failed and re-captures"
needs: [manual-testing]
priority: normal
---
## Manual testing
1. From the phone, capture a photo and a short clip into a chat, then stay in
   the chat. The bubble must show `preparing…`, then report its age if
   preparation runs long, then turn green and read `delivered` for about three
   seconds before the row leaves and the capture message stands in its place.
2. Repeat, but leave the chat during preparation and come back. The capture
   message must be there; nothing should be stuck.
3. Confirm you no longer feel the need to re-capture to check.
```

Notes:
Path: issues/bugs/2026-08-20-capture-success-is-invisible.md. The tag also pins the workstream's test box against cleanup until the human confirms (bottleneck 5).
