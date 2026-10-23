---
title: "Gmail sync stalls forever on a message deleted after history named it, and no one is told"
workstream: gmail-404-stuck
area: beebox
filed-by: agent
discovered-by: human
discovered-in: production — boxholder noticed missing mail
design: ../../beebox/docs/plans/connector-failing-reaches-people.md
---

## The defect

`syncWorkingSet` (`beebox/src/connectors/gmail/connector.ts`) lists Gmail
history from the saved `historyId`, then fetches every message it names with
`getMessage`. History keeps naming a message after it is deleted, and Gmail
answers 404 for it. The 404 failed the whole sync before `persistState`, so
`historyId` never advanced. Every later sync replayed the same history and
failed the same way. The connector stopped importing mail until someone
changed its state by hand. Reauthorizing Google could not help.

`refreshThreadSnapshots` had the same shape for a deleted tracked thread
(`getThread`), and `parseGmailMessage` for an attachment (`getAttachment`).

Fix: the real service reports a 404 on these per-item fetches as
`NotFoundError`, as the fake did already; the connector skips a not-found
message or thread and advances the cursor. A tracked thread's card stays.

## The gap around it

The box knew on day one: a `failing` connector-activity episode opened and the
dashboard showed `connector-activity:gmail`. Health checks never notify by
design (`docs/implemented-plans/notifications.md`, Track E), and nothing
reaches the developer for a production box. The plan linked above covers
both.

## Punch list

- [x] Skip not-found messages, threads and attachments; tests with the fake.
- [x] Check Calendar and Drive for the same shape (neither has it).
- [ ] A failing connector episode reaches the boxholder and the developer
  (plan above).
