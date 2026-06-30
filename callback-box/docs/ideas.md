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

## Where self-authored instructions live — the loading-eagerness axis

When the boxholder agent learns something durable and writes it down as
*instructions* (akin to CLAUDE.md), where should it land? Today the only home
is CLAUDE.md, which has one property that's both its value and its trap: Claude
Code auto-loads it natively. The real design question is a single axis — **how
eagerly is a piece of self-authored guidance loaded into context** — and the box
should route guidance onto the right tier rather than letting everything pile
into the always-on one.

The tiers, cheapest-to-load last:

- **Always-on** — root `CLAUDE.md` + the generated `agent-guide.md`. Paid for on
  *every* turn. This is where unbounded growth hurts most; a too-large always-on
  file silently crowds out the task and models start dropping instructions past
  ~200–300 lines. (A soft size lint on box CLAUDE.md files now guards this tier —
  `src/core/claude-md-lint.ts` — but a guardrail isn't a router.)
- **Path-scoped, lazy** — nested `CLAUDE.md` (auto-loads as the agent traverses
  into a directory) and `.claude/rules/*.md` with glob frontmatter (auto-loads
  when the agent touches a matching file — exactly how `init-rules.ts` turns each
  card type's `instructions` into a `card-<type>.md` rule). Loads only when you're
  working *near* the relevant files.
- **Task-scoped, lazy** — skills. Surfaced by their `description` and loaded on
  demand when the *task* matches; **not directory-scoped** — global to the
  session, lazy, heavier to author than a paragraph in CLAUDE.md.

Two sub-ideas that turn out to be the same question from opposite ends:

1. **A card type for instructions.** Self-written instructions (akin to
   CLAUDE.md) marked as a distinct, validated type — so they're auditable as
   agent-authored guidance, listable, and reachable by tooling (e.g. the size
   lint, freshness checks). **Caveat:** marking something a card *type* is
   orthogonal to *loading*. CLAUDE.md's whole value is native auto-load; a card
   wouldn't reach context unless wired into assembly — most likely via the
   path-scoped `.claude/rules/` machinery the box already generates from schema
   `instructions`. So a type buys audit/validation/listing, but you still pick a
   loading mechanism underneath it.
2. **Be more eager to mint skills.** Good instinct *for procedural knowledge*
   ("when you're doing this kind of task, here's how") — it moves guidance off
   the always-on tier into something that costs nothing until triggered. But
   skills are global and heavier to author, so they're overkill for a one-line
   "remember X about this directory," which wants a nested CLAUDE.md or a rule.

Natural mapping: *"when you're working **here**, know this"* → nested CLAUDE.md /
a path-scoped rule; *"when you're doing **this kind of task**, here's the
procedure"* → a skill; *"this is always true about this box"* → root CLAUDE.md
(kept lean). The real artifact worth building is a **router** — guidance the
agent gives the boxholder on which tier a new durable instruction belongs on,
analogous to the memory-writing guidance above (which routes *facts*; this routes
*instructions*). Open questions: does the instructions-type earn its keep over
just-use-a-rule; should the box actively *suggest* promoting an oversized
CLAUDE.md section into a rule/skill when the size lint fires; how does this
interact with `agent-guide.md` generation (another always-on consumer).

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

**IMPLEMENTED (web chat, June 2026)** — as read-only attributes on the per-turn `<chat-app>` snapshot, computed by `src/core/session-context.ts`: `local-time` (named weekday + box-local clock + phase of day) and `channel` (`web-desktop`/`web-mobile`, classified from the request User-Agent) on every message; `last-activity` (from the most-active pointer's `savedAt`) and `calendar` (next 24h of `store/calendar/`) on the first message of a brand-new session only. Deliberately in message text rather than the system prompt: the warm-pool backend reuses a prewarmed subprocess only on an exact system-prompt match, so the prompt must stay time-invariant. Remaining: Telegram thread sessions (`chat-thread-session.ts`) don't use the snapshot and got none of this — wire it up when touching that area.

## Scheduled-task health surfacing

Scheduled automation (wakeup, scheduler ticks, overnight compaction once that exists, sync jobs) can silently stop running, and the failure isn't noticed until something downstream breaks (briefings stop updating, hunches stop being extracted, calendar drift). Stuff gets lost.

Primary mechanism should be *active monitoring*: each scheduled task records `last_run_attempted` and `last_run_succeeded` (which can diverge — see the same shape in the cache-freshness audit). Anything overdue past threshold or failing repeatedly triggers proactive notification, independent of any session.

Session-start surfacing is the *backup* layer: if you missed the proactive alert, the next chat session opens with a brief health-check note. Only surface when there's something to surface — "all green" every session is noise. Threshold: any task that's overdue, failed, or has been failing repeatedly.

Notes:
- This is the process-shape of the cache-freshness pattern. `data_through` for data; `last_run_succeeded` for tasks. Same divergence trick (attempted vs. succeeded ≈ checked vs. found-fresh-data).
- Should also be visible somewhere as an always-available view (status page, `cb health`) so it doesn't *only* surface at session start.
- The reason the agent should still check at session start, even with proactive alerting in place: catches bugs in the alerting itself. Belt and suspenders.

**IMPLEMENTED (June 2026)** — `src/core/schedule-health.ts` evaluates each task (ok/failing/overdue/blocked/invalid/disabled) from its card + run state (`lastRun`/`lastSuccess` divergence, consecutive failures); overdue derives from the task's own cadence (grace = half-cadence clamped to 30m–24h), and deliberate skips (budget, missing connector, disabled) are never mislabeled as failures. Surfaces: `cb health` (always-available, exit 1 when unhealthy), a `health` attribute on the session-start `<chat-app>` snapshot (only when something is wrong), and proactive alerts from the scheduler daemon — one aggregated telegram-message card per unhealthy episode (latched until the next success), opt-in via `healthAlerts.telegramChat` in `config/box.json`. The daemon also writes a per-box heartbeat so a dead scheduler is itself a finding. Remaining: a dashboard panel (the tRPC health router could reuse the same evaluator).

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

## In-chat interactive questions from the agent

Reported 2026-06-09: the chat agent can't actually ask the boxholder a question in chat — there's no working affordance for "agent asks, user answers, agent continues." The boxholder doesn't especially *like* being asked questions, but the models powering the agent ask them anyway (newer models especially), so the path has to work: a question with no answer affordance is a dead-end turn.

Pieces that exist and don't cover this:
- `box/questions/` — the async queue, for questions that can wait for a wakeup/review cycle. Not in-chat, not conversational.
- `<callout context="...">` — renders content the user must see, but it's one-way; nothing marks "this expects a reply" or structures the reply.

What's probably wanted:
- A structured question tag in the chat output vocabulary (sibling of `<callout>`), rendered with answer affordances — tappable options for the enumerable case (the Claude Code AskUserQuestion shape: 2–4 options + free-text "other"), plain reply for the open case. The agent's next turn receives the selection as structured input rather than parsing prose.
- A decision rule in the prompt about which channel a question belongs in: blocking-the-current-task → in-chat structured question; can-wait → `box/questions/` queue. (Connects to [[questions-aging-policy]] for the queued kind.)
- Voice mode matters: when the user is hands-free, options should be speakable ("say one, two, or three" is awful; the agent should phrase the question so a natural spoken answer maps onto an option).
- On mobile, tappable options are *faster* than typing — done well this reduces the friction of being asked, rather than adding to it.

Open question: is this purely a display/vocabulary gap (the agent asks in prose today and it merely *feels* broken because nothing renders it as answerable), or does something actively break (question gets swallowed, turn ends oddly)? Worth reproducing the failure first to pin which.

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
- **Relation to landmarks/triage-design.** `docs/plans/triage-design.md` already sketches a typed-routing pipeline using `<triage-destination>` on landmarks. Guides and landmarks both encode routing intent — figure out the division (landmarks = structural destinations, guides = policy for choosing among them?) before building either further.

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

## Surfacing context-size measurements well

The knowledge-audit report shows each audit's loaded-context size — `initial` (the always-on baseline the box pays every turn) → `peak` (+`added` over N turns), read from the session JSONL's per-turn `usage` (`lib/context-usage.ts`) — and every run appends those numbers to a committed history ledger (`src/dev/context-history.yaml`, `lib/context-history.ts`), so the git history is a free trend line. That closes the *raw-measurement* and *persistence* halves of the loop. What's left is making the trend **legible and enforceable** rather than something you reconstruct by diffing the ledger by hand:

- **Run-over-run delta in the report — DONE.** Each audit's context line now carries the change since the prior run (`Context: 38k initial (4 turns; −3k from last run)`), read from the ledger before the current run is appended (`lib/report.ts` `formatBaselineDelta`, wired in `knowledge-audit.ts`).
- **Aggregate summary at the top of the report — DONE.** The report opens with a `## Context baselines` table of every audit's baseline sorted high→low with its Δ-last-run, and calls out the lowest baseline as the cleanest estimate of the pure always-on tier (`lib/report.ts` `renderContextSummary`).
- **Baseline-ceiling assertion (the deferred check).** Once the ledger establishes a known-good baseline, a per-box budget in the audit config that fails the run when `initial` exceeds it — catches always-on bloat the way a bundle-size check catches JS bloat. Caveat already noted: `initial` includes the audit prompt + harness `WORKING DIRECTORY:` system prompt, a small constant that an absolute ceiling has to account for.
- **Compositional breakdown.** The most *actionable* and the most work: split the baseline into system prompt vs. agent-guide vs. box CLAUDE.md vs. tool schemas, so you know *which* tier to trim. The JSONL doesn't break `usage` down this way — it'd mean token-counting each component separately (the API's count-tokens endpoint, or a local tokenizer) and reconciling against the measured total.

Open questions: whether the trend belongs in the audit report or in a dedicated `cb context-budget` command that runs the 0-read audits purely as a measurement harness; how the ledger handles a box being audited from many worktrees (the box clone's HEAD churns on template-sync — see the harness note); whether the breakdown is worth the second token-counting pass or whether the ledger + a delta already give cb-context everything it needs.

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

## The interface itself as cards

A wild, probably-bad idea worth keeping on the table: what if interface surfaces —
the dashboard, history, maybe the questions queue or a landmark view — were *cards*
rather than bespoke React pages? The system already treats the filesystem as state
and cards as the universal addressable unit; today the UI is a separate layer that
*reads* cards but isn't made of them. If a dashboard were a card (a layout/query
spec in frontmatter, rendered by a generic renderer), then the whole interface
inherits the card substrate for free:

- **Referenceable.** Every surface gets a stable path, so you can link to "the
  dashboard," embed it inside another card, or point an agent at it the same way
  you point at any other card.
- **Configurable by editing, not coding.** Tweaking what the dashboard shows
  becomes editing a card's frontmatter (which queries, which order, which filters)
  instead of changing a `.tsx`. The boxholder agent could reconfigure a view by
  writing a card — no deploy.
- **Embedding + commenting + history come along.** Anything that already works on
  cards — transclusion, attaching a comment, git history of changes, validation —
  would work on interface surfaces too. A commented-on dashboard, a diffable
  history view, an embeddable mini-dashboard inside a daily note.

Honest skepticism: this is probably wrong as a wholesale move. Most real UI
(chat, the source editor, anything with rich interaction or live streams) is
genuinely code and would be tortured into a card-shaped renderer for no gain —
you'd reinvent a UI framework inside frontmatter. The interesting question is
*which pieces* are actually declarative-list-shaped (dashboard, history, a saved
filter, a "show me these cards in this layout" view) and would benefit from being
cards, versus which are inherently imperative and shouldn't. A "view card" schema
that renders a query + layout, sitting alongside the hand-built pages rather than
replacing them, is the version of this that might pay off. Related: the existing
`Agent-editable UI text` and `### Agent-editable UI text` entries gesture at the
same "let the agent shape the interface" impulse from the opposite (content, not
structure) direction.

Open questions: what a "view card" schema would actually contain (query DSL?
reference to a saved filter? a layout primitive vocabulary?); whether the generic
renderer is a new file-type renderer under `src/frontend/src/renderers/` or
something closer to the landmark system; where the line falls between "configurable
view card" and "just build the page." Start by finding the one surface that's most
purely a styled list (probably history or a saved-query view) and seeing whether
expressing it as a card feels like a simplification or a straitjacket.

## Triage agent that routes a message to the right chat session

An incoming message doesn't always belong in a fresh chat — often it's a
follow-up to an ongoing conversation, or a memo that some *existing* session is
already the right home for. Today a new message starts a new session (or lands
wherever the entry point hardcodes); nothing decides *where it should go*.

The idea: a lightweight **triage agent** sits in front, deciding the
destination. Probably its own intake endpoint — more "memo"-shaped than "chat"
(fire-and-forget capture, not a live two-pane session). The message hits the
triage endpoint, which spins up a short triage session seeded with instructions
on how to route, plus a **`switch-to-session` tool**. The triage agent either:

- decides this really is new → let it become/continue a session here; or
- recognizes it belongs to an existing session → calls `switch-to-session`,
  and the original message is **re-dispatched to that session** as if it had
  arrived there in the first place. The triage session itself is throwaway.

So the routing logic is the *re-send*: triage doesn't answer the message, it
just figures out the destination and replays the message into it.

Open questions (don't design here):
- **Target universe.** Just open web-chat sessions? Telegram threads too
  (there's already a thread→session registry — `chat-reactor-sessions.ts`)?
  Non-chat destinations (a job, a procedure, the inbox)?
- **What triage knows.** It needs a catalog of candidate sessions with enough
  summary to route — recent sessions + their topic/companion-card, the way the
  retro walker already enumerates sessions. How fresh, how much detail.
- **Endpoint shape.** Independent "memo" endpoint vs. intercepting the first
  message of any new session. The user leaned memo-like/independent.
- **Cost & latency.** Every routed message pays a triage agent turn before the
  real session even sees it — fine for async memo capture, a problem if it sits
  in the interactive send path. Suggests this is for the async/intake lane, not
  live chat.
- **Re-dispatch mechanics.** How a message is "sent again" into an existing
  session programmatically (the send path currently assumes a user/UI origin —
  see the `/chat/send` POST and the session registry), and what trace the
  triage hop leaves (none? a routing note?).
- **Failure mode.** Mis-routes are recoverable but annoying; the bias should be
  "when unsure, start fresh" rather than guess into the wrong conversation.

## Card-aware widgets for box-authored views

Boxes can write their own views (compiled JSX via `src/webapp/views/compiler.ts`),
but there's no reusable, card-aware widget set for the most common thing a view
does: *point at another card*. Today an author hand-rolls an `<a>` and has to know
the URL scheme / `view:` ref convention, and there's no off-the-shelf way to embed
a card. The render plumbing all exists — `FileView` already has
`page | chat | companion | embed` modes, an `onNavigate(target, hint)` primitive,
and `view:`/`ViewTarget` addressing — it just isn't exposed as drop-in components
the way `callback-box/cards` is exposed to box-local *schemas*.

Two widgets:

- **`<CardLink ref="…">label</CardLink>`** — link to a card by ref, resolving to
  the correct navigation (the same `onNavigate`/`view:` path the rest of the UI
  uses), with the ref validated like any card ref (so `cb validate`/`cb mv` track
  it — a JSX-embedded ref must not be a blind spot). The label falls back to the
  target's title when omitted, mirroring landmark `links`.
- **`<CardRef ref="…">` (link + expand)** — richer, with three affordances on one
  reference: **go** (navigate to the card), **inline** (expand it in place —
  `FileView` `embed` mode), and **small** (a compact representation). The
  interesting part: the *small* view is **controlled by the container**, not fixed
  by the widget — the container (or the target card's own renderer) decides how to
  summarize: a one-liner, a tile, a self-authored summary, whatever fits. So the
  widget delegates the small rendering rather than hardcoding a card chip.

Open questions:
- **Exposure to compiled views.** How the widgets reach a box-authored view — a
  public `callback-box/view-widgets` (or similar) specifier the compiler leaves
  unbundled / injects, paralleling `callback-box/cards` for schemas. What's the
  import surface and how it resolves in both the browser and `cb view test`.
- **The "small, container-controlled" contract.** Who actually renders the small
  form — a new `summary`/`small` `FileViewMode`? the target card's renderer
  exposing a compact variant? a render-prop the container supplies? This is the
  crux; the other two affordances (go, inline) already have homes.
- **Ref tracking.** Refs written inside JSX views need the same auto-tracking as
  card refs (`cb validate`, `cb mv` rewriting) — otherwise moving a target silently
  breaks a view. This is the same hazard the link-validation work just closed for
  markdown; JSX views are the next surface.
- **Consistency with what exists.** Landmark `links` (and the new chat-header
  landmark menu) already "go / open in sidebar"; these widgets should share the
  same open-in-companion mechanism (`onZoomView`) rather than invent a parallel
  one. Related: "The interface itself as cards" and "Agent-editable UI text".

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

### Automatic transcript handling in schema instructions

Several card type instructions (memo, audio, capture-session) include details about transcription handling (checking for `<transcription>`, skipping untranscribed audio, etc.). This should ideally be handled automatically by the processing pipeline rather than requiring agents to understand transcription state. The schema instructions should focus on describing the card's content and structure, not transcription machinery.

### Documentation graph — IMPLEMENTED

Implemented as `docs/doc-graph.md` (auto-generated cross-reference report). See CLAUDE.md Doc Map.

### Speech playback timing

Currently TTS speech doesn't play until the full response is complete (or at least a significant chunk). This means the "speak before doing work" pattern in the chat system prompt doesn't actually work as intended — the user hears the speech and sees the results at the same time, not speech-first. Investigate whether streaming partial speech playback is feasible so the user hears "Let me look into that" before tool calls start executing.

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

- **Image paste**: pasting images into the chat input — **IMPLEMENTED**.
- **Camera capture in chat input**: live photo capture (not just paste/file-attach) from the composer. Still pending.
- **Max width**: chat page max-width constraint and general layout cleanup — **IMPLEMENTED**.
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

A debug toggle on the shared `<Markdown>` component could reveal normally-hidden structure in rendered documents — HTML comments (`<!-- ... -->`) shown as styled inline text, metadata markers, processing annotations. Implementation-wise this would be a custom Markdoc node override (or a `debug`/`showComments` prop threaded into the Markdoc config) that renders comment nodes as visible spans instead of dropping them. Earlier the codebase had a `showComments` prop on `<Markdown>` backed by a custom `remark-comments` plugin; that came out with the Markdoc migration but the idea still applies — it just needs a Markdoc-shaped reimplementation.

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

Add a keyword trigger during voice input (especially the Clerk / Dropbox long-recording modes) that snaps a photo from the camera mid-recording. Useful for annotating voice notes with visual context — "take a picture" while dictating about something visual produces a linked photo + transcript pair.

### Image card EXIF date extraction

When processing image cards, prefer the date from EXIF `DateTimeOriginal` over file timestamps. File mtime/ctime are unreliable after syncing/copying (common with photo workflows) — EXIF is the source of truth for when the photo was taken.

## Gmail sync improvements

*(Implemented 2026-06: uncapped Gmail-id dedup checked before fetch, no date filters, incremental sync via the history API with full-list fallback, baseline no-import first sync for the bare `label:inbox` default. See `src/connectors/gmail-pull.ts`.)* Remaining:

### Garbage-collect unlabeled messages — IMPLEMENTED (2026-06)

When a thread loses its triggering label in Gmail, a cadence-gated
reconciliation pass full-lists current matches, diffs by Gmail thread id, and
withdraws the still-pending inbox card to `store/trash/`. Safety rests on
"location is state" — only cards still in `box/inbox/email/` are candidates, so
anything an agent already acted on is untouched. See
`src/connectors/gmail-gc.ts`, `docs/connectors.md`, and
`docs/implemented-plans/gmail-gc-unlabeled.md`. (Chose full reconciliation over
the `labelsRemoved` incremental signal — message-granular and lossy across
history gaps.)

## Full-text + semantic search over a box — IMPLEMENTED (text phase)

Shipped June 2026 as `cb search` + the global `contains:` field — see
`docs/implemented-plans/box-search.md`. Embeddings/hybrid remain future
(phase 3, own plan); the notes below are the original thinking.

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

## Preconfigured agent-browser scoped to the box (principal's permissions)

The box agent can read and write box files directly, but it can't *see the rendered box the way the principal does* — the actual web UI: how a custom view renders, whether a card page shows anything (cf. the workshop `.sandbox.card` blank-page incident, 2026-06-12, where the agent built a correct view but had no way to look at it), whether a dashboard or interactive app actually works in the browser. The dev-side `bin/browse` (agent-browser wrapper) gives main-repo agents exactly this against the local dev router; the box agent has no equivalent against its own deployed box.

Idea: give each box agent a preconfigured agent-browser that loads the box at the principal's effective permissions — authenticated as (or impersonating, server-side) the boxholder, scoped to that box's URL prefix, so the agent sees precisely what the principal sees, no more. Then "go look at the page you just built and tell me if it renders" becomes a real capability, and the agent can self-verify UI work instead of shipping blind.

Design questions:
- **Auth/identity.** The agent already authenticates loopback calls with the per-box agent token (`core/agent-token.ts`); the browser session needs an equivalent that the auth wall accepts AND that resolves to the principal's box-scoped permissions (not owner/global). Probably a short-lived browser-cookie minted from the agent token, gated to the box prefix. Must NOT become a privilege-escalation path — box-scoped, principal-level, read-oriented.
- **Where it runs.** Server-side (the box agent runs on the server, so a headless Chromium next to it hitting `127.0.0.1:3210/<box>/...`) vs. handed to the chat subprocess. Reuse the agent-browser infra `bin/browse` already wraps.
- **Capability surface.** Likely read-mostly: navigate, snapshot the a11y tree, screenshot, read console — the self-verification loop. Click/fill is more fraught (real mutations as the principal) and can come later behind explicit intent.
- **Connection to the views/interactive-app work.** This is the missing half of "agent builds an interactive app": build it (the view write API + card-type→view binding) AND look at it. Pairs with [[capability-map]] — "I can view the rendered box" is a composed capability the agent won't infer from its tool list.

## Prominence / surface-worthiness — one concept across tree nodes (cards AND directories)

Started as "a landmark-ish marker in the card itself" and resolved (2026-06-12 discussion) into a unification: **there is one editorial axis — "should the box surface this node?" — applied to nodes in the box tree.** A card expresses it with an inline marker; a directory expresses it with a landmark card. Today's landmarks (`docs/landmarks.md`) are just **the directory form of this one concept**, not a separate thing.

Why the directory form looks fatter (a whole separate `*.landmark.card` with label/symbol/pinned links) while the card form is a bare flag: it's forced by "a directory isn't a card." A directory has no frontmatter to mark and no intrinsic renderable identity, so it needs a proxy object supplying what a card supplies for itself — a name, an icon, a tile. The landmark's extra payload is exactly *prominence + the identity a bare directory can't carry*. A card already has a title, a type, and a renderer, so a flag suffices; the card renders its own tile.

The clincher for the unification: a landmark's hand-picked `<link>`s are the **manual** version of what card-prominence **auto-derives**. `<expand query="prominent">` replaces "list the key items here by hand" with "surface the cards that declared themselves key." The two layers collapse — directory landmark says "this spot matters," card prominence says "these documents in it matter," and the latter can feed the former instead of being curated twice.

The motivating shape: a `.sandbox.card` (2026-06-12) IS the activity; it should be the headline of its directory, shown by default through its own view, with attachments/logs/notes receding — "not a hard filter, but an editorial default that flips browse from flat-everything to here-are-the-real-things."

Caveat — don't over-unify: landmarks are currently **overloaded**. The `<navigation>` role is the directory-prominence thing that merges here. But landmarks also carry a `<triage-destination>` role (category rules + handler procedure) — that's intake *routing* policy, not prominence at all. The unification covers navigation only; triage-destination is a separate concern riding the same card type and should stay distinct (possibly: split it out so "landmark" cleanly means "directory prominence").

Design questions:
- **The card marker.** A boolean-ish attribute (`prominent` / `featured`), a small enum (`prominence="primary|normal|hidden"` — `hidden` is the useful inverse: demote housekeeping cards), or a dedicated element. Frontmatter/attribute keeps it cheap. Distinct from `status` (lifecycle) — this is editorial weight.
- **Who sets it.** Human, or the agent as it produces the main artifact of a piece of work ("this is the thing; the rest is supporting"). The agent marking its own headline output is the high-value case, and self-contained-in-the-card means prominence travels with moves/renames and needs no curation artifact alongside.
- **View-conditional, not global.** Browse's default view leads with prominent nodes and collapses the rest behind "show all"; a raw/flat mode still shows everything. Each view opts in. Also feeds [[today-view]] aggregation and search/excerpt ranking (a prominent card outranks a buried note).
- **Migration.** If landmarks become "the directory case," does the navigation-role schema get reframed/renamed, and do the two implementations share a "surface the prominent children" resolver (children being directories-with-landmarks + cards-with-prominence)? A single Browse resolver over both is the payoff.
- **Card-type→view binding.** A prominent `.sandbox.card` rendered through its custom view (the binding the interactive-views work needs) is the full picture: the right document, surfaced by default, shown as its app.

## Directory "head cards" — `Foo.type.card` + `Foo/` instead of `Foo.attach/`

Exploratory structural idea (2026-06-12), the deep version of [[card-level-prominence]]. Today a card relates to a sibling container exactly one way — `Foo.attach/` is Foo's private bag of binaries — and a *directory* gets its identity a different way: a `landmark`/`briefing` card placed *inside* it. What if instead `Foo.type.card` paired with a plain `Foo/`? Then **a directory's "head card" — a same-named sibling of any type — gives the directory its type, identity, prominence, and primary content at once.** `Recipes.landmark.card + Recipes/`, `Chat.sandbox.card + Chat/`, `Foo.doc.card + Foo/` all become one pattern, recursive down the tree (every directory optionally typed by its sibling). This generalizes the prominence insight: a bare directory lacks the renderable identity a card has, so it needs a proxy — the head card *is* that proxy, and making it any-typed unifies attachments, landmarks, and briefings into "directories have head cards."

**The fault line (the "are directories and attachments different?" hesitation, made precise):** two relationships hide under one naming scheme —
- **Owns** — `Foo.attach/` is *private content, addressed via `attach/` refs*, owned by Foo; it has no independent existence.
- **Heads/describes** — a landmark over a directory of *peer* cards that exist in their own right.

A bare `Foo/` can't say which, and the `.attach` suffix is doing real disambiguating work today: it keys the asset-manifest discipline (`**/*.attach/**`), gitignore patterns, and `attach/`-prefix ref resolution, and it sidesteps basename-uniqueness (`Foo.doc.card` + `Foo.attach/` don't collide; `Foo.doc.card` + `Foo/` would need a blessed pairing exception). Drop the suffix and you lose the "private, owned, ref-addressed" signal.

**Synthesis:** attachments are the special case of *a head card that owns its directory as private content*; a general typed directory is a head card over located *peers*. Same machinery (card + sibling dir), different *ownership* semantic — and that semantic wants to stay explicit (keep the `.attach` marker, or move it to a frontmatter field on the head card: "private bag" vs "peer namespace"), not be collapsed away.

Open tensions:
- **Basename-uniqueness rule** must learn to treat `Foo.type.card` + `Foo/` as a deliberate pair, not a lint collision.
- **Ref resolution** — how do refs point into `Foo/` vs the current `attach/` prefix?
- **mv coupling flips.** A head card *beside* its directory must move as a pair (`cb mv` already does this for `.attach/`); a landmark *inside* travels with the directory automatically. Beside is more visible in the parent listing (identity without descending) but more fragile to manual moves.
- **Asset-manifest** keys on `.attach/`; a rename of the convention is a migration touching that hook, gitignore, ref resolution, and `cb mv`.

Big migration, not near-term — but it's the structural endpoint the prominence + interactive-views + attachment-writes threads all lean toward, so worth holding before any of them hardcode the `.attach`-only assumption.

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

## Filed for later: sem — semantic git understanding

<https://ataraxy-labs.github.io/sem/> — overlays entity-level (functions, classes, methods) understanding onto git operations. Commands: `diff`, `blame`, `impact`, `log`, `entities`, `context`. The `sem context` command generates token-budgeted context windows for LLM prompts; claims 2.3x accuracy improvement for AI agents vs raw line diffs. Worth exploring for agent workflows — e.g. as input to code review, or for the "before you build this" reuse-search problem. (Came in via `cb feedback` 2026-06-07.)

## Fancier PDF manipulation

If we ever want richer PDF handling than scan-import currently does — form-field detection, structured extraction, layout-aware parsing — `commonforms` looks worth a look.

- <https://github.com/jbarrow/commonforms>
- HN discussion: <https://news.ycombinator.com/item?id=47984675>

## Knowledge budget for always-loaded agent context

The always-loaded layer (agent-guide.md, CLAUDE.md includes, system prompts) has no size discipline: every addition feels individually justified, and the layer only grows. Establish an explicit budget — a token/line cap the always-loaded corpus must stay under — so adding direct knowledge forces a trade: make the new thing indirect (a pointer to an on-demand doc), or demote something else to indirect to make room. Triggered 2026-06-12 when a credentials section initially landed as full inline policy and got corrected to a pointer; the principle generalizes: **direct knowledge is "where to look + the one rule that can't wait"; everything else is indirect.**

Mechanics worth considering: a generate-docs check that fails (or warns) when agent-guide.md exceeds the budget; a per-section line allowance; pairing with [[doc-usage-mining]] so demotion candidates are chosen by observed usage rather than guesswork. Connects to the [[capability-map]] global-vs-conditional-load question and the IA pass below — all three are the same tension (context cost vs. discoverability) at different scales.

## IA pass: chat agent's output-vocabulary docs

Triggered by adding `{% redacted %}` — there was no obvious place to document it for the chat agent. Looked into existing patterns and the categorization isn't clean. The chat agent's emit-side vocabulary currently splits along several un-aligned axes:

- **Display-side affordances** — `<callout>`, `<ack>`, `{% redacted %}`. How content is *shown*, independent of what it is. `<callout>` / `<ack>` are in the system prompt (core); `redacted` isn't.
- **Content-typed tags** — `{% quote %}`, `{% source %}`. Mark *what kind of thing* a span is. Probably should be in the prompt at some baseline level (an agent that doesn't reach for `{% quote %}` will write quotes flat); currently not mentioned.
- **Domain vocabularies** — recipe (`{% ingredient %}`, `{% step %}`), briefing (`{% purpose %}`, `{% key-person %}`). Only relevant when authoring that doc type; should be loaded by `paths:` rule when editing matching cards, not in chat prompt at all.
- **Protocol tags** — `<chat-app>`, `<schedule>`, `<cancel-schedule>`, `<speech>`. Already in prompt; not really "output formatting" — they're the control surface.
- **Voice overrides** — already gets its own on-demand doc (`docs/generated/chat-voice.md`).

Open questions the IA pass needs to answer:

- **What's "core enough to be in the prompt every turn"?** Probably `<ack>`, `<callout>`, `<speech>`, `<schedule>`, `<chat-app>` (already in). Probably also `{% quote %}` (so it gets used). `{% redacted %}` is borderline — niche enough to live in a reference doc, but the agent won't reach for it if it doesn't know it exists.
- **One reference doc or several?** A monolithic `chat-output.md` reads top-to-bottom but inflates loading cost when only one piece is needed. Per-tag docs scale better but the agent has to know to look. The narration-mode pattern (one doc per situation) doesn't map cleanly to vocabulary.
- **How does the agent discover what to reach for?** A vocabulary the agent doesn't know about is invisible — same problem as the [[capability-map]] entry. Possibly the answer is the same: a single browsable index of "ways to shape your output," consulted opportunistically.
- **Where do tags that span surfaces live?** `{% quote %}` matters in chat *and* in briefings *and* in memos. Per-surface docs duplicate; one shared doc gets re-loaded in contexts where most of it is irrelevant.
- **How does this interact with [[capability-map]]?** Both are "things the agent could do but might not know to reach for." Probably want one IA pass that produces a coherent answer for both, rather than two parallel solutions.

**The doc-length asymmetry.** *Listing* the vocabulary is short — a single page could enumerate every tag with one-line semantics. What balloons the doc is **selection criteria**: when to reach for `{% quote %}` vs. a plain blockquote, when `<callout>` vs. inline prose, when multi-speaker `<speech diarized>` vs. single voice. Any feature powerful enough to be misused needs that guidance or it goes feral (agent uses it everywhere, or never, or in the wrong situations). So the rule of thumb for keeping the doc compact is: tags with obvious, low-stakes usage can be one line; tags whose value depends on judgment need the judgment written down, which is where pages come from. Implication: when adding a feature, ask "does this need selection criteria?" — if yes, budget for the doc cost upfront; if it's purely additive and hard to misuse (like `redacted`), one line suffices.

For now: `{% redacted %}` is implemented and discoverable via `src/shared/markdoc-config.ts`, but not in any agent-loaded doc. Decision deferred to the IA pass.

## Redacted text (Threads-style spoiler/reveal) — IMPLEMENTED

Implemented as the `{% redacted %}…{% /redacted %}` Markdoc tag (see
`src/shared/markdoc-config.ts`, rendered by `src/frontend/src/components/Redacted.tsx`).
Inline/block split mirrors `quote` / `source`. Rendering: blurred text behind an
animated SVG-turbulence noise overlay (Threads-style fuzz), click/tap or Enter/Space
to reveal. Stays blurred under SSR / no-JS — safe for print. Agent-authored only.
Parser test: `test/shared/markdoc-redacted.doctest.md`.

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

## Color contrast — full WCAG AA audit (deferred)

`bin/tour --all` surfaces ~18 `color-contrast` violations (serious, per
axe-core) across every routed page. Top failing tokens against white
backgrounds:

- `text-warm-500` (#B8A890, ~2.3:1) — used widely as secondary text
- `text-warm-600` (#9B8E7E, ~3.5:1) — borderline; still fails AA
- `text-warm-400` (#D9CEBD, ~1.4:1) — used on the lightest secondary text
- `text-warning` (#D99A2B, ~2.0:1), `text-primary` (#9B6BA6, ~3.7:1)
  and several `-dark` semantic variants — saturated mid-tones that
  fail AA against white.

Not interesting right now; intentionally deferred. Three plausible
fixes when the time comes:

1. **Re-map the warm scale** so warm-500/600 darken into AA-passing
   territory. Single-file palette change; shifts the visual identity
   of every secondary-text surface.
2. **Move text to warm-700+** by sweeping source and reserving 400–600
   for borders/backgrounds (the conventional Tailwind split).
   Many-file change; preserves visual identity.
3. **Bump the semantic `-dark` variants** (warning-dark, primary-dark,
   success-dark) so error/warning/success text passes AA without
   re-tuning the neutral scale.

To re-enable the rule for one tour run: remove `color-contrast` from
`SUPPRESS_RULES` in `callback-box/test/tours/tour-lib/axe.ts`.

When this becomes interesting again, run `bin/tour --all` after
re-enabling and the latest violation inventory will land under
`callback-box/test/tours/.artifacts/<tour>/<runId>/*.axe.json`.
## "Before you build this" — embedding-indexed reuse search

The repeated failure mode: agent is asked for X, agent writes X from scratch, X already existed under a slightly different name in `src/components/ui/` or `src/lib/` or `cardworks/`. The agent doesn't know what to grep for because the existing thing's name doesn't match the task vocabulary. Result: parallel implementations, drift, the codebase gets harder to navigate over time precisely *because* it has more in it.

Idea: an index of available units — UI components, hooks, helpers, schemas, cardworks elements, services — keyed by an embedding of their *purpose* (from JSDoc, the type signature, neighboring usage). The agent, before building anything non-trivial, queries the index with a natural-language description of what it's about to write. The index returns the top few candidates with one-line summaries and file paths. If something fits, the agent reuses; if nothing fits, it proceeds and the index re-embeds the new thing.

Convention to make it stick: a short rule in `CLAUDE.md` ("before writing a new component / helper / schema, run `cb reuse-search 'description'` and consider the candidates") plus a pre-commit nudge when a new file in `src/components/ui/` or `src/lib/` doesn't appear in the index yet.

Open questions: where embeddings live (local Faiss index in `.callback-cache/`? a small server?); how to keep the index from going stale (rebuild on file change vs. on demand); whether the search is a CLI or a tRPC procedure the agent calls; how to surface *what was missed* — false negatives are the painful kind ("the helper existed but the search didn't return it").

## Check out spec-kit

[GitHub: github/spec-kit](https://github.com/github/spec-kit) — a spec-driven-development toolkit from GitHub for building software with AI agents from formal specifications. Worth a read for: how they structure the spec → plan → tasks → implementation pipeline, what they expose to the agent at each phase, whether their patterns map onto how procedures/commands work here.

Probably most relevant for callback-box's procedure engine (the multi-step XML workflows in `config/procedures/`) and for how `cb` commands could be authored — both are spec-then-execute shapes. Not a "port this," more a "see what they got right and steal the bits that fit."

## Doc usage mining — what agents actually open

Claude Code session transcripts live as JSONL at `~/.claude/projects/<encoded-cwd>/*.jsonl`, and every `Read` tool_use carries the file path plus offset/limit. That's free data — no instrumentation needed — describing how the agent actually uses the doc corpus, which is rarely the same as how we *think* it does.

Cross-joined against the doc-graph in `src/dev/doc-graph-html.ts`, the usage data sharpens the picture:

- **High-read + always-loaded** → over-served. The doc is already in context, so re-reads mean the agent either didn't trust the context or couldn't absorb the doc at length. Candidate for trim.
- **High-read + partial-only (offset/limit always set)** → chapter-grazing. The agent only wants section X. Candidate for split — each section becomes its own file, no agent loads the irrelevant 80%.
- **High-read + outer-ring** → mis-classified by the rings. Should be promoted closer to always-loaded, or linked from a nearby `CLAUDE.md` so the agent stops having to discover it.
- **Zero-read + linked prominently** → the link is misleading or the doc is dead weight. Candidate for delete or rewrite.
- **Read-then-edited vs. read-then-ignored** → distinguishes reference docs from working surfaces — useful when deciding what to maintain vs. what to freeze.

Open questions:
- **Noise filtering.** Subagent reads, hook reads, `/clear`'d sessions, exploratory greps — all distort the picture. Weight by session not raw count; filter by tool_use_id provenance; probably ignore sessions under some token threshold.
- **Shape.** Mirror the doc-graph split: a dry `pnpm doc-usage` markdown report for the numbers, plus a fourth section in `doc-graph.html` ("What agents actually open") that overlays the rings/pillars with usage hot-spots.
- **Retention.** Transcripts are local-only and the user can clear them. Aggregate into a small persistent table so the historical signal survives clearing.

## Retrospective session scan — surfacing CLAUDE.md and tool improvements

Closely related to the doc-usage miner: instead of mining transcripts for *what was read*, mine them for *what the user had to correct, what Claude had to ask, what kept going wrong*. The current setup is reactive — `CLAUDE.md` says "when you get corrected, update CLAUDE.md," but that depends on the agent noticing in the moment and on the user remembering to push back. A weekly retrospective sweep would catch the patterns that slip through.

Signal sources in JSONL:

- **User corrections** — "no", "don't", "actually", "wrong", "stop". Many are one-off conversational noise; the same correction appearing across three sessions is a real gap.
- **Repeated tool errors** — same `bash` command fails the same way across sessions → either a missing convention to document or a broken tool to fix (not document around).
- **Clarifying questions Claude asks** — when the agent has to ask "which X?" repeatedly, the answer belongs in a doc. Strong signal because the agent itself is reporting the gap.
- **Long read-cascades for simple questions** — Claude reads 7 files to answer "where does X live?" → missing index entry.
- **Mid-task pivots / apologies** — "ah, it's actually structured differently" → the structure was non-obvious, deserves a one-liner.

Existing overlap: the `fewer-permission-prompts` skill already does the permissions slice (mines repeated Bash/MCP calls and proposes allowlist entries). This would be the docs-and-conventions slice.

The hard part is signal-to-noise. Regex on "no" is useless. Better approach: per session, feed the last ~30 turns to a small classifier prompt — "did the user correct or teach Claude something not in CLAUDE.md? Return a list, or 'nothing'." Cheap, high-signal, and the candidate list goes into a weekly digest the boxholder skims. Not an auto-applier — humans review and accept, like dependabot PRs for documentation. The Claude Code auto-memory system does something analogous for personal preferences across all projects; this'd be the project-scoped equivalent writing to `CLAUDE.md` / `.claude/rules/`.

Open questions:
- **Cost vs. value.** Per-session LLM cost vs. how often the digest actually contains something actionable. Mitigated by running only on sessions over some length and only on new sessions since last run.
- **Where the digest goes.** A markdown file the user reviews? An auto-opened PR with proposed edits? A new card type in the boxholder's own box ("agent learnings")?
- **Coupling with doc-usage data.** A retrospective that says "Claude kept reading docs/X.md without finding the answer" is more actionable than either signal alone — the two miners probably want to share a session-walker.

## Hume.ai for prosody — experiment + annotate

[Hume.ai](https://hume.ai) offers prosody/expression models that go beyond
words — pitch, pacing, emphasis, emotional contour. Two directions worth
prototyping:

- **Listen** — run incoming voice memos through a prosody pass alongside the
  existing transcription. Annotate the resulting transcript card with the
  prosody signal (excited / tentative / rushed / reading-aloud) so downstream
  agents have non-textual context to work with. E.g. "user sounds frustrated"
  could shift how the agent triages the request.
- **Live overlay on the chat input** — while the user is dictating in the
  chat box, render the prosody read live above the input (a small badge
  strip: "tentative", "rushed", color-shifted). Two purposes: (a) helps the
  user see what the system is actually picking up about their delivery
  before they hit send, which is a closed-loop calibration signal that
  doesn't exist today; (b) makes it obvious when the prosody signal would
  shift downstream behavior, so the user can decide whether to redo the
  utterance with a different tone. Lightweight prototype: a small React
  component subscribed to the Hume realtime stream, painted above the
  textarea.
- **Speak** — use Hume's TTS for outbound speech where prosody markup matters
  (briefings, longer narration). Compare against OpenAI TTS on naturalness for
  the kinds of content this system actually produces.

Cheap to try because it's a connector + a couple of card-field additions; no
deep architectural changes. Worth doing as a focused experiment to see whether
the prosody annotations actually steer agent behavior in useful ways, or just
add noise.

## Try Fish Audio S2 as a streaming transcription provider

[Fish Audio S2](https://fish.audio/s2/) is a real-time speech-to-text service
worth evaluating as another option behind the realtime-transcription seam
(alongside the existing Voxtral WS proxy, Deepgram, and the OpenAI
realtime-whisper service). Motivation: realtime Whisper has been stubborn about
**short utterances** — a quick "send message" or a one-word reply can finalize
slowly or get smoothed away — which is exactly where a low-latency streaming
model with a clean partial/final boundary would help. The transcription layer is
already provider-pluggable (config-selected per box), so adding S2 is a WS
client adapter conforming to the same machine contract, not new architecture.

What to actually measure when prototyping: **short-utterance latency and
accuracy** (the failure mode that prompted this), partial-vs-final stability (do
interims thrash?), how cleanly STOP→final resolves (our slow-path keyword send
waits on the final), per-minute cost vs. Deepgram, and whether it offers a
temp-key/browser-direct path or needs a server proxy like Voxtral. File under
"curious how well it works" — a focused bake-off against the current providers
on a handful of real short voice commands, not a commitment to switch.

## Check out aislop — AI-slop pattern scanner

[scanaislop/aislop](https://github.com/scanaislop/aislop) is a code-quality
scanner that lints for patterns commonly left by AI coding agents:
narrative comments, dead code, `as any` casts, unhandled exceptions, etc.
40+ rules across 7 languages, deterministic 0–100 score, autofix or
hand-off-to-agent flows.

Worth a look both as a **tool** (could slot into pre-commit alongside
eslint/oxlint, or run periodically as a quality gauge) and as a **rule
inventory** — even if we don't adopt the binary, the catalog of "things
agents do wrong" maps directly onto what our own personal-vibe-check and
`.claude/rules/` files try to prevent. Reading the rule list could surface
gaps in our own conventions.

Probably most useful as a periodic audit (a la `pnpm lint:knip`) rather
than pre-commit — pre-commit is already busy and these patterns aren't
all hard-block worthy.

## Pandoc templates via Markdoc → Pandoc transcoding

[pandoc-templates.org](https://pandoc-templates.org/) is a curated
collection of typography-conscious Pandoc templates — academic papers,
letters, slides, books — the kind of output Markdown ecosystems
historically struggle to produce. The templates are mature, opinionated,
and tuned for real print/PDF/HTML output.

Switching to Pandoc directly probably isn't worth it: we just put in the
work to standardize on Markdoc (typed body tags, JSX-ish components,
schema-validated frontmatter), and that buys us things Pandoc doesn't
(component-level rendering, structured AST traversal, the same body
model the rest of the system uses). Throwing it out to chase
template aesthetics would be a net loss.

The interesting angle is **transcoding**: ship a Markdoc → Pandoc
transformer for the cases where the output medium genuinely needs
Pandoc's template engine (a printable brief, an exportable PDF, a
slide deck from a guide card). Markdoc stays the authoring + rendering
layer; Pandoc becomes a downstream sink for specific export targets.
The transcoder would be a `cb` subcommand (e.g. `cb export pandoc
<card>`) that walks the Markdoc AST and emits Pandoc-flavored Markdown
or directly the Pandoc JSON AST, then pipes through `pandoc` with one
of these templates selected by export target.

Open questions:
- Which Markdoc components have lossy/lossless Pandoc equivalents?
  Custom Markdoc tags will need either a stripped/textual fallback
  or a per-tag transformer.
- Does anything in the box ecosystem actually need this today, or is
  it a "nice when we want a real PDF" capability that sits unused
  for months? (Honest answer probably the latter — file it but don't
  build it until a real export need shows up.)
- Pandoc adds a runtime dep (the `pandoc` binary). Deploy script
  already installs imagemagick; pandoc would be the same shape of
  add. Cheap.

## Replace procedure run cards with a jsonl record

The 2026-06 hygiene work (no-op suppression, `expires` stamps, `cb procedure gc`) treats `procedure/runs/` as a recent cache — which raises the next question: do per-run XML card files committed to git earn their keep at all? Each materialized run costs a directory, a card, and several bookkeeping commits (`Start procedure`, per-step, `Complete`), and most of what the card records is already structured data that would sit more naturally as an append-only line in something like `.callback-box/procedure-runs.jsonl` (gitignored, size-rotated — same shape as `scheduler.jsonl`). Agent *work* commits would remain; only the engine's bookkeeping would leave git. The `Procedure:`/`Step:` commit trailers already carry run identity in history, so the archival story may not even need the card.

A halfway design keeps the run dir on disk *during* the run — it's the live-run signal for the at-rest gate, and mid-run agents read the run card for context — but never commits it: completion appends the jsonl record and deletes the dir. That would let the whole expires/GC apparatus be deleted again (it was cheap to build; no sunk-cost attachment).

Open questions:
- **Pinning loses its surface.** `expires="never"` works because the run is an editable artifact; with jsonl, retaining an interesting run needs another home (copy the record into a review card? a pinned-runs file?).
- **Payload size.** Run cards hold step stdout and validation/review prose — fine as a card, awkward as a jsonl line. Maybe the line holds a summary + git refs and the prose stays only in commit history.
- **Consumers.** `cb procedure status` and the at-rest gate read run cards today; both have straightforward jsonl/lock-file equivalents, but it's a real migration, and legacy boxes have years of run dirs in history that tooling shouldn't choke on.

## AVIF / WebP for stored images — biggest win on intake

Every re-encode path today emits **JPEG** (or passes PNG through): `src/frontend/src/lib/image-paste.ts` downscales pasted/captured images to JPEG @0.85 (`outputType = isPng ? "image/png" : "image/jpeg"`). Connector intake (gmail attachments, etc.) stores originals as-is — usually JPEG, often *many* per thread. The box already **accepts** `.webp`/`.avif` (LFS + gitignore patterns at `src/core/box.ts:158-159`, mime maps in `commands/create.ts` and `describe-images-helpers.ts`), so storage/serving is ready — nothing *produces* the compact formats. AVIF cuts ~50% over JPEG at similar quality; WebP ~25–30%.

Where it pays off, in order:

- **Bulk connector intake (the real prize).** The paths where lots of images land, usually JPEG. This is server-side, so it needs a real encoder (`sharp`, or a WASM codec) — not the browser canvas. **Posture for long-term box additions: lossless, high-effort.** Anything kept in the box archivally should not take *added* loss, and since intake encoding is a one-time cost the storage savings pay back forever, high compression effort (`sharp`'s `effort`/`quality:{lossless:true}`, `cwebp -z 9`, AVIF `cqLevel`/`speed 0`) is worth the slower encode. The crux is still **convert-in-place vs keep-original-and-derive**: lossless re-encode is reversible *in content* but not bit-for-bit, so true archival safety argues keep-original + derived compressed copy (doubles storage); convert-in-place is fine when the source is already lossy (re-encoding a JPEG losslessly to WebP just stops adding loss). Decide per source.
- **Client encode (paste + camera) — DONE.** A shared `lib/canvas-encode.ts` cascades **AVIF → WebP → JPEG** (feature-detected per session, since `canvas.toBlob` AVIF *encode* support is narrower than WebP's). Used for **photos** by `image-paste.ts` (chat paste/drop, 0.85) and `camera.ts`'s `canvasCapture` (0.85). **PNG sources are kept as lossless PNG** on the client: the canvas only produces *lossy* WebP/AVIF (no lossless flag), so converting a screenshot/line-art PNG would silently degrade it — so **PNG→WebP is explicitly a server-side (lossless) intake job, not a client one.** Two things still produce JPEG/PNG and are deferred to the server step: the camera's high-res `ImageCapture.takePhoto()` (OS-chosen JPEG, format not selectable — re-encoding would add a lossy generation), and PNG pastes (kept lossless). Both should get lossless AVIF/WebP server-side.

Decode/serving is a non-issue — WebP and AVIF are universally supported in current browsers; this is purely an encode-on-the-producer-side question.

Open questions: keep-originals-and-derive vs convert-in-place per source (archival safety vs storage); where the server encoder lives (deploy already installs imagemagick but nothing uses it for this — `sharp` would be the clean dep); a size threshold so tiny images aren't re-encoded; lossless+high-effort encode cost on big intake batches (do it async/off the request path).

## Typed log attachments on cards

A card should be able to carry **typed, append-only logs** as a first-class kind
of attachment — kin to commentary, but *not itself a card*: a raw JSONL event
stream named by its type, e.g. `Learning_Progress.log.jsonl` (the general shape
`<logtype>.log.jsonl`, a log alongside its card the way `<name>.attach/` holds a
card's assets). Each line is one event; the file grows; the **type** declares the
entry shape, the way card schemas declare a card's frontmatter.

The motivating example is that **we already have exactly this shape and just
haven't generalized it**: a chat *session log* is a per-session append-only
`<sessionId>.jsonl` of turn events (`src/cli/lib/session.ts`,
`session-entry.ts`). But it lives outside the box in
`~/.claude/projects/<encoded-cwd>/`, is keyed to a *session*, and is tied to a
card only transiently — the open card rides the URL (`?card=store/chemistry/
learning-plan.md`) and the per-turn `<chat-app>` snapshot, never persisted as a
card-owned artifact (`InteractiveChat-card-hooks.ts`, `chat-session-start.ts`).
So a session that's "about" a learning-plan card leaves no durable, queryable log
*on* that card. The idea inverts that: the log belongs to the card.

Why this is a natural fit, not a new substrate:

- **Storage already exists.** `.jsonl` is already an accepted file type inside
  the `<name>.attach/` scope (raw attachments, `src/shared/attach-path.ts`,
  `asset-manifest.ts`). JSONL appends are git-friendly (line-diffable, no
  rewrite). So the question is *typing + discovery + rendering*, not plumbing.
- **A producer already exists.** The card-activity vocabulary
  (`scrolled`/`navigated`/`explored`/`modified` with free-text detail,
  `src/core/chat-card-activity.ts`) is computed per turn and embedded in the
  snapshot — but never persisted per-card. Persisting it to a card's
  `activity.log.jsonl` after `chatSession.send()` is the obvious first log type:
  a durable "what happened around this card" timeline.

How it differs from the two neighbors it sits between:

- **vs commentary** (`src/schemas/commentary.tsx`): commentary is a *card*
  (frontmatter + Markdoc body), authored by *replace* (the agent rewrites the
  body, anchored with `{% source %}`). A log is a *file*, authored by *append*,
  and is an event stream rather than prose. Same "attached, agent-authorable"
  family; different lifecycle.
- **vs raw attachments**: untyped today (discovered by extension). A log is
  *typed* — a registry of log types (parallel to `cardSchemas[]`) declares each
  type's entry shape so entries validate and a type-specific renderer can show
  them.

Open questions for an eventual plan (don't design here):

- **Naming/placement.** Sibling of the card (`<base>.<logtype>.log.jsonl`) vs
  inside `<base>.attach/`? The attach scope is the natural home (ref resolution,
  manifest, listing all come for free), but a log isn't quite an "asset."
- **Typing mechanism.** A log-type registry (entry schema + validator +
  renderer), mirroring how `cardSchema` + the registry + renderers compose. Are
  entries self-describing, or does the filename's `<logtype>` key the schema?
- **Who appends, and append safety.** Agent, connectors, and the system
  (card-activity) are all producers — concurrent appends need the same lock
  discipline as the rest of the box (`src/lib/file-lock.ts`).
- **Rendering.** A generic timeline/paginated viewer, plus per-type renderers
  (the renderers system is the precedent). How it surfaces on the host card
  alongside attachments/commentary.
- **Unify session logs?** Could a chat session log *be* a typed log attachment of
  the card it's about, rather than a separate `~/.claude/projects` artifact? That
  would close the "session about a card leaves no trace on it" gap directly — but
  it's a bigger move (the SDK owns session-log writing today).

## Image generation for courseware material — text-free + overlay, not baked-in text

Explored whether text-to-image earns a place in courseware (prior art:
`dmccreary/claude-skills` — `verified-infographic-generator`,
`interactive-infographic-overlay`; see `docs/plans/courseware-external-skills-triage.md`).
Parked as too complex to pursue now, but the shape of the answer is worth keeping.

The load-bearing fact: **text-to-image models can't be trusted with text or
numbers** — they confidently garble "+12%" → "+21%", misspell author names, and
render pseudo-text. Everything else follows from that.

Two viable patterns fall out, for different jobs:

1. **Text-free illustration + DOM/SVG label overlay** (the strong courseware
   case). Generate an *unlabeled* illustration, then lay any labels/callouts on
   top as real DOM/SVG with explore/quiz/edit modes. You never hand text to the
   image model, so there's nothing to garble. This is the right path for labeled
   diagrams (anatomy, circuits) and for backgrounds behind interactive figures.
   It would be a new figure *type* (likely a d3/SVG figure), and it implies a
   text-to-image step + an author calibration UX (drag markers, percentage-based
   coords).
2. **Verify → lock → render → audit** (only for fact/data-bearing images). The
   `verified-infographic-generator` pipeline: separate facts from pixels, verify
   every claim against sources, lock a layout spec where each number traces to a
   `source_id`, make exactly one image call with all text embedded verbatim
   ("render exactly, leave out rather than approximate"), then a post-render
   *multimodal* audit re-reads the pixels for drift (regen ≤3×). Heavy, and
   aligned with our cite-sources stance — but we don't really make stat-posters,
   so this is the less likely fit.

What we already have: the generation step is wired — `src/dev/gen-image.ts`
(Gemini 2.5 Flash Image) + `generate-doc-images.ts`. What these skills add is the
discipline *around* the call, not the call itself.

Bias to remember: courseware is interactive-first (p5/three/d3 figures + cited
prose). Generated images are static and lower-value; use them sparingly, mostly
as text-free backgrounds to annotate — not as the teaching surface, and never as
a fact-bearing artifact without the full verify-and-audit tax. Decorative
generated imagery also drifts toward the "AI aesthetic" we avoid.

Open questions if we ever pick this up: does the annotated-illustration figure
type earn its place (needs the overlay renderer + calibration UX)? Is a
text-to-image step something a *box agent* should invoke at all, or stays a
dev-side tool? How does the post-render audit fit our existing screenshot/render
verification for figures?

## Google Drive mounting / file browsing UI

Surfaced by the user-story audit (`docs/plans/user-story-audit-followups.md` D9).
The Drive backend is built but has no driver: `src/webapp/trpc/routers/drive.ts`
exposes `available` (lists spreadsheets), `inspect` (file details — currently
dead, no caller), and `updateConfig` (folder-mount config), but **no UI or CLI
calls `updateConfig`**, and `DriveSection.tsx` documents itself as read-only with
"mounting is done via CLI" — except no such CLI command exists. So configuring
which Drive folders sync to which local paths means hand-editing
`config/connectors/google-drive.json`.

Two ways to give it a driver:
- **`cb drive mount <folder-id-or-url> <local-path>`** (smaller). A CLI command
  that writes the mount into the connector config, mirroring `cb drive add`.
  Lowest-effort; agent- and human-usable; no new UI surface.
- **A folder-browser in `DriveSection.tsx`** (bigger). Browse the Drive tree,
  pick folders, call the existing `updateConfig` mutation. This is the "browse
  and select files is a whole feature" the maintainer flagged — real tree-paging
  UI, the dead `inspect` endpoint finally gets a caller, but a lot more work.

Maintainer hasn't experimented with Drive mounting at all, so this is exploratory
— start with the CLI command if/when there's a real need, promote to UI later.
Resolve the dead `inspect` endpoint as part of whichever path is taken (wire it
up or delete it).

## User-story audit — remaining feature backlog

From the user-story audit (`docs/plans/user-story-audit-followups.md`, bucket D).
The removals, doc fixes, small fixes, and the calendar-conflict (D7) +
ref-normalization (D11) features all landed; these larger features were scoped
but not built. Parked here as the durable backlog (the audit plan doc and the
catalog's old `IAN:` annotations are transient).

### Questions, end-to-end (D1)

The concrete answer-resolution bug is fixed (the form sent a synthesized letter
that the backend stored verbatim; it now sends the option label and
`src/core/commands/answer.ts` resolves the real id). But the maintainer flagged
the questions flow as generally under-baked ("probably a bunch of bugs; a feature
I want but haven't implemented well"). A focused pass — using the user-story
method on just the questions subsystem — would cover: confirm-type (yes/no)
questions rendering as a textarea instead of radios (`QuestionForm.tsx` falls
back to text when there's no `options` array); how triage creates questions and
the option-id scheme; and the answer schema round-trip. Medium.

### Todo multi-state controls (D2) — DONE

`src/frontend/src/components/TodoListView.tsx` now pairs a round pending↔done
checkbox (the common action) with a `⋯` menu exposing all four statuses
(pending/done/cancelled/deferred), so the rarer cancelled/deferred states are
reachable from the UI.

### Procedure validation completion (D5) — mostly DONE

Two of the three landed. `src/core/procedure/engine-phase.ts` now does
**model-judged instruction validation** against the step's git diff (no longer a
pass-by-default stub), and `engine-step.ts` / `engine-run-phase.ts` implement
**`severity: review` auto-retry** — a bounded self-heal that re-invokes the agent
with the failure context (cost-ceiling guarded) and gates the step when it can't
heal. **Remaining:** resumable runs from a failed step — re-entering a procedure
at the failed step rather than re-running the whole thing; not implemented. Small
remainder, no longer "its own plan."

### Retrospective integration (D6) — DONE (procedure, not code)

Integration is intentionally NOT `integrate.ts`. Belief updates are
judgment, not a deterministic transform, so they stay an `<agent>` step in
`templates/procedures/process-retrospective.procedure.card`: the procedure
arranges the inputs (full ledger, current belief cards, pending reports,
target-card candidates) and the agent applies the evidence model, escalates
to question cards where policy requires, finalizes the report, and commits
with a `Retro-Run` trailer. The loop has closed end-to-end on test1 and
edited real belief cards.

The remaining work (done in this pass) was reliability + context, not a new
component: integration now drains the **whole backlog** keyed off the ledger
(previously it keyed off only the latest report via `ls -t | head -1`, so an
observation that landed in an earlier report was stranded behind a newer
run), it's handed the current belief state so it strengthens an existing
belief instead of adding near-duplicates, and the weekly schedule
(`config/schedules/process-retrospective.scheduled-script.card`) is enabled
once a few manual runs are reviewed. Maintainer: "analysis must end with
integration" — it does.

### Asset-manifest completion (D10)

The pre-commit verify hook landed (bucket C). What remains from the original
scope: actual content **deduplication** (claimed but never implemented), an
explicit **attach API/UI** to attach a file to a card, and dropping the
misleading "versioning" language in `docs/asset-manifests.md` (only current
state is tracked, no history). Decide the real scope before building. Medium.

### Deferred: model-switch verification (audit [69])

Mid-conversation model switching (`src/webapp/routes/chat-session-routes.ts`) has
no test coverage and recent "model-picker desync" fixes suggest it was flaky.
It's worth exercising, but a meaningful test needs a real Claude invocation
(drive a session, switch models, confirm context survives) rather than a mock —
so it's a manual verification task, not an automated one. Not started.
