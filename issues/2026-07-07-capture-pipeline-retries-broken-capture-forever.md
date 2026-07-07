---
area: callback-box
filed-by: agent
discovered-in: prod (one personal box) — the box's own agent flagged process-captures failing 3,333×; boxholder asked me to look
---

# process-captures retries a permanently-broken capture forever (infinite failure loop)

On one prod box, `process-captures` has failed **every wakeup since ~Jul 4**
(537 failed run-dirs on disk for Jul 7 alone; ~3,333 total). Root of the loop:

```
describe-images step:
  "No image file found for card box/inbox/capture-20260514T1637-10285ac1.attach/photo-001.image.card, skipping"
  "No image file found for card …/photo-002.image.card, skipping"
  Error: No valid images found  → exit 1  → whole procedure fails
```

The capture card + its `.attach/photo-00N.image.card` metadata cards exist, but
the **actual image binaries are gone** (empty `.attach/` dirs, dated Jul 4 17:25
— when the box was cloned to the server). So `describe-images` finds no valid
images, exits 1, the procedure fails, the capture stays in `box/inbox/`, and the
next wakeup retries it. Forever.

Two distinct problems:

1. **The bug (fix this): a permanently-broken capture must not loop.** A capture
   whose images can't be found is not a transient failure — retrying it every
   wakeup will never succeed. `process-captures` should detect "this capture
   can't be processed" and quarantine/archive it out of `box/inbox/` (or mark it
   failed) after the first unrecoverable failure, not hard-fail the whole run and
   re-attempt indefinitely. Bonus harm: each failed run commits to the box git
   ("Failed procedure: process-captures"), so the box history is polluted with a
   failure commit per minute.

2. **The root cause (data): the image binaries were lost in the Jul-4 box clone**
   — same class as the other gitignored/binary files dropped during the repo move
   this session (deploy/server-ip, box .env). Whatever ships a box to the server
   isn't carrying capture attachment binaries. Worth confirming whether these
   specific images exist in a backup and, more importantly, why the clone dropped
   them (are capture binaries gitignored / LFS / in a separate image-backup store
   that setup-server doesn't pull?).

Note the procedure card lives in the box (`config/procedures/process-captures.procedure.card`),
so #1 is a template change with the usual stock-vs-box-local rollout question
(template rollout parks silently on boxes without a tracker entry).

Immediate stopgap while this is unfixed: disable that box's process-captures
schedule, or quarantine that one May-14 capture out of the inbox.
