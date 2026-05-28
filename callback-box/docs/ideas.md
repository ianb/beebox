# Ideas & Planned Features

## MAP.md for docs/generated/

The per-box `docs/generated/` tree is fully templated from this repo by `cb init` / `generateDocs` — every box gets the same contents. The recursive box-side MAP generator hides this subtree (it's not box-specific information), so agents working in a box currently have no index of what's in `docs/generated/`.

The right place to produce that index is here in `callback-box`, as a build step that emits a `MAP.md` (or a small set of them) alongside the generated content. `cb init` copies the MAP along with everything else. Single source of truth, no per-box churn.

Open questions: where the generator lives (a new script under `src/dev/`? part of an existing generator?); whether it covers just the top of `docs/generated/` or recurses; whether it ships in this repo's `templates/` or is computed at `cb init` time from the templates directory.

## Capability map for the boxholder agent

The agent sees its tool list each turn, so it knows individual tools exist, but it doesn't necessarily know the *compositions* — "I can set up a recurring check-in," "I can pull a photo from Drive and attach it to a card," "I can ask you a question later via Telegram." Those are capabilities that span multiple tools, and an agent reasoning from the tool list alone tends to miss them. Symptoms: agent says "I can't do that" when it actually can; agent proposes a clunky path when a clean one exists; agent doesn't think to offer something because no single tool maps to it.

Shape: written at the boxholder's level of abstraction (what the boxholder can *ask for*), grouped by domain (scheduling, capture, retrieval, notification, narration). Each entry: what it does, what triggers it, what it can't do — the negative space matters as much as the positive ("can attach photos by Drive link, can't currently search Drive for them").

Open questions:
- **Global vs. conditional load.** One always-loaded document is simple but costs tokens every turn for unused capabilities. Per-domain files loaded via `paths:` rules scales better but the agent has to know to look.
- **Generated vs. hand-written.** Generated from schema/tool annotations stays fresh but misses the *composed* capabilities, which are the whole point. Hand-written captures composition but drifts. Probably hand-written with an audit hook that complains when tools are added without capability-map updates.

## Memory-writing guidance for the boxholder agent

Callback-box doesn't currently give the boxholder agent guidance on *how* to write down what it learns — when to note something, where, in what shape, when to update vs. create, what NOT to write. Without guidance the corpus either becomes a transcript (everything noted, nothing findable) or stays empty (nothing noted, agent re-asks the same questions). The auto-memory section in `~/.claude/CLAUDE.md` is a decent template — its structure (types with when-to-save / how-to-use / examples / body-structure) could be adapted.

Dimensions guidance should cover:

1. **What deserves a note at all.** Default to nothing. Threshold: surprising, non-obvious, or contradicts a prior assumption. Without this rule, volume kills searchability.
2. **Update vs. create.** Always check for an existing note on the same subject before creating a new one. Otherwise five overlapping notes accumulate on the same person/topic.
3. **What NOT to write down.** Anything derivable from cards already in the box, from the calendar, from the conversation log. Memory is the residue that *can't* be reconstructed, not a transcript.
4. **Domain separation.** "Domain" needs to be defined in callback-box's terms — people, recurring topics, preferences, ongoing situations — not invented per-conversation.
5. **Freshness and decay.** Notes about state (mood, plans, current projects) go stale fast; notes about traits decay slowly. The agent should know which kind it's writing and verify volatile notes before acting on them.
6. **Linking.** A note naming another entity should link to it. Without this, retrieval misses related context.
7. **Why, not just what.** "User prefers terse responses — they read the diff themselves" generalizes to edge cases. "User prefers terse responses" doesn't.

## User-model dimensions to accumulate

Related to the memory-writing guidance above: a deep model of the principal (boxholder) is something that *develops over time* from observed interactions, not something written upfront. But for accumulation to add up to a model rather than a pile of facts, the agent needs scaffolding of *which dimensions to pay attention to*. Candidates:

- Decision style — data-driven vs. intuitive; wants alternatives with tradeoffs vs. wants a single recommendation
- Tolerance for ambiguity — comfortable with "it depends" vs. wants a concrete call
- Pushback preference — wants the agent to challenge vs. wants the agent to execute
- Communication style — terse vs. expansive; clinical vs. warm
- When to recommend vs. when to enumerate
- What kinds of errors are tolerable vs. costly

The static part of the system isn't the principal's content; it's the *axes* the system watches for evidence along. Boxholder-specific: harder than the coding-assistant case because the boxholder may not articulate preferences directly — the agent has to infer from how conversations land.

## Session hot-context with explicit TTL

Cross-session continuity: a short doc the agent loads at session start describing what was in progress last time, what decisions were pending, what the user was about to do. Currently the agent reconstructs this from cards + conversation log, which is slow and incomplete.

The non-obvious design point is the TTL. Stale hot-context is worse than no hot-context, because the agent confidently presents outdated state as current ("you were about to call Alice" — when that was last Tuesday and is no longer relevant). After some threshold (72h is the tip's suggestion, but probably varies by content type) the entry should be ignored or actively flagged as stale.

Open design questions:
- **When is it written.** End of session is the natural moment but conversations don't have clean endings in callback-box. Continuous update during the session is more robust but more expensive.
- **What goes in it.** "Decisions pending" and "in-progress threads" are clearer than "what we talked about." The summary should be operational, not narrative.
- **Where it lives.** In the box (visible to all agents on that box), or per-agent scratch. Probably in the box.
- **How TTL works.** Per-entry timestamps with the agent skipping expired ones is cleaner than whole-file expiry — different items have different shelf lives ("user prefers warm tone" doesn't expire in 72h; "user is mid-decision about the kitchen contractor" probably does).
- **Connection to cache-freshness.** Same shape as the `data_through` / `last_sync` pattern: the hot-context doc is a synthesized cache of state, and inherits the same staleness-propagation problem.

## Universal confidence rubric

Percentage confidence numbers have no shared meaning — neither model nor user has calibrated 65%-vs-70% intuitions, so "60% confidence" is theater. But gradation itself is real and useful, provided each level is defined by an operational rubric: what evidence justifies it, what behavior it licenses, what promotes or demotes it. Draft bands:

- **Fact** — observed directly or stated by the user/source. Acted on without hedging. (Effectively "100%.")
- **Likely** — multiple consistent signals, or one strong direct signal not yet confirmed. Agent acts on it but stays ready to be corrected; may surface as "I'm assuming X — say if that's off."
- **Suspected** — one signal, or a pattern that fits but could be coincidence. Agent uses it to *steer* (e.g., avoid asking the wrong question) but doesn't act on it directly. Refutation trigger required.
- **Speculative** — possibility worth holding onto in case more evidence appears. Agent watches; does not act, does not hint.

Universality is the point: the same rubric applies wherever the agent commits to something below fact level — hypotheses (see below), cache-staleness assessments (see [[cache-freshness-audit]] in prompt-audits.md), user-model dimensions, anything inferred from observation. A single shared vocabulary means the agent reasons consistently across these domains and the boxholder sees consistent hedging language.

Open questions:
- Are four bands the right count? Three (fact / likely / hunch) might be enough.
- How is band assignment surfaced — inline tag, separate field, structural placement (different files)?
- Demotion path: does evidence-against move a "likely" to "suspected," or straight out? Probably depends on the kind of evidence.

## Aging policy for the questions/waiting queue

We already have a notion of questions/answers the agent surfaces to the boxholder; the piece probably missing is an operational aging policy so the queue actually drains rather than accumulating dead items. Sketch (numbers tunable):

- **7 days unanswered** — proactive nudge. The agent surfaces the item again, possibly in a different channel.
- **30 days unanswered** — auto-close with a note. Mark as abandoned, not answered. Future-agent can see it was asked and dropped, which is itself a signal (this kind of question tends to go unanswered → maybe stop asking it).
- **Per-item override.** Some questions are time-sensitive (decisions before a date) and should escalate faster; some are evergreen and shouldn't auto-close at all. The default policy is for the middle case.

Auto-close behavior is the non-obvious part: silent decay loses information; flagged abandonment preserves the signal that the question was asked and got no traction.

## Behavioral profile: autonomy-vs-escalation calibration

A specific cut of the user-model work (see [[user-model-dimensions]]): a profile of what the boxholder wants done autonomously vs. wants to be consulted on. The agent decides this constantly ("just do it, or confirm first?") and miscalibration is visible in both directions — too cautious produces nag fatigue, too autonomous produces unwelcome surprises.

The harder question is meta: we have spaces for this kind of reflective material and some reflective processes, but it's unclear whether the profile actually progresses over time or just sits. A profile that doesn't update is worse than none, because the agent trusts it.

Possible answer: measure the profile by its *predictions*, not its size. When the profile licenses autonomous action on X, does the boxholder later object? When it triggers escalation on Y, does the boxholder say "you didn't need to ask"? Those mismatches are the learning signal. Without a feedback loop the profile drifts toward whatever the agent's prior was at write-time and stays there.

Implementation thoughts:
- The profile entries should be falsifiable ("act autonomously on calendar moves under 30 min"), not vague ("user likes when you take initiative").
- Each entry probably wants a "last validated" timestamp — if it hasn't been exercised in N weeks, lower its weight or re-check.
- The reflective process needs explicit prompts that *evaluate* existing entries, not just generate new ones. Generation without evaluation is what produces a pile rather than a model.

## Pre-wired knowledge stacks per project / relationship

The agent currently mostly wings it on domain reasoning — uses general training plus what's in the box. For recurring contexts (an active project the boxholder works on repeatedly, a key relationship) it could be more useful by drawing on canonical references: 2–3 sources whose frameworks apply directly to that project or person. The frameworks load automatically when the context is active, so application becomes reflexive rather than improvised.

Distinct from the [[canonical-wisdom-corpus]] entry: that's about *how to structure things in the box* (book-tracking patterns). This is about *domain frameworks for the things in the box* (negotiation lens for a vendor relationship, communication framework for a family member, methodology for a project).

The real risk: pre-wiring makes application reflexive, and *reflexive misuse* is the dangerous failure mode. A framework that doesn't fit the situation, applied confidently because it was pre-wired, is worse than the agent winging it from observation. The boxholder's sister wired to attachment-theory frameworks that don't actually fit produces confident wrongness the agent wouldn't otherwise reach.

Design tension: pre-wiring trades accuracy-from-observation for speed-of-application. Probably useful for domains where frameworks are mature and broadly applicable (negotiation, basic communication styles, project-management methodologies). Probably risky for contested or person-specific domains (psychology, family dynamics, anything where fit is the whole question).

Open questions:
- **Who picks the canon?** Boxholder explicit choice, agent proposes for confirmation, or shared corpus the boxholder opts into?
- **How is the binding represented?** Per-project frontmatter, a wiring file, tags on person cards?
- **How does the agent know when to apply vs. set aside?** A wired framework that observation contradicts should defer to observation — needs an explicit precedence rule.
- **Discoverability for the boxholder.** They should be able to see "the agent is reasoning about Alice through framework X" and override.
- **Connection to [[hypothesis-tracking]] and [[universal-confidence-rubric]]** — framework-derived conclusions are inferences, not facts, and should carry the appropriate confidence band.

## Subagent strategy for callback-box

Currently most agent work happens in one main loop. Some tasks would benefit from parallel subagent dispatch — the question is what shape the subagents should take, and which tasks actually benefit.

**Candidate shapes:**

- *Function-shaped helpers* (like Claude Code's Explore/Plan): each subagent does a specific operation type. "Search across cards," "fetch+summarize email thread," "draft response in style X." Composable; the main agent orchestrates. Lower per-call leverage but consistent.
- *Domain-shaped helpers*: each subagent specializes in a domain (calendar, email, a specific project). The main agent dispatches a question and gets a domain-aware answer. Higher per-call leverage but raises the procedure-vs-agent boundary question — if the domain helper makes judgment calls the main agent should be making, you get inconsistent reasoning.

Probably function-shaped is the better default, with domain-shaped reserved for genuinely procedural domains (like a calendar helper that handles event creation mechanics).

**Where parallelism actually buys something:**

- Multi-source synthesis ("what's going on with Alice this month" → calendar + email + card-history searches in parallel, main agent stitches).
- Triage processing — multiple incoming items handled in parallel rather than serially.
- Multi-perspective drafting, *only if* the perspectives are grounded in different sources or different roles. Same-model-different-prompts perspectives is the iterate-loop theater problem in a different shape (see [[iterative-refinement-grounded-critique]] in prompt-audits.md).

**Where parallelism doesn't help:**

- Tasks where steps depend on each other.
- Tasks where the main agent's accumulated context is what makes the work good — subagents lose that context.
- Tasks small enough that subagent spawning overhead exceeds the wall-clock savings.

Connected concern: subagents in callback-box don't inherit CLAUDE.md or rules (per [[claude-code-memory-concerns]] entry), so any subagent strategy has to pass relevant context explicitly. This makes domain-shaped subagents harder to build well than the surface tip suggests.

## Decision-shaped thinking discipline (instead of councils)

"Council" architectures (multiple agents deliberating in rounds) are mostly theater when the agents share the same underlying model and inputs — the diversity is in prompts, not priors, and they converge. The valuable *outputs* of a council (multiple paths considered, strongest cases surfaced, committed decision with dissent) come from a thinking discipline, not the architecture. A single agent with a good deliberation prompt produces the same outputs cheaper.

Draft template for a reusable deliberation prompt, applicable to any decision-shaped task:

1. **Enumerate the valid paths** — at least two, genuinely distinct, no strawmen.
2. **Steelman each** — what makes it the right call? Best version, not weakest.
3. **Name the decisive question** — what evidence or consideration would distinguish them? If there isn't one, the paths aren't actually distinct.
4. **Commit, with named dissent** — pick a path. State the strongest case against it explicitly. Commitments with named dissent are more trustworthy than commitments without.

When the architecture version (actual subagents) still earns its keep: only when perspectives need to be grounded in *genuinely different inputs* (one agent sees only calendar, another only email, etc.) — the case already covered in the [[subagent-strategy]] entry.

Worth drafting as a reusable prompt fragment the boxholder agent can invoke for non-trivial decisions, rather than per-decision improvisation.

## Overnight session compaction with custom compaction message

Chat sessions currently leave transcripts but no synthesized residue. A nightly (or end-of-session-plus-delay) compaction pass would extract what's worth keeping: decisions made, action items, hunches formed, things learned about the boxholder, things to follow up on. The standard auto-compaction in chat systems is generic; for callback-box it should be driven by a *custom compaction message* shaped to extract the things this system cares about, not generic compression.

This is also the *engine* that would update several other ideas in this file. None of them update themselves; something has to look back at recent sessions and extract from them:

- [[session-hot-context]] — what's pending, what was in progress
- [[hypothesis-tracking]] — hunches formed during the session
- [[behavioral-profile]] — observed autonomy/escalation calibration moments
- [[memory-writing-guidance]] — new facts about people, preferences, situations

Tiered closure (the tip's idea) is worth applying:

- **Light** — always happens. Transcript + short summary. Cheap. Even when heavier passes get skipped, nothing is lost.
- **Medium** — memory sync, task/question queue updates, hunch extraction. Runs nightly per active session.
- **Full** — broader synthesis, daily/weekly rollups across sessions. Periodic, not per-session.

Open design questions:
- **Triggering.** Time-based (overnight cron), event-based (session idle > N hours), or both?
- **Where outputs land.** Each extraction type has a different destination — hunches → hunch file, action items → questions queue, facts → person/topic cards. Compaction is fan-out, not a single output.
- **The custom compaction prompt itself.** This is the artifact that determines extraction quality. Worth designing carefully, probably iteratively against real session transcripts.
- **Idempotence.** Re-running compaction shouldn't duplicate extractions. Either dedupe at write-time or mark sessions as "compacted at level X."

## Richer session-start context injection

Currently the boxholder agent gets the date but not derived context that frequently matters in conversation. Cheap additions:

- **Day of week (named)** — comes up constantly ("plans this weekend," "Tuesday's call," "the Monday meeting"). The agent currently has to compute or guess.
- **Phase of day** — morning / afternoon / evening / late-night. "What's left on today" reads differently at 9am vs 9pm; offering to schedule something "later today" means different things.
- **Time since last session** — lets the agent calibrate between quick continuity ("picking up where we left off") and full re-orientation ("it's been three weeks, here's what's still pending").
- **Near-horizon time-sensitivity** — anything scheduled in the next few hours / today that's worth being aware of before answering.

**Channel / device.** Desktop web vs. mobile web vs. Telegram (and any future channel) currently look the same to the agent, but the appropriate output shape differs: on mobile, tables, multi-column structures, and long-form prose with headers don't render well; on desktop they're fine. The agent should know the channel and adapt output mode (length, structure complexity) without the user having to ask. Same intelligence, different presentation.

Implementation is trivial (compute at session start, inject into context) but the quality dividend is real because these are things conversations *constantly* reference and currently the agent has to derive or fudge.

## Scheduled-task health surfacing

Scheduled automation (wakeup, scheduler ticks, overnight compaction once that exists, sync jobs) can silently stop running, and the failure isn't noticed until something downstream breaks (briefings stop updating, hunches stop being extracted, calendar drift). Stuff gets lost.

Primary mechanism should be *active monitoring*: each scheduled task records `last_run_attempted` and `last_run_succeeded` (which can diverge — see the same shape in the cache-freshness audit). Anything overdue past threshold or failing repeatedly triggers proactive notification, independent of any session.

Session-start surfacing is the *backup* layer: if you missed the proactive alert, the next chat session opens with a brief health-check note. Only surface when there's something to surface — "all green" every session is noise. Threshold: any task that's overdue, failed, or has been failing repeatedly.

Notes:
- This is the process-shape of the cache-freshness pattern. `data_through` for data; `last_run_succeeded` for tasks. Same divergence trick (attempted vs. succeeded ≈ checked vs. found-fresh-data).
- Should also be visible somewhere as an always-available view (status page, `cb health`) so it doesn't *only* surface at session start.
- The reason the agent should still check at session start, even with proactive alerting in place: catches bugs in the alerting itself. Belt and suspenders.

## Correction counting → spec promotion

Corrections that stay in chat disappear. The fix is to extract them (during overnight compaction or a retrospective pass), count how often the *same* correction recurs across sessions, and promote frequent ones to permanent spec-level instructions.

The count is what makes this useful. Without it:
- Save every correction → spec bloats with one-offs the boxholder wouldn't actually want as permanent rules.
- Save none → keep getting the same correction repeatedly, which is exactly the failure this addresses.

Threshold worth experimenting with (the tip suggests 3). What matters is the promotion: from per-session-correction → tracked-recurring-correction → spec-level rule.

Design notes:
- **Promotion should be explicit, not automatic.** The agent's read of "this is the same correction I got before" can be wrong (surface similarity ≠ same underlying rule). Surface candidates during retrospectives: "you corrected me on X three times this month — make this a permanent rule?" User confirms before spec changes.
- **Counting requires extraction.** Compaction needs to recognize "this was a correction" as a distinct extraction type, separate from facts or hunches. Tag at extraction time so counting is just aggregation.
- **Same connection to [[behavioral-profile]]** — corrections aren't only "rules to add," they're signals about what the boxholder cares about, which feeds the user model.
- **Demotion path.** If a promoted rule starts causing different corrections (because circumstances changed), the rule should be flagged for review, not silently fought.

Probably belongs in the same flow as retrospectives the user already runs. The mechanism is what's missing more than the concept.

## Declared per-box autonomy matrix with encounter queue

A fixed L0-L4 autonomy ladder is too rigid — what's appropriate varies per box (personal vs. work vs. shared-with-family) and per situation within a box. Cleaner shape:

**Per-box declared autonomy** for known operation categories. Most file operations are always-OK; reading the box is always-OK; sending external messages is box-specific (some boxes allow, some require confirm, some forbid); financial commitments need explicit per-action approval everywhere. The declaration lives with the box, not the agent, so each box sets its own tolerance.

**Per-channel conditioning (optional).** Beyond per-box and per-operation, the autonomy matrix can optionally condition on source/channel. The boxholder might want stricter confirmation requirements from mobile (faster fat-finger errors, harder to review drafts in flight) than from desktop, or stricter rules from Telegram than from the web UI. Treat this as an opt-in dimension of the matrix, not a hard universal cap — the framing "phone is untrusted" is overstated for the boxholder's own authenticated phone. But the dimension should exist so those who want it can declare it.

**Reversibility as the primary axis.** Cleaner than "risk level" because it's more verifiable and less subjective. Reversible actions (file edits in version control, memory updates with history, draft creation) need *visibility* — boxholder can see what was done and undo if wrong. Irreversible actions (sent emails, financial transfers, calendar invites others were notified of) need *explicit confirmation* before the agent acts. Important: reversibility-in-the-world matters, not reversibility-on-the-system. Deleting a sent email's record doesn't unsend it; deleting a calendar event others were notified about doesn't un-notify them. The matrix should classify by world-effect, not system-effect.

**Confirmation level per operation, not per tier.** "Calendar entry creation" might be auto-OK in general but require confirm for entries spanning unusual time ranges. "Send Telegram message" might be auto-OK for short confirmations but need check for novel content. The matrix should support this granularity, not just discrete levels.

**Queue-on-encounter for unclassified operations.** When the agent encounters an action not yet classified by the box's matrix, it asks the boxholder *and* queues the question for explicit addition to the matrix. The same question shouldn't have to be re-asked next time. This is the mechanism that lets the matrix grow without requiring exhaustive upfront enumeration.

Connections:
- **[[behavioral-profile]]** — declared autonomy handles known categories; the learned behavioral profile handles edges where category-level rules aren't enough. They feed each other.
- **[[correction-counting-spec-promotion]]** — same pattern in a different domain. Recurring per-session decisions get promoted to spec-level declarations. The encounter queue is the autonomy-domain version of correction counting.
- **[[session-hot-context]]** / retrospectives — natural surface for "here are operations the agent asked about this week, which ones should become declared rules?"

**Earned autonomy through accumulated evidence.** Symmetrical to [[correction-counting-spec-promotion]]: corrections push the autonomy boundary toward more restriction; successes push it toward less. When the agent has handled a task-class N times without corrections that suggested it should have been confirmed differently, surface during retrospective: "you've approved this kind of action N times without changes — promote it to auto-OK?" Earned autonomy is more durable than granted autonomy because the evidence backs it and the boxholder can see why.

Caveats on earned-autonomy promotion:
- "Zero corrections" is too strict as a literal threshold — corrections happen for reasons unrelated to whether this class needs confirmation. The signal is corrections that *suggested confirmation was needed differently*.
- Promotion is proposed, not automatic. The boxholder might know the next case will differ from previous ones (e.g., higher-stakes context).
- **Demotion path** is required. A promoted class that starts going wrong should restore confirmation, not be silently re-corrected each time. Same shape as the demotion path in [[universal-confidence-rubric]] — evidence-against should move classifications, not just be absorbed.

The friction this addresses: without it, you get either constant permission requests (everything asks) or unpleasant surprises (the agent decided something you'd have wanted to know about). With it, the boundary is explicit and grows deliberately.

## /spark mode — batch harvest of the proactive layer

Conceptual inverse of narration mode (see [narration-mode-design.md](narration-mode-design.md)). Narration is user-talks-mostly (long dumps, agent files quietly). /spark is agent-talks-mostly (agent surfaces everything it's been holding back; user triages). Both intentionally break the turn-balanced rhythm in opposite directions.

The premise: the agent runs a proactive layer continuously, with normal suppression discipline (park-on-ignore, thresholded surfacing, silent consultation as default). Observations the agent would have surfaced eventually but didn't yet — because timing was wrong, because the boxholder was focused elsewhere, because the quota was already spent — accumulate. /spark is the deliberate harvest of that accumulation.

This presupposes the full suppression-discipline stack. Without it the bin is empty and spark is just "the agent rambling." Inputs probably come from:

- Parked proactive observations (see [[park-ignored-proactive-observations]] audit)
- Hypotheses crossing confirmation/refutation thresholds (see [[hypothesis-tracking]])
- Behavioral-profile and autonomy-matrix promotion candidates (see [[autonomy-matrix]], [[correction-counting-spec-promotion]])
- Recurring corrections worth surfacing as proposed rules
- Health-check residue (quiet failures, drift)
- Stale items from the questions queue (see [[questions-aging-policy]])

Open design questions:

- **Confidence floor stays.** Suppression-lifting isn't confidence-lifting. The point isn't "show me everything you've ever thought" — it's "show me everything you'd have surfaced eventually but didn't yet." Speculative hunches still shouldn't appear.
- **Output structure.** Flat list overwhelms. Probably grouped: opportunities / risks / patterns / pending decisions / observations-about-you / proposed promotions.
- **Triage actions per item.** Each item needs quick action: act-now / park-again / kill / tell-me-more. Pure monologue produces overwhelm without resolution. This is where the mode differs from a passive summary report.
- **Termination.** Done when the bin drains, when the user calls it, or some combination. Probably the user can leave with items un-triaged and they stay parked for next time.
- **Cadence vs. on-demand.** Should /spark be entirely on-demand, or also offered proactively when the bin reaches some size threshold? Either way the boxholder retains control over entry.

## Introspectable feedback as the storage layer for accumulated observations

Several ideas in this file — parked proactive observations, hypothesis tracking, behavioral-profile candidates, correction-counting, autonomy-promotion candidates, agent-noticed self-failures — all involve the same shape: *the agent writes structured entries that accumulate over time and get surfaced during /spark or retrospectives*. The naive implementation is parallel files (ideas_log.md, development_backlog.md, hunches.md, parked-observations.md, corrections.md...), which is sprawl with overlapping concerns.

Cleaner shape: extend `cb feedback` (or whatever the existing feedback mechanism is) to be the single storage layer for all of these. Each entry has:

- **Type/category** — parked-observation, hypothesis, correction, self-noticed-failure, autonomy-promotion-candidate, etc.
- **Subject** — what it's about (person, project, behavior, operation class).
- **Body** — the content itself.
- **State** — fresh / parked-until-date / killed / promoted.
- **Aging metadata** — when written, when last surfaced, when last engaged with.

The point isn't to enforce a rigid schema — different types need different fields. The point is *one introspectable surface* the boxholder can query ("what's been accumulating about Alice?", "what hunches haven't been confirmed?", "what corrections have repeated?") and the agent can scan during /spark, retrospectives, and compaction.

Connections:
- [[spark-mode]] reads this surface as its input.
- [[park-ignored-proactive-observations]] writes parked items here.
- [[hypothesis-tracking]] writes hunches here.
- [[correction-counting-spec-promotion]] writes correction events here.
- [[autonomy-matrix]] writes promotion candidates here.

The discipline that makes this work: nothing in the system writes accumulated observations to a *new* file — everything goes through the feedback layer with its type tag. Otherwise the sprawl returns under different filenames.

## Reflexive person-profile loading + person-as-directory promotion

Two related questions about how the agent handles people.

**Reflexive profile load.** Before producing output that involves a specific person (drafting a message to them, prepping for a meeting, summarizing their situation), the agent should *always* load that person's profile file if one exists — not rely on session memory, not improvise from general training. Session memory degrades; the profile file is the canonical reference. This should be a pre-condition for the operation class, not a judgment call — analogous to the autonomy matrix's reversibility-driven requirements ([[autonomy-matrix]]). No "VIP tier" framing needed; presence-of-profile is the signal.

**People are directories, not cards.** Each person gets a directory under `people/` with:

- **A header card** — the canonical, structured profile. This is what the reflexive-load mechanism targets. Contains preferences, relationship context, sensitivities, active items, last-interaction notes, anything else that has consistent slots.
- **Free-form attachments** — anything else that helps track or explain the person. Notes the agent jotted down, photos, document copies, draft fragments, past correspondence excerpts, scanned letters, voice memos. No required shape, no schema, just "stuff related to this person."

The header card itself should document this expectation: it notes that attachments are intentionally free-form and the agent (or boxholder) can put whatever helps in there. Without that explicit note, agents tend to either over-constrain (refusing to add things because there's no schema for them) or under-utilize (sticking only to the structured header).

Decision rationale for directories-from-the-start rather than card-then-promote: the migration cost is real (links break, agents have to relearn paths), and the simplicity gain of single-card people is small. Setting up the directory structure once and never re-shaping it is cleaner.

Open questions:
- **Naming convention for the header.** `people/alice/alice.person.card`? `people/alice/profile.card`? `people/alice/_header.card`? Whatever fits the existing card conventions.
- **Connection to [[introspectable-feedback-storage]].** Per-person feedback entries (hunches about Alice, parked observations) probably live in the central feedback layer with a person reference, so cross-cutting queries still work — not scattered into each person's directory.

## Hooks at the agent-loop level (not just at the system level)

Callback-box already uses hook-shaped mechanisms at the system level: pre-commit card validation, post-commit auto-deploy, the wakeup cycle as a scheduled trigger. What it doesn't currently expose is *agent-loop* hooks — runtime events that fire before/after specific agent actions, executed deterministically by the runtime rather than relying on the agent to remember.

The principle: if a behavior must happen reliably every time, it's a hook, not an instruction. Memory and prompts *recommend*; hooks *enforce*. Anything currently encoded as "the agent should always..." is a candidate.

Candidates from ideas already in this file:

- **Reflexive person-profile loading** ([[reflexive-person-profile-loading]]). Currently framed as a rule. A hook that runs before any draft-message operation and injects the recipient's profile makes this enforced, not optional.
- **Session-end compaction triggering** ([[overnight-session-compaction]]). A session-end hook fires the compaction deterministically.
- **Health-check surfacing at session start** ([[scheduled-task-health-surfacing]]). Session-start hook reads task health and prepends to the agent's context if anything's overdue.
- **Pre-irreversible-action gates** ([[autonomy-matrix]]). A hook on irreversible operations triggers confirmation, rather than relying on the agent to check.
- **Link enforcement** ([[link-dont-name]] audit). A post-output hook could detect bare resource names and either reject the output or rewrite to link form.

Open questions:
- **Where does the hook live?** In `cb` (the CLI) for operations going through it. In the chat runtime for chat-context hooks. Probably both, with a shared definition format.
- **What's the right event vocabulary?** `pre-tool-use`, `post-tool-use`, `session-start`, `session-end` map well from Claude Code. Callback-box has additional candidates: `pre-card-create`, `post-card-create`, `pre-external-send`, etc. Worth defining the set explicitly.
- **Where do hooks get configured?** Per-box in `config/hooks.json`? At the system level? Both, with precedence?
- **Failure behavior.** What happens if a hook fails? Block the operation, log and continue, ask the boxholder? Probably depends on hook type (validation hooks block, observation hooks log).

The bigger framing question: this is the same insight as "use hooks instead of memory" at the personal-config layer, applied to the agent-loop layer. Callback-box has hooks at the git layer (pre-commit/post-commit) and at the scheduler layer (wakeup). Adding them at the agent-loop layer would be a third tier.

## Hypothesis tracking for the boxholder agent

The agent forms suspicions constantly — "boxholder seems stressed about work this week," "the kitchen project may have stalled," "they're avoiding the topic of their sister." These are different from facts and currently have nowhere to live: too provisional for a person/topic card, too important to discard. Without persistence the agent re-derives them each session or, worse, forgets and asks something the suspicion would have steered it away from.

Design notes:

- **No percentage confidence.** Fake precision; neither model nor user has calibrated 65%-vs-70% intuitions. If gradation matters at all, qualitative bands (hunch / suspect / likely). Probably even those are overkill — binary "is-a-hunch" plus a refutation trigger does the real work.
- **Every hunch carries a refutation/confirmation trigger.** "If Alice mentions the kitchen project, ask if it stalled" is more useful than any confidence score. The trigger is what makes the hunch operationally actionable.
- **Aging.** Hunches go stale fast — most suspicions about state ("seems stressed this week") shouldn't survive past a couple weeks. Trait-shaped hunches ("seems uncomfortable discussing finances") last longer. Per-hunch TTL, not a global one.
- **Promotion to fact.** When a hunch is confirmed it should become a normal note on the relevant person/topic card, not a permanent resident of the hunches file.
- **Connection to user-model dimensions** (see [[user-model-dimensions]] entry above) — hunches along the same axes the agent watches for are the raw material; over time, repeated hunches in the same direction become facts.

## Apply guide cards to inbox triage

Guide cards (`config/*.guide.card`) capture the boxholder's preferences as triage rules, named actions, default actions, and accumulated feedback. Today the compiled guide is read by job-processing agents (a `paths:` rule loads it when a matching job runs). But there's no live mechanism for the guide's *triage rules* to actually drive inbox routing — the agent decides per-item, and the guide only nudges in retrospect.

The shape we want is guide-as-policy, applied at intake, refined by feedback: the guide's triage rules score or route new items as they land, the boxholder sees what happened, and a "wrong bucket" signal feeds back into guide revisions.

Open questions:

- **Where does triage run?** During `cb wakeup` per-item as new things land? As a separate `cb intake` step? Inside the reactor on intake-jobs? The answer affects how aggressively rules get applied (a wakeup-time rule that auto-trashes feels different from a reactor decision that asks first).
- **One guide or per-stream?** A single `intake.guide.card` is simpler but blurs domains; per-stream guides (recipes vs bookmarks vs voice memos) match how feedback naturally clusters but multiplies setup.
- **Feedback surface.** Where does the boxholder say "this routing was wrong"? Probably a lightweight "wrong bucket" gesture on archived items + periodic guide-revision passes that read accumulated signals and rewrite the guide.
- **Relation to landmarks/triage-design.** `docs/triage-design.md` already sketches a typed-routing pipeline using `<triage-destination>` on landmarks. Guides and landmarks both encode routing intent — figure out the division (landmarks = structural destinations, guides = policy for choosing among them?) before building either further.

## Capitalize glossary terms as Proper Nouns?

Open question: should the project's coined/narrowed terms (Card, Box, Asset, Attachment, Wakeup Cycle, Procedure, ...) be written with initial caps in prose to mark them as Proper Nouns of the system? Pros: visually distinguishes "an asset" (project term, manifest-tracked file) from "an asset" (English). Lets readers spot terms-of-art at a glance, the way "Linux" or "Python" do. Cons: feels precious in casual writing; risks inconsistency between code identifiers (lowercase) and prose (capitalized); easy to drift. Decide before the glossary fill-out pass below so the whole sweep lands in one style.

## Fill out the glossary

`docs/glossary.md` is scoped to Proper Nouns — names we coined and general words we've narrowed to project-specific meanings. The starter set covers box, card, attach scope, attachment, asset, asset manifest, wakeup cycle, connector, procedure, service, cardworks, inbox, archive, cb, cb attachments. Things to add:

- **Card-related**: tagName, ref, ref graph, schema instructions, validation, virtual `attach/` prefix, basename, card title
- **Layout**: store/, box/inbox/, box/jobs/, box/commands/, box/questions/, config/, .callback-box/, landmark
- **Wakeup / agent loop**: command, question, job, dispatch, agent invocation, Claude Code harness
- **Connectors / services**: sync, fake vs real, observable state, the service/connector boundary
- **Procedures**: run, step, scenario
- **Capture / intake**: capture session, scan-import, intake, source (the `<filename source>` enum)
- **Frontend**: page, renderer, UI primitive, semantic palette, restrict-component-classes
- **Persistence**: pre-commit hook, post-commit hook, deploy, trailer (git trailer), `cb commit`
- **Testing**: doctest, makeTestServer, makeTmpBox, the three tiers
- **Misc**: hunch, knowledge audit, landmark, file-lock

Method: do one sweep through `CLAUDE.md`, `FRONTEND.md`, the schemas, and `docs/` collecting terms-of-art, then write entries. Keep them short (one paragraph), link to deeper docs rather than restating. The glossary is for *naming the thing*, not explaining it in full.

Worth treating as a single pass — partial glossaries are worse than none because readers stop trusting them as comprehensive.

## Review asset-manifest scope

The asset-manifest hook (`docs/asset-manifests.md`) scopes its discipline to `**/*.attach/**` only. Binaries outside attach scopes commit normally, with a soft "this is big, consider moving it" advisory. Revisit once we have real usage: if agents routinely drop binaries outside attach scopes anyway (logs, screenshots, scratch files), either tighten enforcement (gitignore more aggressively, hard-block large binaries anywhere), or accept the looser model and beef up the advisory. Also worth revisiting: per-dir JSON manifest vs per-asset sidecar — if per-dir produces noisy diffs in practice, the sidecar form is a drop-in replacement.

## Catch stale image-refs after card renames

Surfaced during the attach-layout migration test on the ledger box. Many archived capture-session cards reference their image children by the original `photo-NNN.image.card` form, but agents renamed those image cards to descriptive forms long ago (`photo-001-arrow-invoice.image.card`, etc.) without updating the session card's `<image-ref>` entries. ~1,166 broken refs on ledger trace back to this pattern.

The renames probably came from `cb mv` (or agent-issued renames) on the image cards alone, without touching the session card pointing at them. `cb mv` does rewrite cross-card refs, so a single rename via `cb mv` SHOULD propagate. Suggests this happened either before `cb mv`'s rewrite pass existed, or the renames bypassed `cb mv` (agents writing direct file moves, or using filesystem mv).

Catching it:

- `cb validate` already reports broken refs — but the noise level on ledger is high enough that the user hasn't acted on these. Maybe the validator could surface a stale-ref count summary at the top, and/or fail with non-zero exit when broken-ref count grows.
- A pre-commit hook could check that any commit touching an image card also updates any session card referencing it (or just refuses commits that introduce broken refs).
- A periodic cleanup job in wakeup could try to repair: for each broken ref pointing at `<old>.image.card`, look for an image card in the same dir whose `<filename>` matches the basename and the session's apparent ordering, and offer to repair.

## Claude Code Memory Concerns

Auto-memory (`~/.claude/projects/<path-hash>/memory/`) is problematic:

- Path-hash-based and machine-specific -- not portable across machines
- Not version-controlled, easily lost if repo moves
- Custom subagents don't inherit CLAUDE.md or `.claude/rules/` (only built-in subagents do)
- No setting to relocate memory into the project repo
- Open feature request: [anthropics/claude-code#25739](https://github.com/anthropics/claude-code/issues/25739)

Durable project knowledge should go in repo files (CLAUDE.md, docs/), not auto-memory.

## Keeping the bundled Claude Code SDK binary current

The agent SDK (`@anthropic-ai/claude-agent-sdk`) bundles its own Claude Code binary as an optional npm dependency and ignores anything system-installed (no `$PATH` lookup, no `~/.local/bin/claude`). That binary is frozen at npm-install time, so a long-running server stays on whatever version of Claude Code was current when we last `npm install`-ed.

Today there's no process for refreshing it. The auto-updater on `~/.local/bin/claude` doesn't help — the SDK never looks there. Options:

- A scheduled task on the server that runs `npm install @anthropic-ai/claude-agent-sdk@latest` weekly, then restarts services.
- Tie SDK updates to deploys: `deploy.sh` re-resolves `claude-agent-sdk` to latest before rsync.
- Pin a specific SDK version in `package.json` and only bump deliberately (most explicit, lowest auto-update surface).

Related: [claude-agent-sdk-typescript#296](https://github.com/anthropics/claude-agent-sdk-typescript/issues/296) — the SDK's binary resolver tries musl before glibc on Linux. Worked around in `src/core/sdk-binary-path.ts` by passing `pathToClaudeCodeExecutable` ourselves.

## Per-box secret management

API keys (Mistral, etc.) are configured per-box in `config/connectors/*.secret.json`. When a new box is created, it has no secrets — features like transcription silently fail with "API key not configured." There's no mechanism to provision secrets automatically or inherit them from a shared location.

Options to consider:
- A global/server-level secrets file that boxes inherit from by default
- `add-box.sh` could copy common secrets (mistral, etc.) from an existing box or a template
- A `cb secrets` command to list which secrets each box has/is missing
- Fall back to env vars more aggressively (the env var `CALLBACK_MISTRAL_API_KEY` exists but is commented out by default in setup)

For now: manually copy secret files to new boxes. See `docs/adding-a-box.md` step 7.

## Box deployment friction

Several things go wrong when adding a new box to the server that are easy to forget:

1. **Missing secrets** — see above
2. **File ownership** — `add-box.sh` clones as root, then chowns. But if new box directories are introduced in a code update (e.g., `people/`), existing boxes won't have them until `cb init` runs. The script now runs `cb init --skip-git` as the callback user after pulling, but edge cases remain (e.g., background agents creating directories while running as the wrong user).
3. **No validation after deploy** — there's no health check or `cb validate` run after `add-box.sh` completes. A broken box (missing config, bad permissions) won't be caught until someone tries to use it.

Longer term: `add-box.sh` or a `cb deploy-check` command could verify: all standard dirs exist and are writable, required secrets are present, `cb validate` passes, and the web endpoint responds.

## Scheduler: `cb tick --force` and timeout durability

Surfaced while debugging a Wren daily-rumination "failure" where the agent had actually completed and committed but the wrapper hung past the 10-minute mono timeout.

### Add `--force` to `cb tick --script <name>`

Currently `--script` only filters which schedules to evaluate; `not-before`, `budget`, and lock-group checks still apply, so there's no clean way to manually re-run a script that just ran. Add a `--force` flag that:

- Bypasses `not-before` and `budget` checks.
- On lock-group conflict, only skips if the holder is *live* (the file-lock primitive already auto-cleans dead holders, so this is mostly free — just remove the lock-group skip's reliance on a stale "running" map for force runs).
- Does not preempt a live holder.

### `cb prompt` doesn't exit promptly after the agent's final turn

Symptom: a scheduled `cb prompt …` invocation continued running for ~65 minutes of wall time after the agent's final message landed (commit and journal entry succeeded), until the 10-min mono setTimeout finally fired and SIGKILLed the tree. This made a successful run look like a failure in the scheduler log.

Hypothesis: the spawned `claude --print` process isn't closing stdout/exiting after returning its final response. Worth instrumenting `runAgent` in `src/core/agent.ts` — log when `child.on("close")` fires vs. when the last stdout chunk arrived. If they're far apart, the issue is in claude-code itself; if close fires promptly but our wrapper hangs after, look at the prompt-logger proxy lifecycle (`stopPromptLogger`) and any pending I/O in `cb prompt`.

### Re-evaluate the per-script timeout

`SCRIPT_TIMEOUT = 10m` is monotonic time, which means it pauses during macOS sleep. That's good — a script that was about to finish doesn't get killed just because the laptop closed. But `wren-weekly-research` has `--max-turns 30` (web research) and bumps right against 10 min of real CPU time. Either bump the per-script timeout (configurable in the card?) or add a `<timeout>` attribute on `<scheduled-script>`.

## Switch deploy from rsync to git push

`deploy/deploy.sh` rsyncs the local working tree to `/opt/callback/`, excluding `.git`. Side effects:

- Server's `git rev-parse HEAD` is meaningless (it reflects whenever .git was last touched, not what's running). The health endpoint now reads `deploy-info.json` to surface the actual deployed hash, but that's a workaround.
- You can deploy from a dirty working tree, so the recorded hash may not match what's on disk.
- No git-native rollback (you redeploy from an older local checkout instead).

Options:

1. **Git push to a bare repo on the server with a post-receive hook.** Hook checks out HEAD into `/opt/callback/`, runs `npm install`, builds frontend, restarts services. Server git matches what's running. Cardworks needs its own remote/hook (or submodule/subtree restructure). Loses today's "scp a single file to test a hotfix" iteration loop — every change has to be a commit.

2. **Server pulls from GitHub on deploy.** Standard CI/CD pattern, single source of truth, but every deploy is a GitHub roundtrip. Same multi-repo dance for cardworks.

3. **Keep rsync but require a clean working tree** (with `--force` for hotfix work). Smallest change. Fixes the truthfulness problem without losing iteration speed.

For now: keeping rsync. Revisit if deployment reproducibility / rollback ergonomics start to bite.

## Ref path normalization

Refs in cards use paths like `ref="../../../store/archive/Foo.record.card"` which are fragile and hard to read. Absolute refs (`ref="/store/archive/Foo.record.card"`) are already supported and preferred.

Ideas for automatic normalization:
- `cb validate --fix` could rewrite relative refs to absolute
- `cb create` could resolve ref arguments to absolute paths before writing
- The card loader could normalize refs on save (convert relative→absolute)
- A lint rule could warn on relative refs that go above the card's parent directory

## CLI Design for Agents

`cb` is increasingly invoked by agents as well as humans. We don't have a dedicated CLI design doc, but should — and it needs ongoing vigilance, not just a one-time pass.

Principles worth encoding:

- **Enumerate valid values in errors.** When a command rejects an enum-shaped argument, the error should name the valid set: `--visibility must be one of: public, private, unlisted (got: "secret")`. This is the highest-leverage error improvement because it fires exactly when the agent doesn't know what to do next and lets it self-correct in one retry. We do reasonably well here but there's no systematic check.
- **Fail before side effects.** Validate inputs early, before anything writes to disk or triggers external calls. An error that fires after a partial write is far more damaging than one that fires at argument parse time.
- **Correct invocation in the error text.** The error should show a working example, not just what was wrong.
- **Idempotent mutations.** Agents retry; they don't notice a duplicate row. Card filenames serve as natural idempotency keys for most `cb` operations (creating a card with the same path twice is a no-op or a merge, not a duplicate). Connectors are the exception — `seenMessageIds`, dedup logic, and external API calls don't have the same guarantee. Worth auditing connector sync paths if retry behavior becomes a problem.
- **Bounded output with navigable truncation.** List-style commands should have a default page size, and truncation messages should teach the agent how to narrow the next query (`"truncated":true,"hint":"add --limit=N or --filter=author:..."`) rather than just cutting off. This applies at both the CLI output layer and the MCP tool description layer — bloated tool descriptions cost tokens on every agent call, never just once. Needs constant vigilance; easy to slip with ad hoc `--json` additions that don't think about pagination.

Consider a `docs/cli-design.md` that codifies these so new commands have a checklist to check against. Alternatively, a lint rule or doctest pattern that exercises error output for enum-typed arguments could catch regressions automatically.

**Three-layer introspection** — each layer answers a different question:

1. `--help` — human-readable: what does this command do?
2. `cb agent-context` — machine-readable JSON describing the full command surface, versioned with a `schema_version` field so a consuming agent can detect breaking shape changes. Flags, types, enums, defaults, required/optional — everything an agent needs to form a valid invocation without a trial-and-error loop.
3. Skill manifests (`SKILL.md` or equivalent) — long-form prose describing *workflows*, not commands: how to compose operations into useful sequences, what to reach for in which situation.

`cb` currently has only layer 1. Layer 2 would be straightforward to generate from the existing command definitions (yargs schema → JSON). Layer 3 is essentially what `docs/IMPLEMENTATION.md` and `.claude/rules/` already do for the Claude Code context — the question is whether to also surface them in a form a non-Claude agent could consume. Both layers 2 and 3 should be kept in sync with the implementation by the same generation step, not maintained by hand.

**Vocabulary consistency** is the highest-leverage item and the hardest to maintain through review alone. Agents don't relearn each CLI from scratch — they generalize from every CLI they've seen, so a command that uses `info` instead of `get`, or `--format=json` instead of `--json`, costs extra retries across every agent invocation, not just the first one. The fix isn't better reviewers; it's a prescriptive vocabulary document that defines the permitted verbs and flags, and a static check that fails on deviations. The `cb` command family is small enough that the vocabulary could be enumerated explicitly: `get`, `list`, `create`, `update`, `delete`; `--json`, `--force`, `--dry-run`, `--limit`, `--cursor`. Any new command picks from this menu. Additions to the menu require updating the doc, not ad hoc review.

## Feature Ideas

### JSON as CLI input — structured arguments and composable profiles

Google's `gws` (Workspace CLI) takes this approach: instead of many individual flags, you pass a single JSON object constructed from the API schema. ([article](https://betterstack.com/community/guides/ai/cli-gws-ai-agents/)) The agent builds one blob rather than learning a large flag surface — fewer distinct interface elements, lower token cost, and the schema can be introspected directly.

```bash
# Individual flags — agent must learn each one
$ cb create --type=memo --title="Hello" --content="..." --author="Ian"

# JSON input — agent constructs one object from the schema
$ cb create --args='{"type":"memo","title":"Hello","content":"...","author":"Ian"}'

# Or from a file
$ cb create --args="$(cat my-memo.json)"
```

The composability payoff is in profiles. A "profile" is just a base JSON file; `jq`'s `*` operator merges objects with right-side winning:

```bash
$ cb create --args="$(jq -n '{"type":"memo","author":"Ian"} * {"title":"Hello","content":"..."}')"
# or
$ cb create --args="$(jq '. * {"title":"Hello"}' base-profile.json)"
```

No profile subsystem needed — files, `jq`, and shell already compose. The convention is: `*` merges, explicit args override profile values, git tracks the profile files.

One further idea from `gws`: the command surface itself is generated at runtime from a live API discovery endpoint rather than a static list. When the underlying API adds a method, the CLI reflects it immediately — no lag between API changes and agent accessibility. `cb` is too hand-crafted for this to apply directly, but the principle is worth holding: the introspection layer (`agent-context`) should be generated from the same source of truth as the implementation, not maintained separately.

This pattern becomes more attractive as the command surface grows (especially for MCP). For `cb` today the flag surface is small enough that individual flags are fine, but worth keeping in mind if the API expands or agents start constructing calls programmatically at scale.

### CLI output as structured streams

The `--deliver=webhook:url` pattern (route CLI output to a file, webhook, or stdout) is really reinventing the pipe inside the CLI. Shell already does this: process substitution + `tee` + `jq` can route different parts of a JSON stream to different destinations without the CLI knowing anything about it:

```bash
cmd | tee >(jq '.notification' | curl -d @- webhook-url) | jq '.content' > out.file
```

This only works if the CLI emits structured JSON in the first place — which is the real precondition. Once it does, `jq` + `tee` + shell become a capable router. The `--deliver` flag trades shell composability for CLI-internal routing; not obviously a win.

The harder problem `--deliver` doesn't solve: stdout is flat. If you want content to go one place, a notification to go another, and metadata to go a third, you need either multiple named output streams (not a shell primitive) or a structured envelope that the consumer splits apart. JSON streaming output is the envelope answer — but then you need the consumer to split it, which is back to shell composition.

The feedback direction (agent reports CLI friction upstream) is genuinely new — there's no pipe equivalent for that. Worth thinking about separately from delivery. — **IMPLEMENTED** as `cb feedback`: agent runs `cb feedback "<observation>"` to record CLI friction to `config/feedback/`, committed silently with session context. Collection and review via `~/src/callback/feedback-review/collect.ts`. Knowledge audit tests in `cb-feedback-*`.

Taken far enough, this stops being shell and becomes a dataflow/glue language. Which may be the right answer, but is a different design space than "CLI with better flags."

### Structured CLI output with UI rendering

`cb` commands could default to JSON output (or always emit it with `--json`) and the web UI could have per-command renderers — a React component or HTML template that receives the JSON and displays it nicely. This dissolves the tension between "JSON for agents, formatted tables for humans": the CLI is always machine-parseable, and the UI layer is where human-friendly rendering happens.

The analogy is how `git log --format=json` doesn't exist but git GUIs parse git's output anyway — except here the command itself controls the schema and the renderer can be co-designed. Commands would declare their output schema; the UI maps command names to renderer components. The admin page or a debug panel could be the first surface.

This also helps with the bounded-output problem: a renderer can decide what to show by default and expose a "show all" control, rather than the CLI trying to guess a good human default.

### Agent "give up" mechanism

Agent writes `.callback-box/agent-failure.json` with `{ reason, phase, sessionId }` to signal it can't complete. Caller detects, reverts uncommitted changes, logs failure. Prevents half-finished work from being committed.

### Chat assistant as job dispatcher

The chat frontend's system prompt should instruct the assistant to use jobs to start tasks rather than executing them synchronously. Also provide it with docs and CLI query tools to check: what's currently running, what's scheduled to run, when something last ran.

### Automatic transcript handling in schema instructions

Several card type instructions (memo, audio, capture-session) include details about transcription handling (checking for `<transcription>`, skipping untranscribed audio, etc.). This should ideally be handled automatically by the processing pipeline rather than requiring agents to understand transcription state. The schema instructions should focus on describing the card's content and structure, not transcription machinery.

### Documentation graph — IMPLEMENTED

Implemented as `docs/doc-graph.md` (auto-generated cross-reference report). See CLAUDE.md Doc Map.

### Speech playback timing

Currently TTS speech doesn't play until the full response is complete (or at least a significant chunk). This means the "speak before doing work" pattern in the chat system prompt doesn't actually work as intended — the user hears the speech and sees the results at the same time, not speech-first. Investigate whether streaming partial speech playback is feasible so the user hears "Let me look into that" before tool calls start executing.

### Voice keyword for photo capture

Add a keyword trigger during voice input (especially the Clerk long recording mode) that captures a photo from the camera. Useful for annotating voice notes with visual context.

### Image card EXIF date extraction

When processing image cards, extract the date taken from EXIF data (DateTimeOriginal) rather than relying on file timestamps, which are unreliable after syncing/copying.

### Agent-editable UI text

The feedback confirmation messages ("Got it, I'll keep that in mind") feel like they come from a service, but they're actually queuing work for the agent. The agent can't directly respond in real-time, but it could edit a "translation file" of UI phrases to make them sound more like its own voice. This would let the agent personalize how the system communicates, even in places where it can't respond dynamically.

### Share-to-box for images and files

The iOS Shortcut share flow currently only handles URLs (opens a browser page with query params). For images, files, and plain text, the shortcut would need to POST data directly to an upload API endpoint using the "Get Contents of URL" action. The `cb create` command already supports `--attachment` and `--attachment-mimetype`, so the backend card creation works — what's needed is a simple HTTP upload endpoint (multipart POST → create card with attachment, no SSE). This would let the share shortcut accept any share sheet type, not just URLs.

### Per-user Google OAuth tokens

Currently Google connector tokens are stored per-box in a single `google.secret.json`. Any box user should be able to connect their own Google account. This means per-user token storage (e.g., keyed by email), knowing which user's tokens to use for which operations, and the OAuth callback tracking which user initiated the flow.
### Chat supplementary text — IMPLEMENTED

Updated `CHAT_SYSTEM_PROMPT` in `chat-session.ts` to describe two-channel output: `<speech>` tags for TTS, and markdown display text outside speech for visual details. Frontend already supported this (ReactMarkdown rendering + speech tag stripping).

### Chat page improvements

Several things for the chat page:

- **Image paste/capture**: support pasting or capturing images directly in the chat input.
- **Max width**: the chat page needs a max-width constraint and general layout cleanup.
- **Rich text input**: consider using TenTap (or similar) for message composition.
- **Capture-from-chat flow**: add a "Capture" item to the chat composer's `+` menu (alongside Camera and Attach file). Selecting it runs a capture session, then returns to chat with a message announcing the capture has been added — referencing what was captured, not the content itself.

### Transcript processing as labeled sub-agents

Two levels of transcript processing that map to different agent types:

1. **Cleanup transcript** (sub-agent) — canonical, well-defined task. Takes raw transcription, cleans up false starts, repetitions, filler words. Preserves original language. Input/output are both text. This can have a standard implementation that works the same way every time.

2. **Restructure into story/formatted text** (skill or procedure) — needs wide context, user preferences about voice and style, judgment about what to keep and what to cut. Not canonical — the rules depend on what Rosa (or whoever) wants. Better as a procedure with custom instructions per use case.

The cleanup sub-agent could be used directly by the inbox processor. The restructure step would be set up by the user as a procedure, possibly chained: raw transcript → cleanup sub-agent → restructure procedure → finished piece.

Key principle: the procedure should show its work. For restructuring, that means demonstrating which words are original vs. edited, with a well-aligned comparison between source and output. This makes the AI's edits auditable and keeps the result grounded in the original language.

### Accountability / goal tracking

Someone sets a personal goal — like drinking water 3 times a day, or practicing guitar — and messages the box when they do it. The box tracks check-ins throughout the day, then posts a summary to the group chat at the end of the day: did they hit their target or not? The family provides the accountability. The goal is a card, check-ins come through chat, and the end-of-day report is a scheduled procedure. Could be playful — streaks, encouragement from the box, family members commenting.

### "Show everything" Markdown mode

The `<Markdown>` component has a `showComments` prop (default off) that reveals HTML comments (`<!-- ... -->`) as styled inline text. This could be extended into a broader "show everything" toggle that exposes hidden structure in rendered documents — comments, metadata markers, processing annotations.

For card-based documents this matters less (cards have explicit schemas), but for generated Markdown (briefs, summaries, agent output), comments are a natural place for agents to leave structured annotations — source attribution, confidence notes, revision markers — that are invisible by default but available on demand. The toggle could live in a debug/detail panel or as a per-view option.

### Review all prompts

`pnpm prompt-report` generates `docs/prompts.md` — a full inventory of every prompt, instruction, and rule in the system with scope annotations. Use this to review the full prompt surface area, spot inconsistencies, and identify improvement opportunities across agent system prompts, schema instructions, procedure templates, and connector rules.

### Session output critique tool — IMPLEMENTED

Implemented as `cb session <id> --tool-report` + `@session-critique` subagent. See `docs/testing.md` § Session Critiques for usage.

### Markdown cards (replacing XML)

Consider replacing card XML with Markdown files that have rich validated frontmatter (YAML). The frontmatter would carry all the structured data currently in XML attributes and elements, validated by Zod schemas just like today. The body would be Markdown instead of XML content elements.

Conventions for inline annotations could handle things like source attribution, status markers, or cross-references within the Markdown body. A `type` field in the frontmatter (or the file extension) would determine the schema, and could even indicate a non-Markdown content type for the body if needed.

Benefits: agents already write Markdown fluently, diffs are cleaner, easier to read/edit by hand, no need for the cardworks XML library. Tradeoffs: XML's strict structure prevents malformed cards — Markdown frontmatter is more loosely coupled from the body content.


### Agent "give up" mechanism

When a Claude Code agent can't complete a task, let it write `.callback-box/agent-failure.json` with `{ reason, phase, sessionId }` before exiting. The caller (wakeup cycle, procedure engine, job dispatcher) detects the marker, reverts any uncommitted changes in the box, logs the failure, and moves on. Prevents half-finished work from getting committed and masks "silent success" failures where the agent bailed without indicating it.

### Chat assistant as job dispatcher

The chat frontend's system prompt should instruct the assistant to *dispatch jobs* to start tasks rather than executing them synchronously inside the chat turn. Plus give the assistant CLI query tools + docs to check: what's currently running, what's scheduled, when something last ran. This makes long-running work feel responsive in chat (assistant reports "I've queued X", user can ask "what's running?") and keeps the chat session from holding resources.

### Voice keyword for photo capture

Add a keyword trigger during voice input (especially the Dropbox long-recording mode) that snaps a photo from the camera mid-recording. Useful for annotating voice notes with visual context — "take a picture" while dictating about something visual produces a linked photo + transcript pair.

### Image card EXIF date extraction

When processing image cards, prefer the date from EXIF `DateTimeOriginal` over file timestamps. File mtime/ctime are unreliable after syncing/copying (common with photo workflows) — EXIF is the source of truth for when the photo was taken.

## Gmail sync improvements

The current Gmail connector dedups via a `seenMessageIds` list (capped at 5000) plus a `lastPullDate` `after:` filter. The cap and the date filter interact in ways worth revisiting:

### Drop the `seenMessageIds` cap

Each ID is ~16 chars, so 100k IDs is only ~1.6MB on disk. The 5000-cap exists to keep state small, but it means a labeled set larger than 5000 would roll IDs out and re-fetch them. Removing the cap (or raising it dramatically) lets the bare `label:inbox` query also drop the date filter safely, simplifying the code and fixing the labeling-as-routing case for the unbounded fallback too.

### Detect newly-labeled messages even on the unbounded query

For the bare `label:inbox` default, the date filter is currently kept (see `buildQuery`) to bound the list call. That means labeling an old message and expecting it to flow into the box doesn't work unless the user has configured `labels` or `query`. Options: widen the `after:` window (e.g. `lastPullDate - 30d`) to catch recently-labeled older messages, or use Gmail's history API (`users.history.list`) to incrementally pick up label changes. The history API is the right answer long-term but is a bigger change.

### Garbage-collect unlabeled messages

If a message in the box loses its triggering label in Gmail (user archives it, removes the label, etc.), the box still has the inbox card and the seen ID. There's no signal back. A periodic reconciliation pass — list current matches, remove cards whose IDs no longer match — would close the loop, but needs careful design to avoid deleting cards the user has already acted on.

## Full-text + semantic search over a box

Today discovery in a box is path-based and rule-injected (great for agents, weak for humans). There's no Quick-Switcher / Cmd-Shift-F equivalent — a boxholder who wants to find a specific card has to `grep` or ask the agent. Worth borrowing the Obsidian-style read surface even though writing remains agent-driven.

Prior art: `~/src/ske/ske/src/index/search-index.ts` uses **[Orama](https://github.com/oramasearch/orama)** (`@orama/orama` + `@orama/plugin-data-persistence`) — pure-TS in-process search with both full-text and vector modes. Single binary index file on disk (`search.msp`), restore-from-file on startup, no external service. The ske schema indexes `{ path, kind, name, content, contentHash, embedding: vector[512] }` and exposes `textSearch` + `vectorSearch` with `pathPrefix` / `kind` filters.

What ske did that transfers well:

- **Per-tag indexing for XML** — `extractSearchableTags` walks the XML tree and emits one document per tag-path (`/recipe/ingredient`, `/recipe/step`). Lets search hit specific structural locations, not just whole files. Same pattern works for cards.
- **Markdown section indexing** — `extractMarkdownSections` splits docs by header hierarchy. Useful for guides and generated docs.
- **`contentHash` field** — lets reindex skip unchanged documents.
- **Excerpt generation** around the matched term for result display.

Why this is a good fit for callback specifically:

- Typed cards mean the index schema can include `kind` for first-class filtering by card type.
- Refs already give us a graph; pairing it with text/vector search would close most of the human-discovery gap identified vs. Obsidian (Quick Switcher, Cmd-Shift-F, Omnisearch-style ranking).
- Vector search on uplifted card text would catch "I'm looking for that thing about X" queries where the user doesn't remember the exact wording.
- Index lives in `.callback-box/` (already gitignored), rebuilt by `cb init` or incrementally on commit.

Shape of the work:

1. `cb search "query"` CLI — text + path/kind filters, excerpt output.
2. Web UI Cmd-K palette over the same index.
3. Optional: an MCP tool or `cb search` invocation surface for the agent itself, useful when "what cards mention X?" beats `grep` (synonyms, partial matches, ranking).
4. Embedding generation can be lazy / opt-in (cost) — start with text-only.

Not urgent. The agent doesn't currently need it (path conventions + rules cover its discovery), and humans get by with the chat assistant. But it's a high-value, low-risk addition when human direct-browsing becomes a friction point.

Another option worth looking at: **mempalace** — <https://github.com/mempalace/mempalace> — framed as a memory-palace tool but effectively a search/recall surface over arbitrary notes. Different ergonomics from Orama-style index search; worth a side-by-side if/when this work lands.

## Backlinks surface ("what links here?")

Cardworks already exposes the ref graph — `findIncomingRefs(targetPath)` and `findOutgoingRefs(sourcePath)` in `cardworks/src/loader/loader.ts`. The data exists; no read surface does. Obsidian's Backlinks pane is widely considered its most-used navigation surface, and we have a richer (typed, versioned, fragment-addressable) reference model — closing the UI gap is mostly plumbing.

Sources to merge into one "incoming" list:

1. **Formal refs** — `ref=""` and `refs=""` attributes on any element. Already indexed. Includes version + fragment, so a backlink can say "Recipe.card references this @1.0.0 at `//step[@id='saute']`".
2. **Markdown links in card text** — `[label](path/to/Other.card)` written in prose-typed elements (memos, notes, guides). Not currently part of the ref graph. Need a markdown-aware extractor that resolves relative paths against the source card's location and emits virtual references. Worth detecting both `.card` targets and links to non-card files (images, attachments) so attachments can also answer "where is this used?".
3. *(Optional, later)* **Unlinked mentions** — Obsidian-style: scan card text for plain occurrences of other cards' names/aliases that aren't yet linked. On uplift, the agent can be prompted "this memo mentions 'Jane' — should I `ref` her person card?" — same affordance as Obsidian's one-click promotion, but agent-mediated rather than UI-button.

Surfaces:

- **Card detail view** — a "Referenced by" panel listing incoming refs with source card name, kind, and the structural location (XPath fragment or element type). Group by source kind.
- **`cb refs <card>`** CLI — `--incoming` / `--outgoing`, JSON or table output. Useful for agents during cleanup ("is this card still referenced anywhere?") and humans during direct inspection.
- **Pre-delete check** — before `cb rm`, surface incoming refs so the user/agent knows what will dangle. Cardworks already updates refs on `cb mv`; delete should at least warn.

Combine well with the search feature above: search results that include a backlink count give a quick "popularity" signal for which cards are central to the box.

**Show the version each backlink pins.** Refs carry a version (`@1.0.0`), and the design stance is that those versions should be preserved — a ref captures what the linker meant *at link time*, not whatever the target looks like now. So the backlinks panel should visually distinguish refs to the current version from refs to older versions, and clicking through to an old-version ref should display the historical card content (from git) rather than silently substituting current. See the addressability section below — same principle.

Not urgent for the same reason as search — the agent navigates by path conventions and the user navigates via chat. Becomes important once humans start browsing cards directly, or once we want the agent to do graph-aware reasoning ("clean up cards with no incoming refs older than 90 days").

## Addressable URIs for cards, elements, and versions

Goal: every card, every addressable element inside a card, and every version of either should have a stable URI that can be pasted anywhere — emails, calendar events, chat assistants, other cards, external scripts — and resolved by the callback web UI.

Shape:

```
https://box.example.com/<box>/<path/to/Card.card>[@<version>][#<fragment>]
```

Where `<fragment>` follows cardworks' existing scheme (`id`, `query(xpath)`, `query-all(xpath)`).

The design stance is **historical truth over current validity**:

- Path rewrites on `cb mv` continue to be applied to existing refs — that preserves identity, which is the right move.
- Version pins are sacred — a URI with `@1.0.0` should always resolve to that version's content, served from git history if the live card has moved past it. The web view shows a banner "viewing version 1.0.0; current is 1.2.0" with a link to current.
- An unversioned URI resolves to current (the common case).
- An invalid version (deleted, garbage-collected) shows a clear "version no longer available" rather than silently substituting.

This sidesteps the Obsidian failure mode where `[[Note]]` always resolves to current and link intent decays as notes evolve.

**Prerequisite work**: version semantics need to be deliberate again. Card root-tag versions got lazy after the ske era — for URI version pinning to be meaningful, versions need to change on meaningful events (schema-incompatible change, significant content revision) rather than be noise or always-1.0.0. Worth a deliberate pass on what bumps a version, who does the bumping (agent at edit time? schema-driven?), and how garbage collection interacts with the "every old version is addressable" promise (it probably means *never* GC versions referenced by any live ref).

No `callback://` URI scheme needed — plain `https://` does the job and works across email, calendar, external apps, and chat without any handler registration.

## Cmd-K: document-scoped fast chat

The web UI gets a Cmd-K palette that's not really a "command palette" in the Obsidian sense — it's a **lightweight chat session scoped to the current document**, backed by a fast/cheap model (Haiku). Distinct from the main chat assistant (which is cross-context, agentic, can dispatch jobs).

Use cases:

- "find me the section about X" — jumps within the current card or across a small surrounding set
- "open the recipe Jane sent me last week" — quick navigation
- "summarize this" — local summary, no work dispatched
- "what does `<fragment>` mean here?" — schema-aware explanation of a card element
- "what links to this?" — backlinks query, surfaced inline

The cheap-model choice keeps latency in the keyboard-shortcut tier and cost negligible enough to leave it always-on. It resolves the "is this a command palette or a chat?" tension by collapsing it: a Cmd-K palette where the input is natural language and the affordances are navigation + Q&A about what you're looking at.

## "Today" view as a recurring procedure

Rather than build a hardcoded "today" page like Obsidian's daily notes, make it a procedure that emits a `daily-digest` card each morning. Aggregates whatever the boxholder configures: today's calendar, recently arrived inbox, jobs run overnight, the latest capture-session summary, fresh commits. Renders as a regular card with the box's existing view machinery — no special UI path.

Optional / opt-in during initial box setup, edited like any other procedure. Fits the agentic-composition model: today-view isn't a feature, it's a pattern. Different boxes want different aggregations (a hearth box vs. a research box vs. a family box) and the procedure form lets them differ without core changes.

## iOS share-sheet capture (PWA + Shortcuts)

Both routes avoid needing a native iOS app, which avoids Apple's developer fee, App Store review, and the IAP question entirely.

**Primary**: register the box web UI as a PWA with `share_target` in the manifest. When a user adds the PWA to their home screen, callback shows up as a share destination from any iOS app — Photos, Safari, Voice Memos, etc. Worth verifying current iOS Safari support before committing; share-target support has historically been partial and behind Chrome's. Test on a real device with iOS 17+ before promising the workflow.

**Fallback**: an iOS Shortcut that POSTs to the box's capture endpoint. Five-step setup, no app required, supports any input type the Shortcut can produce. Worth shipping a pre-built Shortcut file users can install in one tap, plus a `docs/ios-shortcut.md` walkthrough.

Either route gives the boxholder one-tap capture from anywhere on iOS — the input-surface gap with native apps largely closes without callback ever entering the App Store.

## Canonical wisdom corpus (in lieu of plugins)

Obsidian's plugin ecosystem solves "how do I extend the tool to do X?" by letting any developer publish installable code. In an agentic system the question is different: the agent can already compose primitives, so the missing piece isn't *code* but *knowledge* — what's a good way to track books? How do recipe collections usually get organized? What's the right schema shape for a CRM-lite?

The proposed analog is a **Wikipedia-shaped corpus of canonical knowledge** the agent consults when the boxholder expresses intent. Not installable, not executable — just documents (probably cards themselves) describing patterns, conventions, and design considerations for common goals. The agent reads, then assembles primitives within the box accordingly.

Properties this would want:

- **Browsable by humans** as well as agents — the boxholder can read "how people structure book tracking" and decide they want a variant.
- **Versioned and stable** — older boxes referencing older guidance shouldn't see it silently rewritten.
- **Collaborative / curated** — a shared remote (or set of remotes) rather than per-box, so wisdom accumulates across the user base.
- **Discoverable on intent** — when a user asks for X, the agent searches the corpus and surfaces relevant entries; the user can override or extend before the agent commits to a build.

Long horizon. The minimum viable version is just a `docs/patterns/` directory inside callback-box itself with a handful of curated examples, surfaced to the agent via the existing rule system. The maximum is something like a federated wiki of agentic-design patterns across many systems. Worth flagging now so the architecture doesn't accidentally foreclose it (e.g., by hardcoding patterns into core rather than treating them as content).

## Filed for later: redraw

<https://wcandillon.github.io/redraw/> — no obvious use case in callback today, but worth remembering exists if we ever want richer visual / hand-drawn rendering in the UI.

## Filed for later: mado

<https://github.com/akiomik/mado> — fast Rust Markdown linter, CommonMark + GFM, ~50x faster than markdownlint. We already lint markdown, so this is mostly a speed win. Caveats: probably doesn't help with the link-checking we care about, and unclear whether either our current linter or mado understands Markdoc (which we plan to adopt).

Comparison of markdown linters: <https://panache.bz/guide/comparison.html> (covers several dialects but not Markdoc).

## Fancier PDF manipulation

If we ever want richer PDF handling than scan-import currently does — form-field detection, structured extraction, layout-aware parsing — `commonforms` looks worth a look.

- <https://github.com/jbarrow/commonforms>
- HN discussion: <https://news.ycombinator.com/item?id=47984675>

## Redacted text (Threads-style spoiler/reveal)

Threads (and a few other apps) render spoiler text as a blurred / blocked-out span that the reader taps to reveal. Useful for the agent when it wants to surface something the boxholder shouldn't see at a glance — quiz-style answers the boxholder asked to attempt first, hints that would spoil a guess in progress, intermediate reasoning offered as a tap-to-check.

Agent-authored only. The boxholder has no UI affordance for producing redacted spans, so the syntax doesn't need to be ergonomic to type — a markup tag (e.g. `<redacted>...</redacted>`) fits the agent's existing speech/instruction tag vocabulary better than a Markdown extension.

Rendering: a blurred or solid-block span, tap to reveal. Should also work in printed/SSR output (CSS-only reveal-on-tap, no JS dependency).

## Demo readiness

Triggered by an opportunity to show callback box live that came up before either the system *or* a prepared narrative was ready for it. Two distinct gaps worth thinking about:

**The system's demo-readiness.** Right now a fresh box is empty and a real box is full of personal/private content — neither demos well. There's no middle state. Worth thinking about: a "demo box" preset that seeds a plausible, non-private starter set (inbox items, a couple of guides, a few cards in store/, a scheduled task or two) so the UI has something to show without exposing real data. Could be a `cb init --demo` flag, a separate `~/src/boxes/demo/` checked in somewhere, or a scenario fixture (see `src/scenario/`) that boots one on demand. The connector story is the hard part — most of the interesting flow involves email/RSS/calendar, none of which seed believably without either real credentials or canned fixtures.

**My demo-readiness.** Independent of the system: a short demo needs a script, a known-good golden path, and at least one rehearsed "here's where it gets interesting" moment. The instinct to show "everything" in five minutes is the failure mode. Probably worth keeping a `docs/demo-script.md` or similar — even a stub — so the next opportunity isn't a cold start. Also: a list of things that *don't* yet work well enough to show, so I can route around them without discovering live.

Neither is urgent until the next opportunity. But the friction is reusable — the same gap will appear every time.

## Chat controls — try a design consultation pass

The chat controls in callback-box are a genuinely hard, complex design problem: a chat surface that's also a control surface, with a developer-user, an LLM, structured commands, an evolving set of in-progress states, and many things that could go wrong needing to be made visible (per the transparency principle — see ~/.claude/projects/-Users-ianbicking-src-callback/memory/feedback_transparency.md). They've evolved incrementally rather than being designed end-to-end, and the accumulation shows.

Worth a deliberate pass with a design consultation or shotgun approach. Two patterns from gstack worth borrowing for it:

- **SAFE / RISK split**: explicitly separate where the chat controls should look like a typical chat UI (so users aren't disoriented) from where they should deliberately diverge (because the developer-user + transparency posture call for surfaces a normal chat doesn't have — visible state, inspectable in-flight work, error states that don't hide). Each risk gets a "why it works, what it costs" justification.
- **Memorable-thing forcing question**: what's the one thing a developer-user should remember after seeing the chat controls for the first time? Probably has to do with transparency or agent-as-collaborator. Constraint that disciplines everything else.

Full notes on the underlying skills: `~/src/callback/gstack-review/notes/design-consultation.md` and `notes/design-shotgun.md`. Not adopting the gstack skills wholesale (heavy infrastructure), but the SAFE/RISK and memorable-thing patterns work standalone.

## In-repo issue tracking — evaluate Beads

This `ideas.md` plus scattered TODOs across the monorepo is the current state of issue tracking. It works for a single agent reading the file top-to-bottom but has known weaknesses: no dependency graph, no "what's ready to pick up next" query, every session loads the whole file, parallel worktrees can't safely claim work, closed items either rot in place or vanish without summary.

[Beads](https://github.com/steveyegge/beads) (Steve Yegge, late 2025) is the most-developed entrant in the "issue tracker designed for coding agents" space. Shape: a `bd` CLI backed by Dolt (SQL with git-style branching) in `.beads/`, with a JSONL changelog at `.beads/issues.jsonl` that's the git-tracked, human-diffable layer. Distinctive bits for agent workflows:

- `bd ready` returns only unblocked leaves of the dependency graph — the agent gets actionable work without loading the whole plan.
- `bd update <id> --claim` is atomic assign+start, so two worktrees can't race the same task.
- Typed dependencies (`blocks`, `parent-child`, `discovered-from`, `supersedes`).
- Hash-based IDs (`bd-a1b2`) that don't collide on parallel creation.
- `bd remember` / `bd prime` build a persistent project knowledge base injected at session start; closed-issue summaries fold in.
- `bd setup claude` wires the harness.

Fits the existing infrastructure surprisingly well: the `WorktreeCreate` hook already runs setup per worktree, so a `bd ready` call at session start is a natural extension. Per-subproject scoping via labels (`callback-box`, `cardworks`, `clerk`, `agent-doctest`).

Costs to weigh: another binary + daemon (tension with "noisy output is a bug"); JSONL churn in commits; lock-in to Dolt's storage; the convention of treating closed issues as memory rather than archive is a behavior change for the user, not just the agent. The casual alternative (gstack's single `TODOS.md` with a strict What/Why/Effort/Priority/Depends-on template enforced by a skill) gives up dependency queries and parallel-agent safety but keeps zero deps.

Probably too many new things to introduce at once — capability map, memory-writing guidance, user-model dimensions, hot-context, and *also* a tracker rewrite is a lot. Worth a feel-out pass first: keep watching how the current `ideas.md` + per-area TODOs actually fail before committing to a tool. Decision trigger: the first time two worktrees want the same task, or the first time "what should I work on next" requires more than skimming this file.

## Move more dev scripts from `pnpm exec` into `bin/`

`bin/` is the brand for the project's first-class dev tools — `bin/browse`, `bin/worktrees`, `bin/cb`. Anything an agent or developer reaches for regularly should live there as a thin wrapper, not be invoked via `pnpm exec <tool>`. A local path (`bin/foo`) tells the agent "this is ours, look at the source if you need to understand it"; `pnpm exec foo` looks like an upstream tool with no local affordances. Audit `pnpm exec` invocations across scripts, READMEs, and CLAUDE.md files — anything used more than once or twice is a candidate to pull out.

## `bin/browse` wrapper — keep, drop, or replace with a context file?

Observed in an agent session: the wrapper's one real ergonomic feature (path-rewriting, `bin/browse open /chat` → router URL for the current worktree) went unused — the agent constructed full `localhost:3210/<wt>/<box>/...` URLs every time, partly because the user's question anchored it to a specific URL, partly out of habit. The `bin/` prefix also imposes a small `cd` tax (running `bin/browse` after `cd callback-box` fails).

Three directions to consider, not mutually exclusive:

- **Replace the rewriting with a `BASE_PATH.txt` file** that holds the current worktree's URL prefix (e.g. `http://localhost:3210/deeper-paths-fix/test1-deeper-paths-fix`), rewritten by the `WorktreeCreate` hook, and pulled into CLAUDE.md via an `@BASE_PATH.txt` include. Agents construct URLs directly using that prefix; no wrapper needed; `agent-browser` goes on PATH (`pnpm exec` symlink or `~/bin` shim). Simple, makes the rewriting visible rather than magical.
- **Keep the wrapper but make it invisible** — symlink `bin/browse` into a PATH dir during install, or document an alias. Preserves the path-rewriting feature and removes the `cd` annoyance.
- **Small patches if we keep it:** print a one-line "ok" on `reload` and `network requests --clear` (silent success forced an agent into a `sleep`-and-pray pattern); investigate why `reload` didn't bust the `manifest.webmanifest` cache after a file edit (a `reload --hard` option, or always sending `Cache-Control: no-cache` on reload, would close that gap).
