---
title: "autonomy matrix"
workstream: unknown
area: callback-box
---

A fixed L0-L4 autonomy ladder is too rigid — what's appropriate varies per box (personal vs. work vs. shared-with-family) and per situation within a box. Cleaner shape:

**Per-box declared autonomy** for known operation categories. Most file operations are always-OK; reading the box is always-OK; sending external messages is box-specific (some boxes allow, some require confirm, some forbid); financial commitments need explicit per-action approval everywhere. The declaration lives with the box, not the agent, so each box sets its own tolerance.

**Per-channel conditioning (optional).** Beyond per-box and per-operation, the autonomy matrix can optionally condition on source/channel. The boxholder might want stricter confirmation requirements from mobile (faster fat-finger errors, harder to review drafts in flight) than from desktop, or stricter rules from Telegram than from the web UI. Treat this as an opt-in dimension of the matrix, not a hard universal cap — the framing "phone is untrusted" is overstated for the boxholder's own authenticated phone. But the dimension should exist so those who want it can declare it.

**Reversibility as the primary axis.** Cleaner than "risk level" because it's more verifiable and less subjective. Reversible actions (file edits in version control, memory updates with history, draft creation) need *visibility* — boxholder can see what was done and undo if wrong. Irreversible actions (sent emails, financial transfers, calendar invites others were notified of) need *explicit confirmation* before the agent acts. Important: reversibility-in-the-world matters, not reversibility-on-the-system. Deleting a sent email's record doesn't unsend it; deleting a calendar event others were notified about doesn't un-notify them. The matrix should classify by world-effect, not system-effect.

**Confirmation level per operation, not per tier.** "Calendar entry creation" might be auto-OK in general but require confirm for entries spanning unusual time ranges. "Send Telegram message" might be auto-OK for short confirmations but need check for novel content. The matrix should support this granularity, not just discrete levels.

**Queue-on-encounter for unclassified operations.** When the agent encounters an action not yet classified by the box's matrix, it asks the boxholder *and* queues the question for explicit addition to the matrix. The same question shouldn't have to be re-asked next time. This is the mechanism that lets the matrix grow without requiring exhaustive upfront enumeration.

Connections:
- **[Behavioral profile: autonomy-vs-escalation calibration](2026-05-19-behavioral-profile.md)** — declared autonomy handles known categories; the learned behavioral profile handles edges where category-level rules aren't enough. They feed each other.
- **[Correction counting → spec promotion](2026-05-19-correction-counting-spec-promotion.md)** — same pattern in a different domain. Recurring per-session decisions get promoted to spec-level declarations. The encounter queue is the autonomy-domain version of correction counting.
- **[Session hot-context with explicit TTL](../features/2026-05-19-session-hot-context.md)** / retrospectives — natural surface for "here are operations the agent asked about this week, which ones should become declared rules?"

**Earned autonomy through accumulated evidence.** Symmetrical to [Correction counting → spec promotion](2026-05-19-correction-counting-spec-promotion.md): corrections push the autonomy boundary toward more restriction; successes push it toward less. When the agent has handled a task-class N times without corrections that suggested it should have been confirmed differently, surface during retrospective: "you've approved this kind of action N times without changes — promote it to auto-OK?" Earned autonomy is more durable than granted autonomy because the evidence backs it and the boxholder can see why.

Caveats on earned-autonomy promotion:
- "Zero corrections" is too strict as a literal threshold — corrections happen for reasons unrelated to whether this class needs confirmation. The signal is corrections that *suggested confirmation was needed differently*.
- Promotion is proposed, not automatic. The boxholder might know the next case will differ from previous ones (e.g., higher-stakes context).
- **Demotion path** is required. A promoted class that starts going wrong should restore confirmation, not be silently re-corrected each time. Same shape as the demotion path in [Universal confidence rubric](2026-05-19-universal-confidence-rubric.md) — evidence-against should move classifications, not just be absorbed.

The friction this addresses: without it, you get either constant permission requests (everything asks) or unpleasant surprises (the agent decided something you'd have wanted to know about). With it, the boundary is explicit and grows deliberately.
