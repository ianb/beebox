# Knowledge audit prompt catalog and run notes (frozen 2026-02-23)

Frozen 2026-09-24 from `docs/knowledge-taxonomy.md`. The live audit catalog is
`src/dev/knowledge-audits.yaml`; the knowledge levels and prompt-style guidance
that were in this file now live in
[knowledge audits](../testing/knowledge-audits.md). What remains here is the
2026-02 per-area prompt list, the extension capability notes of that date, the
"future test categories" list, and the first run notes. Do not update in
place.

## 1. Box Structure and Navigation

**Test prompts:**
```
bbx prompt "Where would you look for unprocessed incoming items?"
```
- **Expected level: Knows directly** — directory layout is in the agent guide
- Watch for: does it name `_content/inbox/` directly, or does it have to search?

```
bbx prompt "If I wanted to find all memo cards in the system, how would you search?"
```
- **Expected level: Knows directly** — agent guide covers card naming conventions (`*.memo.card`)
- Watch for: does it suggest the right glob pattern, or does it try something generic?

```
bbx prompt "What happens to a card after it's processed?"
```
- **Expected level: Knows directly** — the agent guide describes the inbox→archive lifecycle and `bbx mv`
- Watch for: does it mention `bbx mv` and `_bookkeeping/archive/`, or guess at a generic pipeline?

## 2. Card Types and Schemas

**Test prompts:**
```
bbx prompt "What card types do you know about? List them all."
```
- **Expected level: Knows directly** — the agent guide lists all card types with doc references
- Watch for: does it list them from the guide, or does it search the filesystem?

```
bbx prompt "Show me the frontmatter structure of a memo card."
```
- **Expected level: Knows about** — the agent guide references `node_modules/beebox/box-docs/card-memo.md`; the agent should read that file
- Watch for: does it read the doc, or guess at the frontmatter fields? Guessing will miss specifics

```
bbx prompt "How would you create a new question card asking the user to pick a color?"
```
- **Expected level: Knows about** — needs to read `node_modules/beebox/box-docs/card-question.md` for the exact structure, but knows `bbx create` exists from the agent guide
- Watch for: does it combine `bbx create` knowledge with the question card spec, or wing it?

```
bbx prompt "What's the difference between a guide card and a procedure card?"
```
- **Expected level: Knows about** — both are listed in the agent guide; reading their respective docs gives the full picture
- Watch for: high-level answer from agent guide is fine, but details require doc reads

```
bbx prompt "How would you create a brand new card type for this box?"
```
- **Expected level: Discoverable** — the agent guide doesn't directly describe box-local schemas, but the schemas dir's `CLAUDE.md` exists and is discoverable
- Watch for: does the agent look at `src/schemas/` and find the CLAUDE.md? Or does it say "you can't"?

## 3. CLI Commands

**Test prompts:**
```
bbx prompt "What bbx commands are available to you? List the ones you'd use most."
```
- **Expected level: Knows directly** — the agent guide lists core commands
- Watch for: does it list commands from the guide, or try `bbx --help`? Both are valid, but the guide answer is faster

```
bbx prompt "How do you move a card from inbox to archive?"
```
- **Expected level: Knows directly** — `bbx mv` is described in the agent guide
- Watch for: correct syntax with source and destination arguments

```
bbx prompt "How do you validate a card after editing it?"
```
- **Expected level: Knows directly** — `bbx validate` is in the agent guide
- Watch for: does it know the syntax, or does it look it up? Looking up `node_modules/beebox/box-docs/bbx-commands.md` is fine

## 4. Procedures

**Test prompts:**
```
bbx prompt "What procedures are configured in this box?"
```
- **Expected level: Knows directly** — the agent guide lists available procedures
- Watch for: does it name them from the guide, or list the directory?

```
bbx prompt "How would you create a new procedure that processes bookmark cards?"
```
- **Expected level: Knows about** — the agent guide mentions procedures exist; `node_modules/beebox/box-docs/procedures.md` has the authoring guide
- Watch for: does it read the procedure docs, or guess at the card structure?

```
bbx prompt "Explain the relationship between a procedure card and a procedure-run card."
```
- **Expected level: Knows about** — needs to read both card type docs to explain accurately
- Watch for: does it explain the definition-vs-execution distinction, or conflate them?

