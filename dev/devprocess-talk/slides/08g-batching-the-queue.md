# Issues arrive from everywhere; work ships in batches
## Supporting: bbx-pick-issues, Aug 24
- 1,025 of 1,229 issues say where they were found: feedback triage, boxholder talk, reviews, journey walks, post-fix sweeps, smoke review
- None of those sources produce work-sized items. pick-issues clusters them, by source day or by similarity, then reads every member and names one mechanism
- Four issues, four directions, one session, four fates:

| Issue | Found by | Fate |
|---|---|---|
| composer attach UX (Aug 8) | field-test prototype | lands, behind manual-testing |
| batch-cancel loses photos (Aug 22) | cross-model review | lands, behind manual-testing |
| draft splices into another message (Aug 22) | journey walk in an old chat | implemented |
| WebP paste rejected (Aug 23) | journey B's assets | wontfix: not reproducible |

Notes:
The day after the skill landed, six clusters were claimed or closed; the chat-session-identity one holds seven issues from four workstreams over five weeks. The rule that a cluster is a hypothesis comes from a session that grouped eight connector issues by title and started launching without reading them. 26 commits on main close two or more issues at once, 10 of them in that first week. Source: inventory, "bbx-issue-actions, bbx-pick-issues".
