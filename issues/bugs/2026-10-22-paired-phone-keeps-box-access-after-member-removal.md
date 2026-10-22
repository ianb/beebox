---
title: "A phone paired by a member keeps box access after the member is removed from the box"
workstream: unattached
area: beebox
labels: [auth, ios]
filed-by: agent
discovered-by: agent
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
---

The box's ACL hook (`beebox/src/webapp/server-box-scope.ts:104-111`) accepts a
mobile device credential and returns before the email-based `canAccessBox`
check at `:152`. A paired device acts as the person who paired it
(`createdBy`, see the comment at `:247` and `:274`), but nothing re-checks
that this person can still open the box.

Scenario: a member pairs a phone. The owner later removes the member's email
from `allowedEmails`. The phone keeps uploading captures and reading the box
until someone revokes that device by hand. Nothing tells the owner that a
removed member still has a device registered.

Found while fixing the same gap for scan tokens, where a removed member's
uploader token kept working (`scan-auth.ts`, fixed in this worktree). The scan
fix re-checks `canAccessBox` for the token's creator on every request. The
same check for a device credential is the likely fix, with the hub gate
behaving the same way. This finding is from code reading; a test with a device
paired by a member, then the member removed, would prove it.