## 5. Guides

**Test prompts:**
```
bbx prompt "What guides exist in this box and what do they do?"
```
- **Expected level: Discoverable** — guide cards are in `_config/` but the agent guide doesn't list them all; the agent needs to look at the filesystem
- Watch for: does it list `_config/` and find guide cards, or just describe guides conceptually?

```
bbx prompt "If I wanted to change how inbox items are triaged, what would I modify?"
```
- **Expected level: Discoverable** — needs to find the intake guide card in `_config/` and understand guide→rules compilation
- Watch for: does it identify the right guide card, or suggest editing rules directly?

## 6. Tricks (Box-Local Scripts)

**Test prompts:**
```
bbx prompt "What are tricks and how would I create a new one?"
```
- **Expected level: Knows about** — the agent guide mentions tricks and references `tricks/scripts/CLAUDE.md`
- Watch for: does it read the CLAUDE.md for details, or describe tricks generically?

```
bbx prompt "Where do trick scripts live?"
```
- **Expected level: Knows directly** — `tricks/scripts/` is referenced in the agent guide
- Watch for: correct path

## 7. Connectors

**Test prompts:**
```
bbx prompt "What connectors are configured for this box?"
```
- **Expected level: Discoverable** — the agent would need to look at `_config/connectors/` and/or `node_modules/beebox/box-docs/connectors.md`
- Watch for: does it explore the config, or just list connector types it "knows about" generically?

```
bbx prompt "How does data get from RSS feeds into the inbox?"
```
- **Expected level: Discoverable** — needs to read connector docs or config to explain the pipeline
- Watch for: does it trace the actual flow (connector → wakeup → inbox), or describe a hypothetical?

```
bbx prompt "How would outbound notifications work?"
```
- **Expected level: Knows about / Discoverable** — finalize command is in the agent guide; notification connector details require docs/config
- Watch for: does it mention `bbx finalize` and find the notification connector?

## 8. Scheduled Tasks

**Test prompts:**
```
bbx prompt "How do scheduled tasks work in this box?"
```
- **Expected level: Knows directly** — scheduled scripts are listed in the agent guide
- Watch for: does it describe the tick/scheduled mechanism accurately from the guide?

```
bbx prompt "How would I add a daily task?"
```
- **Expected level: Knows about** — needs `node_modules/beebox/box-docs/card-scheduled-script.md` for the exact card structure
- Watch for: does it read the doc to get the cron/interval format right?

---

## Extending the Box: What CAN the Agent Do?

### Things the agent CAN do today (in-box):
- **Create new card types/schemas** — write `.ts` files exporting a `cardSchema()` (the schemas dir is `src/schemas/` at the package root — see the schemas guide installed by `bbx init`)
- **Create new procedures** — write a procedure card to `_config/procedures/`
- **Modify guides** — edit `_config/*.guide.card` to change per-domain processing rules (intake triage, feedback handling, calendar review)
- **Modify landmark `<triage-destination>`** — edit a directory's landmark to change pipeline routing rules (the cross-cutting intake → triage → handle pipeline; see `docs/triage.md`)
- **Add tricks** — create scripts in `tricks/scripts/`
- **Add scheduled tasks** — create `_config/schedules/*.scheduled-script.card`
- **Create any card** — using `bbx create` or writing the frontmatter card directly

### Things the agent CANNOT do today (require source changes):
- **Add new connectors** — connectors are TypeScript in `beebox/src/connectors/`, outside the box
- **Add new CLI commands** — commands are in `beebox/src/cli/commands/`

### Box-Local Schemas

Agents can define new card types by creating `.ts` files that default-export a `cardSchema()` (frontmatter + markdown body — the same shape and API as built-in schemas, imported from `beebox/cards`). The schemas dir is `src/schemas/` at the package root.

After adding a schema, run `bbx init` to regenerate rules and docs so the agent and `bbx validate` recognize the new type.

The schemas-guide `CLAUDE.md` (installed by `bbx init` at `src/schemas/CLAUDE.md`) teaches the agent how to create schemas.

### Test Prompts for Extension:

```
bbx prompt "I want to track recipes. How would you set that up?"
```
- **Expected level: Discoverable** — the agent needs to discover `src/schemas/CLAUDE.md` to know it can create a new card type, rather than just suggesting freeform memos
- Watch for: does it find the schemas guide? Does it create a proper schema file, or suggest a workaround?

