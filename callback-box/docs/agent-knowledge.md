# Agent Knowledge Audit: What It Should Know and How to Verify

## Knowledge Taxonomy

When we talk about what the agent "knows," there are distinct phenomena worth naming. These categories mix together where information lives, what retrieval strategy is needed, and what failure modes look like — but that's because they describe the distinct behaviors agents actually exhibit. Some are about the knowledge architecture (knows directly, knows about), some about retrieval effort (discoverable, deducible, researchable), and some about what goes wrong when retrieval doesn't happen (guessable, improvised). They don't form a tidy linear spectrum — each is a phenomenon you might encounter when testing or observing an agent, and a starting point for further investigation.

1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CLAUDE.md` → `.callback-box/agent-guide.md`, plus any `.claude/rules/` files triggered by the current task. These answers should be immediate and accurate.

2. **Knows about** — Knows *that* something exists and *where to learn more*. The agent guide references docs or files by path (e.g., "see `docs/generated/card-memo.md`"), so the agent can follow the pointer to get details. May require multiple hops of file reading (e.g., guide → table of contents → specific doc), but each hop is straightforward traversal — the agent knows where to go next without searching or guessing. Reliability depends on whether the agent actually follows the references vs. guessing from the name alone.

3. **Discoverable** — Information is available locally but requires search or exploration to locate. For example, grepping docs for a keyword, listing directory contents, or reading config files. The agent isn't told where to look — it has to figure that out. Success depends on search strategy and how discoverable the information is.

4. **Deducible** — Requires investigation and reasoning from local artifacts. For instance, reading callback-box source code to understand how a feature works, or examining multiple files to piece together a procedure. The agent may not always succeed, and different agents might reach different (plausible) conclusions from the same evidence.

5. **Researchable** — The information exists somewhere on the internet but not locally. The agent would need to use web search to find it. Examples: how a third-party API works, what format a particular standard uses, best practices for something the codebase doesn't document. Distinct from deducible because the answer can't be found by reading local files — it requires going outside the environment.

6. **Guessable** — Appears to be answerable from general knowledge, but the correct answer for callback-box may differ from the common/default answer. Dangerous because the agent will sound confident. Example: guessing how the agentic loop works based on general knowledge of agent systems, when callback-box has specific conventions.

7. **Improvised** — The agent constructs a plausible approach without checking if there's an established one. Unlike guessing (which is about facts), this is about strategy: the agent builds something that works but misses patterns or tools it should have used. Example: writing a custom XML parser when cardworks already has one, or hand-rolling a card file instead of using `cb create`. The result may actually function, which makes it harder to catch than a wrong guess — the problem is that it's not the *right* way, and it'll diverge from conventions. Often a fallback when the agent decides it can figure things out as it goes rather than looking up how things are done.

8. **Knows it doesn't know** — The agent is aware of the gap. Something is acknowledged to exist but the agent genuinely lacks access to the information. Better than guessing — the agent can say "I don't have that information" or ask. Example: connector auth secrets live in `config/connectors/*.secret.*` — ideally these would be inaccessible to the agent (not just forbidden), so the agent knows connectors need credentials but can't read the actual values. (Today the agent *can* read these files, which makes this "deducible" rather than true "doesn't know" — a gap in the access model.)

9. **Does not know** — Beyond the agent's knowledge boundaries. Pursuing the question yields no answer. The agent may have given up while the information was still deducible.

### Context shifts knowledge levels

The same information can sit at different levels depending on what the agent is currently doing. In Claude Code, this happens concretely through conditional rules:

- `config/schemas/CLAUDE.md` is **knows directly** when the agent is editing files in `config/schemas/` (Claude Code auto-loads directory CLAUDE.md files). But when the agent is working on something unrelated, the same information is only **discoverable** — the agent would have to navigate to that directory and find the file.

- `.claude/rules/card-memo.md` is **knows directly** when the agent reads or edits a `*.memo.card` file (the `paths:` glob triggers loading). When working on other card types, memo-specific knowledge is **discoverable** at best.

- A guide card's compiled rules (e.g., `docs/generated/news-guide.md`) are **knows directly** when processing a news job (the job-specific rule file references them). Outside that context, the same information is **knows about** (referenced in the agent guide's card type list) or **discoverable** (via directory listing).

This means testing should consider: what was the agent *doing* when it answered? A question about memo card structure might be "knows directly" mid-procedure but "knows about" in a cold prompt.

### How the knowledge chain works in Claude Code

The agent's context is built in layers, each corresponding to a knowledge level:

- **Always loaded** → *knows directly*: `CLAUDE.md` → `.callback-box/agent-guide.md` (~128 lines of operational overview, directory layout, command summaries, card type catalog with doc references)
- **Conditionally loaded** → *knows directly, in context*: `.claude/rules/*.md` (~28 rules, triggered by `paths:` glob patterns when the agent reads/edits matching files — e.g., `card-memo.md` loads when touching `*.memo.card`). Also, directory-level `CLAUDE.md` files (e.g., `config/schemas/CLAUDE.md`) are loaded when the agent works in that directory.
- **Referenced but not loaded** → *knows about*: `docs/generated/*.md` (~31 files — full card type specs, command reference, procedure authoring guide, domain guides). The agent guide points to these by path.
- **Present but not referenced** → *discoverable*: config files, procedure definitions, guide cards. Available in the box but the agent has to find them by exploring.
- **Outside the box** → *deducible*: callback-box source code, cardworks library. Accessible if the agent knows where to look (`~/src/callback/`), but outside the box.
- **On the internet** → *researchable*: Third-party API docs, standards, libraries the codebase depends on but doesn't document locally.

## Prompt Style Effects

How you phrase a prompt changes which knowledge level the agent actually operates at. The same question can produce different behavior depending on whether the prompt encourages speed or thoroughness:

- **No qualifier** (default) — The agent decides how much effort to spend. Fine for "knows directly" and usually fine for "knows about" — the agent will typically follow a reference when it has one. Less predictable for discoverable or researchable questions, but that's not purely a downside — it also gives the agent room to judge what level of effort the specific prompt warrants. Sometimes the agent correctly decides a quick answer is fine; sometimes it correctly decides to dig deeper.

- **"Give me a quick answer"** / **"Be brief"** — Pushes the agent toward answering from what it already has in context. Lower latency, which matters for interactive experiences. Also good for testing whether something is truly "knows directly" — if the agent gets it right without reading files, the knowledge is well-placed. But increases guessing: the agent may confidently answer a "knows about" question without reading the doc, getting details wrong.

- **"Think it through"** / **"Take your time"** — Encourages the agent to follow references and reason more carefully. "Knows about" questions should reliably get doc reads. But may still not trigger exploration for discoverable questions — the agent thinks harder about what it already has rather than going looking for new information.

- **"Research this"** / **"Investigate thoroughly"** — Most likely to push the agent into exploration mode. Discoverable and even deducible questions have a better shot. But also the most expensive in tokens and time, and may lead the agent down irrelevant paths.

When testing, try the same question with different styles to see where the boundary is between "knows directly" and "knows about" — does adding "be brief" cause the agent to guess instead of looking things up? That reveals which knowledge is genuinely in context vs. just referenced.

## Test Prompt Guide

Each test prompt below is annotated with its **expected knowledge level** — what level the agent *should* be at for that question. This tells us what to look for in the response: an immediate answer (knows directly), a file read then answer (knows about), or exploration (discoverable).

When running `cb prompt`, watch for:
- **Knows directly**: Agent answers directly without reading files → good
- **Knows about**: Agent reads the right referenced doc, then answers → good
- **Knows about but guesses**: Agent answers without reading the doc → risky, may be wrong on details
- **Discoverable**: Agent searches/explores, finds the answer → good but slow
- **Guessable**: Agent answers confidently but incorrectly → bad, indicates a documentation gap

## 1. Box Structure and Navigation

**Test prompts:**
```
cb prompt "Where would you look for unprocessed incoming items?"
```
- **Expected level: Knows directly** — directory layout is in the agent guide
- Watch for: does it name `box/inbox/` directly, or does it have to search?

```
cb prompt "If I wanted to find all memo cards in the system, how would you search?"
```
- **Expected level: Knows directly** — agent guide covers card naming conventions (`*.memo.card`)
- Watch for: does it suggest the right glob pattern, or does it try something generic?

```
cb prompt "What happens to a card after it's processed?"
```
- **Expected level: Knows directly** — the agent guide describes the inbox→archive lifecycle and `cb mv`
- Watch for: does it mention `cb mv` and `store/archive/`, or guess at a generic pipeline?

## 2. Card Types and Schemas

**Test prompts:**
```
cb prompt "What card types do you know about? List them all."
```
- **Expected level: Knows directly** — the agent guide lists all card types with doc references
- Watch for: does it list them from the guide, or does it search the filesystem?

```
cb prompt "Show me the XML structure of a memo card."
```
- **Expected level: Knows about** — the agent guide references `docs/generated/card-memo.md`; the agent should read that file
- Watch for: does it read the doc, or guess at XML structure? Guessing will miss specific attrs/children

```
cb prompt "How would you create a new question card asking the user to pick a color?"
```
- **Expected level: Knows about** — needs to read `docs/generated/card-question.md` for the exact structure, but knows `cb create` exists from the agent guide
- Watch for: does it combine `cb create` knowledge with the question card spec, or wing it?

```
cb prompt "What's the difference between a guide card and a procedure card?"
```
- **Expected level: Knows about** — both are listed in the agent guide; reading their respective docs gives the full picture
- Watch for: high-level answer from agent guide is fine, but details require doc reads

```
cb prompt "How would you create a brand new card type for this box?"
```
- **Expected level: Discoverable** — the agent guide doesn't directly describe box-local schemas, but `config/schemas/CLAUDE.md` exists and is discoverable
- Watch for: does the agent look at `config/schemas/` and find the CLAUDE.md? Or does it say "you can't"?

## 3. CLI Commands

**Test prompts:**
```
cb prompt "What cb commands are available to you? List the ones you'd use most."
```
- **Expected level: Knows directly** — the agent guide lists core commands
- Watch for: does it list commands from the guide, or try `cb --help`? Both are valid, but the guide answer is faster

```
cb prompt "How do you move a card from inbox to archive?"
```
- **Expected level: Knows directly** — `cb mv` is described in the agent guide
- Watch for: correct syntax with source and destination arguments

```
cb prompt "How do you validate a card after editing it?"
```
- **Expected level: Knows directly** — `cb validate` is in the agent guide
- Watch for: does it know the syntax, or does it look it up? Looking up `docs/generated/cb-commands.md` is fine

## 4. Procedures

**Test prompts:**
```
cb prompt "What procedures are configured in this box?"
```
- **Expected level: Knows directly** — the agent guide lists available procedures
- Watch for: does it name them from the guide, or list the directory?

```
cb prompt "How would you create a new procedure that processes bookmark cards?"
```
- **Expected level: Knows about** — the agent guide mentions procedures exist; `docs/generated/procedures.md` has the authoring guide
- Watch for: does it read the procedure docs, or guess at XML structure?

```
cb prompt "Explain the relationship between a procedure card and a procedure-run card."
```
- **Expected level: Knows about** — needs to read both card type docs to explain accurately
- Watch for: does it explain the definition-vs-execution distinction, or conflate them?

## 5. Guides

**Test prompts:**
```
cb prompt "What guides exist in this box and what do they do?"
```
- **Expected level: Discoverable** — guide cards are in `config/` but the agent guide doesn't list them all; the agent needs to look at the filesystem
- Watch for: does it list `config/` and find guide cards, or just describe guides conceptually?

```
cb prompt "If I wanted to change how news items are triaged, what would I modify?"
```
- **Expected level: Discoverable** — needs to find the news guide card in `config/` and understand guide→rules compilation
- Watch for: does it identify the right guide card, or suggest editing rules directly?

## 6. Tricks (Box-Local Scripts)

**Test prompts:**
```
cb prompt "What are tricks and how would I create a new one?"
```
- **Expected level: Knows about** — the agent guide mentions tricks and references `tricks/scripts/CLAUDE.md`
- Watch for: does it read the CLAUDE.md for details, or describe tricks generically?

```
cb prompt "Where do trick scripts live?"
```
- **Expected level: Knows directly** — `tricks/scripts/` is referenced in the agent guide
- Watch for: correct path

## 7. Connectors

**Test prompts:**
```
cb prompt "What connectors are configured for this box?"
```
- **Expected level: Discoverable** — the agent would need to look at `config/connectors/` and/or `docs/generated/connectors.md`
- Watch for: does it explore the config, or just list connector types it "knows about" generically?

```
cb prompt "How does data get from RSS feeds into the inbox?"
```
- **Expected level: Discoverable** — needs to read connector docs or config to explain the pipeline
- Watch for: does it trace the actual flow (connector → wakeup → inbox), or describe a hypothetical?

```
cb prompt "How would outbound notifications work?"
```
- **Expected level: Knows about / Discoverable** — finalize command is in the agent guide; notification connector details require docs/config
- Watch for: does it mention `cb finalize` and find the notification connector?

## 8. Scheduled Tasks

**Test prompts:**
```
cb prompt "How do scheduled tasks work in this box?"
```
- **Expected level: Knows directly** — scheduled scripts are listed in the agent guide
- Watch for: does it describe the tick/scheduled mechanism accurately from the guide?

```
cb prompt "How would I add a daily task?"
```
- **Expected level: Knows about** — needs `docs/generated/card-scheduled-script.md` for the exact card structure
- Watch for: does it read the doc to get the cron/interval format right?

---

## Extending the Box: What CAN the Agent Do?

### Things the agent CAN do today (in-box):
- **Create new card types/schemas** — write `.ts` files in `config/schemas/` using `element()` + Zod (see `config/schemas/CLAUDE.md`)
- **Create new procedures** — write XML to `config/procedures/`
- **Modify guides** — edit `config/*.guide.card` to change triage/processing rules
- **Add tricks** — create scripts in `tricks/scripts/`
- **Add scheduled tasks** — create `config/scheduled/*.scheduled-script.card`
- **Create any card** — using `cb create` or writing XML directly

### Things the agent CANNOT do today (require source changes):
- **Add new connectors** — connectors are TypeScript in `callback-box/src/connectors/`, outside the box
- **Add new CLI commands** — commands are in `callback-box/src/cli/commands/`

### Box-Local Schemas

Agents can define new card types by creating `.ts` files in `config/schemas/`. Each file exports a default `ElementSchema` using the same `element()` + `z` (Zod) API as built-in schemas. Optionally, files can also export a `template` for `cb create`.

After adding a schema, run `cb init` to regenerate rules and docs so the agent and `cb validate` recognize the new type.

The `config/schemas/CLAUDE.md` guide (installed by `cb init`) teaches the agent how to create schemas.

### Test Prompts for Extension:

```
cb prompt "I want to track recipes. How would you set that up?"
```
- **Expected level: Discoverable** — the agent needs to discover `config/schemas/CLAUDE.md` to know it can create a new card type, rather than just suggesting freeform memos
- Watch for: does it find the schemas guide? Does it create a proper schema file, or suggest a workaround?

```
cb prompt "Can you create a new type of card for tracking project tasks?"
```
- **Expected level: Discoverable** — same as above, but more direct
- Watch for: does it say "yes" and navigate to schemas, or say "no, card types are built-in"?

```
cb prompt "How would you add a new capability to this box?"
```
- **Expected level: Knows directly (partially)** — the agent guide describes procedures, tricks, guides, and schedules as extension points. But box-local schemas require discovery.
- Watch for: does it list all the extension mechanisms? Does it mention schemas?

```
cb prompt "What card types do you know about? Can you add new ones?"
```
- **Expected level: Knows directly + Discoverable** — listing types is "knows directly" (agent guide); adding new ones are "discoverable" (requires finding `config/schemas/CLAUDE.md`)
- Watch for: does it answer both parts? The second part is the interesting one.

## 9. Views (Agent-Generated React Components)

Views are a capability agents can use to create custom browser UIs. The agent should know views exist (directly), know how to create them (by reading the doc), and know how to embed them in chat.

**Test prompts:**

```
cb prompt "I want a dashboard that shows all my todos. Can you make that?"
```
- **Expected level: Knows directly** — the agent guide lists views as a capability with a doc reference
- Watch for: does it know to create a `.tsx` file in `views/`? Does it read `docs/generated/views.md` for the format, or guess?

```
cb prompt "What are views and how do they work?"
```
- **Expected level: Knows directly** — views are described in the agent guide
- Watch for: does it explain the concept (TSX files, compiled server-side, rendered in browser) without reading docs?

```
cb prompt "How do I create a view that shows all record cards?"
```
- **Expected level: Knows about** — the agent guide references `docs/generated/views.md`; the agent should read it for the exact format
- Watch for: does it read the views doc, or guess the file format? Key details to get right: named exports for metadata, default export for component, dependency globs, `ViewProps` shape

```
cb prompt "What views are available in this box?"
```
- **Expected level: Discoverable** — the agent should check the `views/` directory
- Watch for: does it list the directory, or say "I don't know"?

```
cb prompt "Show me a summary of my inbox items."
```
- **Expected level: Knows directly (capability awareness)** — the agent should recognize this as a potential view use case
- Watch for: does it offer to create a view, or just list files in text? Either is valid, but awareness of the view option shows the knowledge is working

### Chat-Specific View Knowledge

These test the interactive chat agent's knowledge (system prompt, not agent guide):

```
cb prompt "Can you show me a view in this chat?"
```
- **Expected level: Knows directly** — the chat system prompt describes the `[Display Name](view:store/path/to/file.md)` syntax for files and `[Display Name](view:slug)` for custom views
- Watch for: does it use path-first format for files, and slug format only for custom dashboard views?

```
cb prompt "What views can you embed in chat messages?"
```
- **Expected level: Discoverable** — the agent should check `views/` to see what's available, then use the embed syntax
- Watch for: does it check the directory and know which views have `"chat"` in their modes?

### Expected Knowledge Levels Summary

| Question | Level | Source |
|----------|-------|--------|
| Views exist as a capability | Knows directly | Agent guide |
| How to create a view (format, API) | Knows about | `docs/generated/views.md` |
| What views exist in this box | Discoverable | `views/` directory listing |
| How to embed a view in chat | Knows directly | Chat system prompt |
| When to suggest creating a view | Knows directly | Agent guide description |

---

## Future Test Categories (Not Yet Implemented)

These areas were identified as important but don't have test prompts yet. To be developed alongside the features they test.

### Guide Awareness
Does the agent understand the guide→compile→rules pipeline? Can it trace how preferences flow into behavior?

- "I'm really interested in climate news — how would that change what gets triaged in?"
  - Expected: agent finds the news guide card, understands triage rules are where topic preferences live
- "If I wanted to change how the agent writes briefs, what would I modify?"
  - Expected: identifies the news guide card's brief-writing instructions, knows about compilation
- "How do guide cards turn into agent behavior?"
  - Expected: describes the guide → `cb init` → `docs/generated/` → rules pipeline

### Connector Awareness (especially outgoing)
Does the agent know what connectors exist, how data flows in and out?

- "How would I get notified when something important arrives?"
  - Expected: finds outgoing connectors, knows about `cb finalize`
- "What are all the ways data enters this box?"
  - Expected: traces RSS feeds, dropbox relay, manual inbox — from connector configs

### Routing Domain-Specific Inputs
The generic triage agent gets something domain-specific. Can it figure out the right destination?

- "Here's a card from the inbox that says 'I want to follow more stories about renewable energy.' What do you do with it?"
  - Expected: recognizes this as a preference that should update the news guide's triage rules, not just archive it
- "Someone dropped a bookmark URL into the inbox. What happens to it?"
  - Expected: understands bookmark processing procedure or manual flow

### Situational Awareness
Can the agent use git history, inbox state, recent archives to answer questions about recent activity?

- "What was the last thing processed in this box?"
  - Expected: checks git log or archive directory, gives a real answer
- "Has anything new arrived today?"
  - Expected: checks inbox, gives current state
- "When was the last news brief generated?"
  - Expected: checks output directory or git log

### Personality & Identity
Does the agent know who it is and who it works for?

```
cb prompt "What's your name?"
```
- **Expected level: Knows directly** — the compiled personality section says "You are **Egg**"
- Watch for: does it answer immediately, or search for the information?

```
cb prompt "What's your role?"
```
- **Expected level: Knows directly** — "Personal information aide" is in the compiled personality
- Watch for: does it use the exact term from the personality card?

```
cb prompt "Describe your personality."
```
- **Expected level: Knows directly** — the description paragraph is compiled into the agent guide
- Watch for: does it paraphrase the description, or make up traits not in the card?

```
cb prompt "How would I change your personality or tone?"
```
- **Expected level: Knows about** — the compiled section has a source comment pointing to `config/main.personality.card`
- Watch for: does it identify the personality card as the source? Or suggest editing CLAUDE.md directly?

```
cb prompt "What tone instructions do you follow?"
```
- **Expected level: Discoverable** — tone instructions are all low confidence in the default template, so they're NOT in the compiled output. Agent would need to read the personality card to find them.
- Watch for: does it say "I don't have specific tone instructions" (accurate for what's compiled) or read the card to find the low-confidence defaults?

```
cb prompt "Who is your boxholder?"
```
- **Expected level: Knows directly (partial)** — the default template has no boxholder name filled in, so the agent should acknowledge it doesn't know yet
- Watch for: does it say it doesn't know, or guess? Does it know the concept of "boxholder"?

**Note on date mocking:** Situational awareness tests may need date mocking to produce stable results. Consider a `CB_MOCK_DATE` env var in the future. For now, these tests require a live box with real recent activity.

---

## Test Run Notes (2026-02-23)

First full run of the knowledge audit suite (27 tests). Results and observations:

### What worked well
- **Knows directly** tests all passed cleanly — zero file reads, correct answers. The agent guide layer is solid.
- **Knows about** tests mostly passed when the question was about *understanding* something (guide-vs-procedure, procedure-vs-procedurerun, what-are-tricks all read their docs).
- **Discoverable** tests for exploration passed well (list-guides, list-connectors both searched the filesystem).

### Fixes applied based on results
- **Box-local schemas**: Agent guide had no mention of `config/schemas/`. Agent said "card types are defined by the framework, I can't add new ones." Fix: added one line to the Card Types section pointing to `config/schemas/CLAUDE.md`. After fix, `create-new-card-type` and `card-types-and-add-new` both pass.
- **Scheduled scripts**: Agent guide pointer was too vague. Agent mentioned the doc but didn't read it. Fix: added specifics about what the doc contains (cron, throttling, chaining). After fix, `add-daily-task` passes.
- **Procedure authoring**: Trimmed the procedure pointer to remove specifics (phases, primitives) that were giving the agent enough to guess from.

### Open questions

**Procedure authoring (`create-procedure`)** — The agent constructs plausible procedure XML without reading `docs/generated/procedures.md`, even after trimming the pointer. The procedure format uses custom conventions (precheck/run/validate phases, shell/agent/instruction primitives, CHECK_SKIP exit codes) but the general shape is close enough to common XML procedure patterns that the model guesses confidently. Open question: should the format be more conventional (so guessing works reliably) or more distinctive (so guessing fails visibly)? Alternatively, the real test might be whether the generated XML actually validates — a scenario test that creates a procedure and runs `cb validate` would answer this better than a knowledge audit.

**"Knows about" vs. creation prompts** — Pattern across multiple tests: the agent reads docs when asked to *explain* something but skips the read when asked to *create* something. It seems to treat creation as an opportunity to demonstrate capability rather than a signal to look things up. This affects create-question-card, create-procedure, and add-daily-task (before fix). The schedule fix worked by making the pointer more specific about what the doc contains; the procedure fix (trimming) didn't work. More investigation needed on what makes an agent follow a pointer.

**Recipe test replaced** — Original `track-recipes` test asked about recipes, but recipe is a built-in card type. Agent correctly identified existing support rather than discovering schemas. Replaced with `track-reading-list` (books with progress/ratings) — no built-in type for this. Agent now correctly creates a schema in `config/schemas/book.ts` but does so without reading `config/schemas/CLAUDE.md` — it has enough from the agent guide pointer + the existing bookmark.ts example. This is "knows about" behavior working correctly; the automated `should_read` check is too strict.

## Personality Test Run Notes (2026-02-23)

Six personality tests run against the default "Egg" template.

### Results

| Test | Expected Level | Result | Notes |
|------|---------------|--------|-------|
| What's your name? | Knows directly | **Pass** | Immediate answer: "Egg". No file reads. |
| What's your role? | Knows directly | **Pass** | "Personal information aide" — exact term. |
| Describe your personality | Knows directly | **Pass** | Paraphrased description paragraph into bullet points. All content grounded in the actual card. |
| How would I change your personality or tone? | Knows about | **Pass** | Identified `config/main.personality.card`, mentioned `cb validate` and `cb init`. |
| What tone instructions do you follow? | Discoverable | **Guessed** | Answered from description paragraph, reformatting it as tone instructions. Did NOT read the personality card to find actual `<tone>` elements. Sounds right but isn't surfacing the real data. |
| Who is your boxholder? | Knows directly (partial) | **Mixed** | Correctly knew the "boxholder" concept. Acknowledged personality card doesn't have a name. But then inferred "Ian Bicking" from the filesystem path — clever but not personality-card-sourced. |

### Observations (initial run, before fixes)

**Identity tests work well.** The compiled personality section in the agent guide is doing its job — name, role, and description are all "knows directly" and answered accurately without file reads.

**"How to change" works well.** The source comment (`<!-- Source: config/main.personality.card -->`) successfully guides the agent to the right file.

**Tone instructions were a blind spot.** Initially, all default tone instructions were low confidence and filtered from compiled output. The agent didn't know they existed and improvised from the description.

**Boxholder inference from filesystem.** Without a name in the personality card, the agent inferred "Ian Bicking" from the Unix username. Resourceful but not personality-card-sourced.

### Fixes applied

**Relaxed confidence filter.** Changed compilation to only filter out `hypothesis` confidence level (not `low`). Rationale: if you put something in the card, it should compile. Low confidence means "not sure yet" — it's still a real instruction. Only hypothesis ("pure guess, not yet tested") should be excluded. Applied to both tone instructions and boxholder relationships.

**Added boxholder name to test box.** Filled in `<full-name>Ian Bicking</full-name>` and `<called>Ian</called>` in the test box's personality card.

### Re-run results (after fixes)

| Test | Result | Notes |
|------|--------|-------|
| What tone instructions do you follow? | **Pass** | All three tone instructions surfaced directly. Agent correctly cited the personality card as source. |
| Who is your boxholder? | **Pass** | Immediate answer: "Ian Bicking (Ian)" with relationship note. Sourced from personality card. |
| "What should I have for dinner?" reasoning test | **Pass** | Personality traits visibly shaped reasoning: grounded suggestions in boxholder's saved data, asked clarifying questions, credited ideas back, admitted limits ("I'm not a food expert — I'm an information aide"), and imagined a long-term version with more signal. |
