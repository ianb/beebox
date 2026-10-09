---
title: "Web send recovery copies hold full image bytes in sessionStorage; consider keeping them small"
workstream: unattached
area: beebox
labels: [chat]
filed-by: agent
discovered-by: Ian
discovered-in: main — "exceeded the quota" when sending two images
---

On 2026-10-08 a web send with two images failed: "Failed to execute
'setItem' on 'Storage': Setting the value of 'bbx-pending-web-sends:<box>'
exceeded the quota." A new tab did not help, so the two images alone
exceeded the ~5 MB sessionStorage quota.

Before a web send goes out, `pending-sends.ts`
(`beebox/src/frontend/src/components/chat/conversation/use-bound-emission/`)
saves a reload-recovery copy of the whole emission, every image as base64
(+33%), even an image that already has a box `path` (uploaded original).
Rows stay until accepted or restored; `rejected`/`recovered` rows and
`bbx-pending-web-sends-quarantine:*` copies keep their images for the tab's
life.

**Done now (1f284170a):** a quota refusal no longer blocks the send. The row
is kept in memory only, the send goes out, and a reload would not recover it.
Other storage failures still fail closed.

## To consider

- Keep the recovery copy small: an image with a box `path` needs only the
  path, not its bytes; maybe store downscaled bytes for images not yet
  uploaded. The boxholder does not want IndexedDB for this (it fills up and
  does not clean up as easily).
- Show the user when a message is sending without a recovery copy, if that
  matters in practice.
- Clean up stale `rejected`, `recovered`, and quarantined rows, which hold
  image bytes for the tab's life.