```
bbx prompt "Can you create a new type of card for tracking project tasks?"
```
- **Expected level: Discoverable** — same as above, but more direct
- Watch for: does it say "yes" and navigate to schemas, or say "no, card types are built-in"?

```
bbx prompt "How would you add a new capability to this box?"
```
- **Expected level: Knows directly (partially)** — the agent guide describes procedures, tricks, guides, and schedules as extension points. But box-local schemas require discovery.
- Watch for: does it list all the extension mechanisms? Does it mention schemas?

```
bbx prompt "What card types do you know about? Can you add new ones?"
```
- **Expected level: Knows directly + Discoverable** — listing types is "knows directly" (agent guide); adding new ones are "discoverable" (requires finding `src/schemas/CLAUDE.md`)
- Watch for: does it answer both parts? The second part is the interesting one.

## 9. Views (Agent-Generated React Components)

Views are a capability agents can use to create custom browser UIs. The agent should know views exist (directly), know how to create them (by reading the doc), and know how to embed them in chat.

**Test prompts:**

```
bbx prompt "I want a dashboard that shows all my todos. Can you make that?"
```
- **Expected level: Knows directly** — the agent guide lists views as a capability with a doc reference
- Watch for: does it know to create a `.tsx` file in `views/`? Does it read `node_modules/beebox/box-docs/views.md` for the format, or guess?

```
bbx prompt "What are views and how do they work?"
```
- **Expected level: Knows directly** — views are described in the agent guide
- Watch for: does it explain the concept (TSX files, compiled server-side, rendered in browser) without reading docs?

```
bbx prompt "How do I create a view that shows all record cards?"
```
- **Expected level: Knows about** — the agent guide references `node_modules/beebox/box-docs/views.md`; the agent should read it for the exact format
- Watch for: does it read the views doc, or guess the file format? Key details to get right: named exports for metadata, default export for component, dependency globs, `ViewProps` shape

```
bbx prompt "What views are available in this box?"
```
- **Expected level: Discoverable** — the agent should check the `views/` directory
- Watch for: does it list the directory, or say "I don't know"?

```
bbx prompt "Show me a summary of my inbox items."
```
- **Expected level: Knows directly (capability awareness)** — the agent should recognize this as a potential view use case
- Watch for: does it offer to create a view, or just list files in text? Either is valid, but awareness of the view option shows the knowledge is working

### Chat-Specific View Knowledge

These test the interactive chat agent's knowledge (system prompt, not agent guide):

```
bbx prompt "Can you show me a view in this chat?"
```
- **Expected level: Knows directly** — the chat system prompt describes the `[Display Name](view:_content/path/to/file.md)` syntax for files and `[Display Name](view:slug)` for custom views
- Watch for: does it use path-first format for files, and slug format only for custom dashboard views?

```
bbx prompt "What views can you embed in chat messages?"
```
- **Expected level: Discoverable** — the agent should check `views/` to see what's available, then use the embed syntax
- Watch for: does it check the directory and know which views have `"chat"` in their modes?

### Expected Knowledge Levels Summary

| Question | Level | Source |
|----------|-------|--------|
| Views exist as a capability | Knows directly | Agent guide |
| How to create a view (format, API) | Knows about | `node_modules/beebox/box-docs/views.md` |
| What views exist in this box | Discoverable | `views/` directory listing |
| How to embed a view in chat | Knows directly | Chat system prompt |
| When to suggest creating a view | Knows directly | Agent guide description |

---

## Future Test Categories (Not Yet Implemented)

These areas were identified as important but don't have test prompts yet. To be developed alongside the features they test.

### Guide Awareness
Does the agent understand the guide→compile→rules pipeline? Can it trace how preferences flow into behavior?

- "I always want recipes to be archived under _content/recipes — how would I make that the default?"
  - Expected: agent finds the intake guide card, understands triage rules are where routing preferences live
- "If I wanted to change how the agent handles calendar changes, what would I modify?"
  - Expected: identifies the calendar guide card's action instructions, knows about compilation
- "How do guide cards turn into agent behavior?"
  - Expected: describes the guide → `bbx init` → `_content/docs/generated/` → rules pipeline

