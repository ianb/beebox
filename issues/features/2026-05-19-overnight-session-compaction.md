---
title: "overnight session compaction"
needs: [design]
area: callback-box
---

Chat sessions currently leave transcripts but no synthesized residue. A nightly (or end-of-session-plus-delay) compaction pass would extract what's worth keeping: decisions made, action items, hunches formed, things learned about the boxholder, things to follow up on. The standard auto-compaction in chat systems is generic; for callback-box it should be driven by a *custom compaction message* shaped to extract the things this system cares about, not generic compression.

This is also the *engine* that would update several other ideas in this file. None of them update themselves; something has to look back at recent sessions and extract from them:

- [Session hot-context with explicit TTL](2026-05-19-session-hot-context.md) — what's pending, what was in progress
- [Hypothesis tracking](../exploration/2026-05-19-hypothesis-tracking.md) — hunches formed during the session
- [Behavioral profile: autonomy-vs-escalation calibration](../exploration/2026-05-19-behavioral-profile.md) — observed autonomy/escalation calibration moments
- [Memory-writing guidance for the boxholder agent](../exploration/2026-05-19-memory-writing-guidance.md) — new facts about people, preferences, situations

Tiered closure (the tip's idea) is worth applying:

- **Light** — always happens. Transcript + short summary. Cheap. Even when heavier passes get skipped, nothing is lost.
- **Medium** — memory sync, task/question queue updates, hunch extraction. Runs nightly per active session.
- **Full** — broader synthesis, daily/weekly rollups across sessions. Periodic, not per-session.

Open design questions:
- **Triggering.** Time-based (overnight cron), event-based (session idle > N hours), or both?
- **Where outputs land.** Each extraction type has a different destination — hunches → hunch file, action items → questions queue, facts → person/topic cards. Compaction is fan-out, not a single output.
- **The custom compaction prompt itself.** This is the artifact that determines extraction quality. Worth designing carefully, probably iteratively against real session transcripts.
- **Idempotence.** Re-running compaction shouldn't duplicate extractions. Either dedupe at write-time or mark sessions as "compacted at level X."
