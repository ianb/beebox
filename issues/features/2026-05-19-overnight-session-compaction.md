---
title: "overnight session compaction"
design: ../../callback-box/docs/plans/chat-review.md
area: callback-box
---

**Designed 2026-07-28** as [chat review](../../callback-box/docs/plans/chat-review.md).
The plan covers the engine, the size gate, and titling; it deliberately defers
the fan-out to the four sinks listed below, none of which exist yet. Note the
vocabulary decision there: the subsystem is **chat review**, never "compaction"
— that word is already taken for the SDK's context-window compaction — and the
`chat` qualifier is load-bearing, since bare "review" means code review in this
repo.

Three requirements added by the boxholder beyond the original filing:

- **Only sessions with enough *unreviewed* size get reviewed** — the gate is a
  cursor into the transcript, not a once-ever boolean. Measurement in the plan:
  ~90% of box transcripts are single-turn non-chat invocations, and any
  threshold in 4k–8k rendered chars selects the same ~5% set.
- **Sessions get generated titles, updatable over time.** Information-dense,
  unique to the chat, one line. Written for a **semi-public audience** —
  session lists surface where the conversation itself never does, and a title
  lands in git and is pushed to the box's remote while the transcript never
  leaves `~/.claude`. Hand-edited titles are detected and never overwritten.
- **Summaries extend rather than regenerate.** Not just a preference: the
  transcript renderer elides the middle over 40k chars, and 73% of
  review-eligible sessions are already past that cap — so a from-scratch
  re-read literally cannot see the middle of the conversation. The accumulating
  record lives in a **new global card field, `contains-evidence`** (optional on
  every card type, like `contains` itself); `contains` stays one sentence,
  regenerated from it.

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