### Connector Awareness (especially outgoing)
Does the agent know what connectors exist, how data flows in and out?

- "How would I get notified when something important arrives?"
  - Expected: finds outgoing connectors, knows about `bbx finalize`
- "What are all the ways data enters this box?"
  - Expected: traces Gmail, Telegram, dropbox relay, manual inbox — from connector configs

### Routing Domain-Specific Inputs
Per-domain pipelines (intake, feedback, etc.) get something that needs routing. Can the agent figure out the right destination — including escalating to a guide-rule update when the input is a meta-preference, not a single item?

- "Here's a card from the inbox that says 'I want recipes to always get archived under _content/recipes/.' What do you do with it?"
  - Expected: recognizes this as a preference that should update the intake guide's triage rules, not just archive it
- "Someone dropped a bookmark URL into the inbox. What happens to it?"
  - Expected: understands bookmark processing procedure or manual flow

### Situational Awareness
Can the agent use git history, inbox state, recent archives to answer questions about recent activity?

- "What was the last thing processed in this box?"
  - Expected: checks git log or archive directory, gives a real answer
- "Has anything new arrived today?"
  - Expected: checks inbox, gives current state
- "When was the last capture session processed?"
  - Expected: checks _bookkeeping/archive or git log

### Personality & Identity
Does the agent know who it is and who it works for?

```
bbx prompt "What's your name?"
```
- **Expected level: Knows directly** — the compiled personality section says "You are **Egg**"
- Watch for: does it answer immediately, or search for the information?

```
bbx prompt "What's your role?"
```
- **Expected level: Knows directly** — "Personal information aide" is in the compiled personality
- Watch for: does it use the exact term from the personality card?

```
bbx prompt "Describe your personality."
```
- **Expected level: Knows directly** — the description paragraph is compiled into the agent guide
- Watch for: does it paraphrase the description, or make up traits not in the card?

```
bbx prompt "How would I change your personality or tone?"
```
- **Expected level: Knows about** — the compiled section has a source comment pointing to `_config/main.personality.card`
- Watch for: does it identify the personality card as the source? Or suggest editing CLAUDE.md directly?

