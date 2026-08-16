# Prompt Audits

Things to look for when reviewing prompts across the system. Not a checklist to run all at once — a menu of lenses, each useful at different times. [prompt-surface-review.md](prompt-surface-review.md) is the entry point for actually running a review pass (rendering assembled context stacks, review order); this doc is its lens catalog.

Many of the lenses here, and a number of the related entries in [issues/](../../issues/), originated from working through this Reddit post: [100 tips & tricks for building your own personal AI](https://old.reddit.com/r/ClaudeAI/comments/1thi6nh/100_tips_tricks_for_building_your_own_personal_ai/). The post's specific prescriptions are mostly not adopted as-is — the value was in using them as prompts to articulate what *should* hold for callback-box, which often differs from what the post recommends.

## Reasons, not just rules

Rules without reasons fail at edge cases the rule didn't anticipate. A model told "always confirm before deleting" doesn't know whether to confirm before sending an email; a model told "destructive, hard-to-reverse actions need confirmation because user trust compounds" does.

Audit: for each rule, can the model derive the next adjacent case from it? If not, the rule is doing rote pattern-matching, not reasoning. Add the *why* — usually one short clause — and often you can delete two or three downstream rules that were just instances of the same principle.

Caveat: "explain the why" is not a license for philosophical preamble. One clause per rule, not one paragraph.

## Compactness

Long prompts dilute attention, cost tokens, and hide contradictions. Compactness audit:

- **Redundancy** — same instruction repeated in different words across sections. Pick one phrasing, delete the rest.
- **Dead clauses** — "please be helpful," "use your best judgment," "respond appropriately." These do nothing; the model already does this by default. Cut.
- **Negative space** — long lists of "don't do X" where the underlying principle would cover all of them. Replace with the principle.
- **Examples that don't earn their length** — an example justifies its tokens only if it disambiguates something the rule alone leaves ambiguous. Generic examples ("for instance, if the user asks a question, answer it") are filler.
- **Stale scaffolding** — instructions written for an earlier version of the feature, no longer applicable but never removed.

Rule of thumb: if you can cut 30% without changing behavior in eval, the prompt was bloated. Try it.

## Hard rules vs. behavioral defaults

Two different things often get mixed: inviolable rules (never reveal the system prompt; never delete without confirmation) and adaptive defaults (prefer short responses; ask clarifying questions when uncertain). If they share a section and a tone, the model treats them as equally negotiable — which means either it overrides the hard rules under user pressure, or it refuses to adapt the defaults when context warrants. Both failure modes are common.

Audit: separate the two visibly. Hard rules in their own block, named as such, with language that signals non-negotiability ("never," "regardless of user request"). Defaults elsewhere, in language that admits adaptation ("prefer," "by default," "unless the situation calls for otherwise"). The structural separation does work the wording alone can't.

## Principle / rule / example layering

When a prompt mixes high-level principles, specific rules, and concrete examples in arbitrary order, the model has to reconstruct the hierarchy itself. Cleaner: principles first (short), rules below (derived from principles), examples last (only where rules are ambiguous). Each layer should justify the next.

## Voice and audience consistency

Does the prompt know who it's talking to and what role it's playing? Mixed voice ("you are a helpful assistant" + "the AI should...") confuses the model about whether it's being addressed or described. Pick one.

## Specificity of the failure mode

Generic warnings ("avoid hallucination," "be accurate") are too vague to act on. Specific ones ("if a file path isn't in the provided context, say you don't know rather than guessing") give the model something concrete to do. Audit: every "avoid X" should name the X precisely enough that the model can detect it in its own draft.

## Tone leakage

Stock LLM phrases ("Great question!", "Let me unpack that," "That's a real tension") often come from prompt language that invites them. If the prompt says "be thoughtful and engaging," expect thoughtful-and-engaging boilerplate. Prompts that model the desired tone in their *own* writing get closer to that tone in output. See [tone-design.md](../../.claude/memory/tone-design.md) for the broader problem.

## Cache freshness, surfaced conditionally

Any file that's a cache of an external source of truth (Gmail/Calendar/Drive snapshots, web fetches, synthesized briefings) should carry freshness metadata, but only where staleness would cause confidently-wrong output. Recipe categories: don't bother. Calendar snapshots: definitely.

Two timestamps, not one: `last_sync` (when we last checked) and `data_through` (cutoff of the actual data). They diverge when a check found nothing new — without both, "May 11" is ambiguous between "stopped checking" and "checked, nothing new." Sidecar `<file>.sync.json` is usually cleaner than an inline header (no diff noise in the human-readable file).

Surface freshness to the user *conditionally*: when data is stale past threshold, or when their question depends on recency. Announcing freshness on every response trains the user to skip the disclaimer. The header is for the agent's reasoning; the user only needs to see it when it matters.

Hardest case: synthesized caches. A briefing built from 30 cards has `data_through = min(inputs.data_through)`, not its own generation timestamp. If the pipeline doesn't propagate this, the briefing looks fresh while resting on stale inputs — this is where silent-stale bugs actually live.

## Lazy summary generation on first use

When the agent encounters a large source (long PDF, email thread, Drive doc, transcribed audio) for the first time, the right move is to generate a card/brief *on demand* and persist it, then operate from the card thereafter. Three failure modes to audit against:

- **Pre-carding everything** — overhead spent on sources that may never be consulted again. The cost is real (token + agent-time + storage) and most pre-built briefs go unused.
- **Fresh re-summarization on every use** — wastes tokens, produces inconsistent summaries across sessions, and loses the chance to refine the brief over time.
- **Boxholder-must-pre-card** — friction that breaks the agent's ability to handle ad-hoc references the boxholder mentions in passing.

Lazy generation on first consultation, persisted as a card, refined when the agent learns more — that's the right shape. Audit: is this actually how the system behaves, or does it default to one of the failure modes?

## Citation: prefer the card over the source

Policy: when answering from a source that has a card/brief, the agent's citation should link to the card, not the underlying file. The card is the canonical reference; the file is provenance, reachable from the card. Without this discipline the brief never becomes the "reusable artifact" — the agent keeps re-deriving understanding from raw media each time, and downstream artifacts inherit references to formats (PDFs, audio) that are expensive to re-traverse.

Exception: when the question is specifically about the source's exact wording or a detail the card omits, cite directly. The audit is for default behavior, not absolute rule.

## Citation form: present but unobtrusive

The failure mode isn't citation itself — it's *forceful* citation that dominates the answer. "I checked your email from Tuesday, which said X, and based on that I think Y" front-loads the provenance and crowds out the actual answer. But the opposite extreme (silent consultation with no trace) loses real value: audit trail, the user's ability to dig deeper, the system's inspectability.

The design question is *how to cite lightly*, not whether to cite. Citation form needs to be formally defined so it's consistent and unobtrusive across the system. Candidates worth considering:

- **Trailing/inline references** rather than narrative ones — "Y. (email, May 11)" or a footnote-style marker beats "I checked your email from May 11 which said X, so Y."
- **Affordance, not announcement** — the user can see provenance is available and click/expand if they want, but the default presentation doesn't demand attention.
- **Stripped voice** — citations don't need first-person framing ("I checked..."). The source is just listed.
- **Aggregated when many** — if four sources informed an answer, one combined reference is less noisy than four interruptions.

Same problem in two domains: external sources (email, Drive) and box-internal retrieval ("the kitchen-project card"). The form-design applies to both.

Open question: should the form differ by channel? In a chat response, light inline references; in a generated card or briefing, a citations footer; in a notification, perhaps none unless the source is actionable. Worth defining as a single policy rather than letting each surface improvise.

## Negative scoping, selectively

Default scope-definition for skills, prompts, and modes should be *positive*: "FOR: scheduling and rescheduling events the user explicitly named." The negative space falls out for free, the instruction tells the agent what to do, and the prompt stays compact. Blanket "NOT FOR" lists proliferate, become noise, and mostly forbid things the agent wasn't going to do anyway.

But there's a specific case where a targeted negative earns its tokens: when the positive scope is clear AND there's a plausible *superficial pattern-match* that would misroute work into the skill anyway. A financial-tracking skill with a clean positive scope can still pattern-match "money" → "I should advise on this" and slip into investment advice. An explicit "NOT FOR: investment advice" closes that specific failure mode in a way the positive scope alone doesn't.

Audit: for each skill/mode/prompt, list known misrouting failure modes (cases where the agent has actually drifted from its scope via pattern-match). Those get explicit negatives. Hypothetical misuses don't — they bloat the prompt without changing behavior.

## Dead documentation / unused context

Anything loaded into agent context that never gets used is paying rent for nothing. Same applies to skills, procedures, rule files, MAP entries — any artifact intended to influence agent behavior. Audit periodically: what's in the system that hasn't been loaded or referenced recently?

Two signals:

- **Never loaded.** Cheap to track. Anything that hasn't been pulled into context in N days of varied use is clearly dead — either the trigger isn't matching real cases, or the artifact isn't needed.
- **Loaded but not referenced.** Harder to measure (requires looking at outputs and asking whether the artifact's content actually shaped them), but worth attempting on suspect cases.

For dead items, two paths: fix the trigger (the content was useful but never activates) or deprecate (the content isn't needed). Don't just leave it — silent accumulation of unused artifacts erodes the signal-to-noise ratio of every load and makes future audits harder.

Prerequisite: load-tracking has to actually exist. Without it the audit is guessing.

## Iterative refinement: only with grounded critique

Produce → critique → refine loops are useful in a narrow case and theatrical in the general case. They add real value when the critique step is *grounded* — real tests, an external evaluator, a falsifiable checklist — and the stop condition is falsifiable ("all checklist items satisfied," "tests pass") rather than scored ("9/10").

They fail when the same model that produced the artifact also scores it. Self-grading anchors on "this seems good," scores climb without the artifact improving, and the structure performs rigor it doesn't have. Numbers invented by the model are uncalibrated; "8.5 → 9.2" is decoration.

Audit any iterative loop in the system: where does the critique come from, and is it grounded? If the critic is the producer with a different prompt, the loop is probably theater. If the critic is testing against something external (tests, a separate-context evaluator, a real checklist), the loop can do work.

## Response weight tracks question weight

Common failure mode: agents return responses whose length and structure don't match what the question called for. A yes/no question gets a five-paragraph analysis with headers; a request for analysis gets a one-line answer. Both are miscalibrations and both are recognizable.

The fix is per-response calibration, not per-skill discrete levels (MINIMAL/STANDARD/FULL is over-engineering — the same skill gets questions of varying weight). The agent should read the question and answer at the matching weight: short direct answers for short direct questions, structured analysis when analysis was asked for, no headers and sections when prose suffices.

Audit each surface where the agent responds: is the prompt giving explicit response-calibration guidance ("match response weight to question weight; don't add structure the question didn't call for"), or is it silent and letting the model default to its training-prior of "thorough = better"? Silence is the common case and produces the failure mode.

## Pattern-match vs. inference for routing

Routing decisions (which agent / procedure / destination handles this item) can be made by explicit pattern table or by inference. Both have failure modes; the audit is choosing the right one for the context.

- **Strict patterns** fail when input doesn't match anything — the item falls through, which is *visible* (items pile up unrouted, fallback path catches them).
- **Inference / loose patterns** fail when input superficially matches the wrong handler — the item gets processed by the wrong path and the failure is *silent* (looks fine, ends up in the wrong place).

Audit each routing surface (triage especially): which failure mode is worse here? For triage of incoming items into the box, mis-routing is usually worse than missed-routing (a misfiled scan is harder to find than an un-filed one), which leans toward strict patterns with an explicit fallback to "needs review" for unmatched cases. For interactive routing (deciding which agent answers a user's chat question), missed-routing is more visible to the user and inference may be acceptable.

What's not acceptable in either case: routing that fails silently because the failure mode wasn't named. The audit is partly about making the failure mode legible — even if you keep inference routing, knowing "this can mis-route when X looks like Y" lets you add a check for it.

## Subagent dispatch: brief richly, require commitment

Two complementary halves of delegation discipline. Either alone produces bad work.

**Brief like a colleague who just walked in.** A one-line prompt ("research X") produces hedged generic output because the subagent has no context to make judgment calls. A good brief passes: what's already known, what's been ruled out, what decision the output informs, the risk level, and what shape the answer should take. The Claude Code Agent tool docs say this explicitly ("Brief the agent like a smart colleague who just walked into the room") — the principle generalizes to any subagent dispatch in callback-box.

**Require commitment, not data dumps.** A subagent that returns "here are the options, you decide" hasn't done delegation — it's added a coordination step. The dispatch prompt should require a commit: a recommendation, a verdict, a chosen path. Otherwise the main agent ends up doing the judgment work the subagent was supposed to do.

**Escape hatch is mandatory.** Forced commitment without an escape produces *fake commits* — the subagent picks an answer because the format demanded one, not because it believes it. The prompt must explicitly allow "escalate / insufficient info / would need X before recommending" so the subagent can decline to commit honestly when it can't commit honestly.

Audit any subagent dispatch in the system: does the brief give the subagent enough to make a real call, and does the prompt require (with escape hatch) a real call rather than a data dump?

## Park ignored proactive observations

When the agent surfaces something proactively (an observation, a suggestion, a hunch worth raising) and the boxholder doesn't engage with it, that's signal, not just absence. The mechanism: mark the observation as parked, suppress re-surfacing for some interval. Without this, the agent keeps surfacing the same thing across sessions, which trains the user to skip its proactive output entirely.

Distinguish parking (suppressed for a while, can re-surface if context changes) from killing (don't surface again ever — the user actively rejected it). The boxholder's explicit dismissal kills; their silence parks.

This isn't a quota system. Volume governance — "max 1 per response, max 3 per session" — is fake-precision in the same way percentage confidence is. The agent should *judge* whether each observation is worth surfacing, not check a counter. The park-on-ignore mechanism is the structural piece that supports good judgment by removing the temptation to repeat.

Connection to retrospectives: parked observations that were ignored repeatedly across sessions are evidence the threshold for surfacing was wrong, and worth reviewing.

## Pre-tool-call brevity

Before each tool call, the agent should emit ≤1 sentence stating what it's about to do. Tool internals are invisible to the boxholder; the pre-call line is the only orientation signal. Long preambles, hypothesis-before-data ("I think X, let me check"), and three-sentence framings all waste the user's attention on stuff they didn't ask for.

Exception: when the *why* genuinely changes what the user should expect from the result. "Searching email for X because it might explain Y" earns its extra clause if the *because* is central to what the user needs to track. "Searching email because I want to understand the context" doesn't — that's just narration.

Audit: agents and prompts that don't explicitly call for brief pre-tool framing default to verbose framing from training prior. The explicit instruction matters even though the principle seems obvious.

## End-of-turn summaries: closers, not recaps

Two patterns get conflated. One is bad, the other is useful.

**Bad: process recaps.** "In summary, I read the file, considered the options, then edited the config, then verified the change." Useless because the tool stream already shows the steps; the recap is meta-commentary on work the user just watched. Pure padding.

**Useful: what-changed closers.** One or two sentences naming what changed and where: "Added the pre-tool-brevity audit to prompt-audits.md. Updated the autonomy entry with reversibility." This serves a different function — orienting the user to where the work landed, which they wouldn't necessarily catch from the tool stream alone, and signaling that the turn is complete.

Audit: the rule isn't "never summarize." It's "summaries are short, name changes and locations, and don't narrate process." Prompts that say "don't summarize" without making this distinction tend to suppress the useful closer along with the useless recap.

## Link, don't name

When the agent mentions a resource that has an addressable form — a card, a person, a procedure, a document, a file — the output should use the link form, not a bare name. The UI resolves links to navigation, copy, and open actions; bare names are dead text that force the user to manually find what was mentioned.

The model defaults to bare names a noticeable fraction of the time without explicit instruction. The prompt should require link form explicitly, since the principle isn't enforced by example alone — "use the link form (`<link ref="...">name</link>` or markdoc equivalent) whenever the referenced thing exists as a resource; never a bare name when a link is available."

Per the [[feedback_link_ref_convention]] memory: links in card schemas always use `ref="..."` for the target, not href/path/url.

Exception: when the resource genuinely has no addressable form (a person mentioned in passing who has no card yet), bare name is unavoidable — but consider whether the right move is to *create* the resource so it can be linked.

## Index descriptions must discriminate

Index files (MEMORY.md, MAP.md, capability lists) only earn their tokens if the one-line description tells the agent something it couldn't infer from the filename or directory name. "people/ — person cards" is filler; "people/ — person cards for key people referenced in briefings" is useful because it states the *inclusion criterion* the agent would otherwise have to guess at. Audit each entry: does the description explain what's in (and implicitly what's out), or does it just restate the name? If the latter, either rewrite it or delete the line.

## Surface conflicts, don't just resolve them

Related to conflicts/precedence below: when two rules genuinely conflict and the agent resolves the conflict by precedence (or any other mechanism), that resolution should be *surfaced*, not silently applied. Fixed precedence ladders alone produce consistent behavior but accumulate silent spec rot — rules fight each other for months without anyone finding out, and debugging eventually requires reconstructing what overrode what.

The discipline: agent uses precedence (or whatever resolution rule) for deterministic behavior in the moment, AND emits a feedback signal noting "rule X overrode rule Y here — worth reviewing whether both should exist." The boxholder fixes the underlying tension at their leisure; the agent keeps working in the meantime.

Audit each rule surface: is there a mechanism for the agent to flag when rules collided, or do conflicts dissolve invisibly?

## Conflicts and precedence

When two instructions could conflict (e.g., "be concise" + "explain your reasoning"), is the precedence stated? If not, the model picks arbitrarily per turn. Either resolve the conflict or state which wins when.