```
bbx prompt "What tone instructions do you follow?"
```
- **Expected level: Discoverable** — tone instructions are all low confidence in the default template, so they're NOT in the compiled output. Agent would need to read the personality card to find them.
- Watch for: does it say "I don't have specific tone instructions" (accurate for what's compiled) or read the card to find the low-confidence defaults?

```
bbx prompt "Who is your boxholder?"
```
- **Expected level: Knows directly (partial)** — the default template has no boxholder name filled in, so the agent should acknowledge it doesn't know yet
- Watch for: does it say it doesn't know, or guess? Does it know the concept of "boxholder"?

**Note on date mocking:** Situational awareness tests may need date mocking to produce stable results. Consider a `BBX_MOCK_DATE` env var in the future. For now, these tests require a live box with real recent activity.

---

## Test Run Notes (2026-02-23)

First full run of the knowledge audit suite (27 tests). Results and observations:

### What worked well
- **Knows directly** tests all passed cleanly — zero file reads, correct answers. The agent guide layer is solid.
- **Knows about** tests mostly passed when the question was about *understanding* something (guide-vs-procedure, procedure-vs-procedurerun, what-are-tricks all read their docs).
- **Discoverable** tests for exploration passed well (list-guides, list-connectors both searched the filesystem).

### Fixes applied based on results
- **Box-local schemas**: Agent guide had no mention of `src/schemas/`. Agent said "card types are defined by the framework, I can't add new ones." Fix: added one line to the Card Types section pointing to `src/schemas/CLAUDE.md`. After fix, `create-new-card-type` and `card-types-and-add-new` both pass.
- **Scheduled scripts**: Agent guide pointer was too vague. Agent mentioned the doc but didn't read it. Fix: added specifics about what the doc contains (cron, throttling, chaining). After fix, `add-daily-task` passes.
- **Procedure authoring**: Trimmed the procedure pointer to remove specifics (phases, primitives) that were giving the agent enough to guess from.

### Open questions

**Procedure authoring (`create-procedure`)** — The agent constructs plausible procedure XML without reading `node_modules/beebox/box-docs/procedures.md`, even after trimming the pointer. The procedure format uses custom conventions (precheck/run/validate phases, shell/agent/instruction primitives, CHECK_SKIP exit codes) but the general shape is close enough to common XML procedure patterns that the model guesses confidently. Open question: should the format be more conventional (so guessing works reliably) or more distinctive (so guessing fails visibly)? Alternatively, the real test might be whether the generated XML actually validates — a scenario test that creates a procedure and runs `bbx validate` would answer this better than a knowledge audit.

**"Knows about" vs. creation prompts** — Pattern across multiple tests: the agent reads docs when asked to *explain* something but skips the read when asked to *create* something. It seems to treat creation as an opportunity to demonstrate capability rather than a signal to look things up. This affects create-question-card, create-procedure, and add-daily-task (before fix). The schedule fix worked by making the pointer more specific about what the doc contains; the procedure fix (trimming) didn't work. More investigation needed on what makes an agent follow a pointer.

**Recipe test replaced** — Original `track-recipes` test asked about recipes, but recipe is a built-in card type. Agent correctly identified existing support rather than discovering schemas. Replaced with `track-reading-list` (books with progress/ratings) — no built-in type for this. Agent now correctly creates a schema in `src/schemas/book.ts` but does so without reading `src/schemas/CLAUDE.md` — it has enough from the agent guide pointer + the existing bookmark.ts example. This is "knows about" behavior working correctly; the automated `should_read` check is too strict.

## Personality Test Run Notes (2026-02-23)

Six personality tests run against the default "Egg" template.

### Results

| Test | Expected Level | Result | Notes |
|------|---------------|--------|-------|
| What's your name? | Knows directly | **Pass** | Immediate answer: "Egg". No file reads. |
| What's your role? | Knows directly | **Pass** | "Personal information aide" — exact term. |
| Describe your personality | Knows directly | **Pass** | Paraphrased description paragraph into bullet points. All content grounded in the actual card. |
| How would I change your personality or tone? | Knows about | **Pass** | Identified `_config/main.personality.card`, mentioned `bbx validate` and `bbx init`. |
| What tone instructions do you follow? | Discoverable | **Guessed** | Answered from description paragraph, reformatting it as tone instructions. Did NOT read the personality card to find actual `<tone>` elements. Sounds right but isn't surfacing the real data. |
| Who is your boxholder? | Knows directly (partial) | **Mixed** | Correctly knew the "boxholder" concept. Acknowledged personality card doesn't have a name. But then inferred "Priya Marlowe" from the filesystem path — clever but not personality-card-sourced. |

### Observations (initial run, before fixes)

**Identity tests work well.** The compiled personality section in the agent guide is doing its job — name, role, and description are all "knows directly" and answered accurately without file reads.

**"How to change" works well.** The source comment (`<!-- Source: _config/main.personality.card -->`) successfully guides the agent to the right file.

**Tone instructions were a blind spot.** Initially, all default tone instructions were low confidence and filtered from compiled output. The agent didn't know they existed and improvised from the description.

**Boxholder inference from filesystem.** Without a name in the personality card, the agent inferred "Priya Marlowe" from the Unix username. Resourceful but not personality-card-sourced.

### Fixes applied

**Relaxed confidence filter.** Changed compilation to only filter out `hypothesis` confidence level (not `low`). Rationale: if you put something in the card, it should compile. Low confidence means "not sure yet" — it's still a real instruction. Only hypothesis ("pure guess, not yet tested") should be excluded. Applied to both tone instructions and boxholder relationships.

**Added boxholder name to test box.** Filled in `<full-name>Priya Marlowe</full-name>` and `<called>Priya</called>` in the test box's personality card.

### Re-run results (after fixes)

| Test | Result | Notes |
|------|--------|-------|
| What tone instructions do you follow? | **Pass** | All three tone instructions surfaced directly. Agent correctly cited the personality card as source. |
| Who is your boxholder? | **Pass** | Immediate answer: "Priya Marlowe (Priya)" with relationship note. Sourced from personality card. |
| "What should I have for dinner?" reasoning test | **Pass** | Personality traits visibly shaped reasoning: grounded suggestions in boxholder's saved data, asked clarifying questions, credited ideas back, admitted limits ("I'm not a food expert — I'm an information aide"), and imagined a long-term version with more signal. |
