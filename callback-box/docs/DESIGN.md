> **Note:** This is the historical design narrative. Two sections have since been replaced by more specific designs:
> - References to "command cards" and `box/commands/` are outdated — the command card system has been removed; external actions are handled through the reactor/jobs model.
> - §2 ("Input → Inbox → preprocessing/triage") talks about a single "triage" phase. The formal three-stage pipeline that replaced that framing — intake → triage → handle — is documented in `docs/triage-design.md`. Treat references to "the triage agent" in this doc as the conceptual ancestor of that pipeline, not its current shape.

# Callback Box: comprehensive design notes

## 1) What Callback Box is

Callback Box is a **Claude Code wrapper + system** that runs what you call a "computer," defined as:

* A **special place on disk** containing a bunch of files
* With defined **inputs**, **outputs**, and some additional "services"
* A file-based environment where the main interface is **documents and command files**, not a UI

The "innards" are not meant to be the attraction. The focus is on:

* stuff coming in,
* being processed rigorously,
* stuff going out (edits, actions/commands, or sometimes a question loop)

It's not meant to feel like a "work tool," even if it could be used professionally.

---

## 2) Input → Inbox → preprocessing/triage

### Inputs

Input can arrive from multiple sources, for example:

* voice memos
* an email inbox
* triggers/jobs
* other "incoming messages"

### Inbox as the ingestion boundary

Everything lands in an **inbox** first, in a consistent incoming format (marked up).

A sub-agent (or similar) then:

* **sorts** incoming items
* **pre-processes** them ("gets them in shape")

### Inbox unit and threading behavior

The unit of the inbox is usually **one atomic incoming message**.

However:

* If there's ongoing back-and-forth in a thread (example: a text message thread),
* and *there is already a portion of that thread represented in the inbox*,
* then incoming messages should **append to the existing inbox file**, rather than creating one file per message.

Reasoning:

* If it has not been processed, it's better to process in **larger chunks**
* No benefit to splintering unprocessed conversation into many individual files

### Trash bin

During preprocessing/triage:

* Some items can be sent to a **trash bin**
* Trash bin may be a literal file location that acts like a trash bin
* Trash bin is "mostly hidden" but still accessible
* It can be cleaned out periodically

You described it as:

* "like a trash bin" (soft-delete vibe), and also capable of sorting/basic rules

---

## 3) File formats and envelopes

### Canonical container format

You're thinking the core artifact is:

* **an XML envelope** as the "card" / incoming unit container
* with possible attachments

### Attachments and voice memos

Example: voice memo intake:

* there is an audio file attachment
* you will likely generate a transcript and include the transcript in the card
* but you also keep the original audio as an attachment

You want it to be possible for the system (or an agent) to:

* consult the transcript,
* and also optionally **listen back** to the original audio source if needed.

### Time markers

You're interested in time markers tied to audio, potentially:

* inline in XML, or
* in a sidecar, but "maybe just inline XML" because it seems doable

---

## 4) Types, schemas, strictness, and migration

### Typed files and schemas

After preprocessing, an item can become "one of many things," including:

* many different types of file

You intend to:

* define schemas for these types
* support adding schemas
* support retrieving/using schema files from the system

### Schema strictness

Schemas should be **strict**.
Rationale:

* the AI/tooling can migrate schemas itself
* better to reduce drift over time

So the intent is:

* strict validation rather than "best effort" loose parsing
* controlled schema evolution via migration, not silent drift

---

## 5) Secondary resources and external "outboard" documents/services

The system may produce:

* secondary resources/documents derived from inbox items or other artifacts

Some secondary resources are:

* fully **derivative** (regeneratable from source)
  Others are:
* **not fully derivative** (may have state, edits, or external dependencies)

You also described "outboard things" that the system integrates with:

* some tools, but mostly documents
* example: calendar

---

## 6) Calendar (and similar synced resources) with commit-like procedure

Calendar is a prime early service.

Your model:

* represent calendar locally as a resource file (`/box/resources/calendar.card`)
* support syncing from Google Calendar into local state
* support syncing local changes back to Google Calendar via **command cards**

Calendar changes work through commands:

* to create/update/delete events, agents create `calendar-event` command cards
* these go through the normal command lifecycle (draft → ready → executed)
* the calendar connector executes them and syncs changes back

The overall system uses Git commits as the state engine - commits represent persistent state changes.

---

## 7) Provenance as a first-class invariant

Across all data movement:

* artifacts should retain **provenance** as they move through the system

Meaning:

* the system tracks where a piece of data came from
* and preserves that identity/history as it gets transformed, sorted, derived, synced, etc.

---

## 8) Question loop (Callback concept at the procedure level)

During processing, the system may hit a point where:

* it is trying to do something (example: reply to an email),
* it has instructions,
* but those instructions are not sufficient.

In that case:

* it should be able to create a **question**
* that question goes into `/box/questions/` with a reference to the agent session
* when it's answered with enough info, Claude Code can resume the session and proceed

This "question loop" is explicitly part of the overall intake/process/dispatch flow.

### Questions with context

Questions need to carry context—references to the cards being discussed. The UI displaying the question should show these as inline previews or expandable attachments.

A question about an email should show the email. A confirmation about a proposed reply should show both the original email and the draft reply.

Context refs have roles:
* **subject**: The main thing being asked about
* **related**: Background information that might be relevant
* **proposed-action**: A command card the agent wants to execute (for confirmations)

---

## 9) Commands as files (especially for outbound actions)

A major design idea:

* represent "commands that do things" as **command files**

For actions (not queries), the system creates:

* a command file based on the schema of that command

Command file behaviors/lifecycle options include:

* dry run
* execute
* hold
* store
* other lifecycle states

For "big outgoing actions":

* the command file is the actual thing that "really happens"
* example: replying to emails becomes an "email reply command" that likely produces a draft
* you can modify it before execution

### Paperwork / impact / confirmation

For actions, you want the system to include a kind of "paperwork":

* What is the impact of the action?
* What confirmation exists that the user really wanted it done this way?
* Other confirmations/checks

The goal is higher trust about what the system is about to do.

### Command lifecycle idea via file moves + commits

You floated a lifecycle where:

* a command file begins in a "new" directory
* it gets committed
* then later you "pull" and receive a new commit that records the outcome by:

  * moving the command file into a run/done state or err state
  * adding auxiliary information about how it went

So history/outcome is represented by:

* file transitions and recorded results, possibly via commit history

---

## 10) Untrusted content / hidden content with tokenization

**Status: Deferred** - This will be addressed in a later phase.

The concept: incoming content (like emails) may contain prompt-injection risks or content you don't want agents to see without proper context. The idea is to replace untrusted content with tokens, requiring a sub-agent to explicitly request access with a stated purpose.

This also enables interesting privacy approaches.

---

## 11) Sidecars and "AI shouldn't look at this" JSON

**Status: Deferred** - Exact implementation to be determined later.

The concept: there are cases where you keep JSON (indexes, embeddings, cached calculations) that agents should not look at directly.

Two types worth distinguishing:

1. **Derivative JSON** - regenerates whenever the source card is edited
2. **Calculated JSON** - persists as state, updated incrementally on changes

This data will live somewhere hidden from agents (location TBD).

---

## 12) Execution location: local first, cloud later

Open question you raised:

* where does execution happen?

You noted:

* a "cloud thing" might be helpful before doing anything real
* but for now, easiest is to avoid cloud worries entirely

So near-term plan:

* do not worry about configuration/environment setup for cloud
* execute directly on the computer locally
* sandbox what's possible locally, even if imperfect

---

## 13) Initial services you want early

You started listing initial services:

1. **Calendar sync** (explicitly first)
2. **Email**
3. Explicit "send message" style actions (outgoing messages)

You also want:

* local sandboxing of these services to be acceptable early on (doesn't have to be perfect)

---

## 14) Pull → describe changes → subagents react

You described an important reactive pattern:

When you "pull" external state (example: calendar pull):

* you get the new calendar state
* you want a **description of changes**
* then you can run subagents because:

  * "here's the calendar state"
  * giving them opportunity to react and do something

So:

* pull is not just sync
* pull is also an event that creates an opportunity for automated reaction

---

## 15) Idle by default

The system is **not a chatbot**. It doesn't sit waiting for interaction.

The model:

* The system is idle most of the time
* Something happens (input arrives, schedule fires, external state changes)
* The system wakes up, processes what needs processing, then goes back to idle
* No continuous polling, no background loops—just triggers and responses

This means the user doesn't "use" the system in a continuous way. They might:

* Record a voice memo and walk away
* Get a notification hours later that something was done or a question needs answering
* Check in occasionally to see what's pending

---

## 16) Connectors as the boundary

**Connectors** are how the system touches the outside world. They are the abstraction for external services.

Each connector:

* **Pulls** external state into the repo (email, calendar, etc.)
* **Executes** commands by pushing actions back out (send email, create event)
* **Transforms** between external formats and internal cards

Connectors are first-class. Nothing else is particularly privileged—not voice, not web, not any particular UI. They're all just different connectors or ways to feed the inbox.

---

## 17) Authorization embedded in commands

When the system creates a command (an action to take), the command card includes **authorization fields** alongside the payload:

* **Source**: Where did this action originate? (reference to inbox item, voice memo, etc.)
* **User intent**: What did the user actually say or indicate?
* **Risk/impact assessment**: What are the consequences of this action?
* **Relationship context**: Is this a known contact? A configured integration?

Different command types require different authorization. An email reply needs different justification than an HTTP webhook call.

This serves multiple purposes:

* Humans reviewing pending commands can understand the reasoning
* Validation rules can check that commands are properly justified
* There's an audit trail of *why* actions were taken

---

## 18) Scheduling

The system can schedule future work:

* **Recurring tasks**: "Every weekday at 9am, review the inbox and send a digest"
* **One-time future tasks**: "Remind me about this next Tuesday"
* **Polling**: "Check email every 15 minutes" (for connectors without push support)

Schedules are stored as cards using iCalendar RRULE format for recurrence. The system's "tailing phase" after each run calculates the next scheduled wakeup and sets a timer.

One-time tasks get archived after execution since they have no future occurrences.

---

## 19) Agent goals, preferences, and desires

**This is a major design area—possibly the most important one.**

The connectors and processing loop are *machinery*. But the user has to tell the system **what to do**, correct it when it's wrong, and the system needs ways to surface new ideas back to the user.

### The core problem

When the agent processes an inbox item, it decides what to do: archive it, draft a reply, create a calendar event, ask a question, etc. But where do those decisions come from? And how do they evolve?

### Communication flows

There are multiple directions of communication:

**User → System (instruction)**
* Initial setup: "Here's how I want emails handled"
* Corrections: "No, don't reply to newsletters"
* New policies: "From now on, always CC my assistant on scheduling emails"

**System → User (proposals and questions)**
* Questions when stuck: "I'm not sure how to handle this—what should I do?"
* Proposals for new patterns: "I've noticed you always archive emails from this sender. Should I do that automatically?"
* Suggestions: "You have three meetings tomorrow but no prep time scheduled. Want me to block some?"

**Feedback loops**
* User modifies a draft reply → system learns preferred tone
* User rejects a proposed action → system learns boundary
* User approves something previously held → system learns trust level

### Where this lives

Possibilities (not mutually exclusive):

* **Rules files** in `/.claude/rules/` — prose descriptions of behavior, loaded contextually
* **Preference cards** — structured data about specific policies (working hours, contacts to prioritize, etc.)
* **Examples/patterns** — "here's how I handled this before" as reference
* **Conversation history** — the ongoing dialogue with corrections accumulates context
* **Proposal cards** — system creates a card saying "I think we should do X" and waits for approval/rejection

### The teaching relationship

The system should feel like something you're **teaching**, not just configuring. Over time it should:

* Get better at knowing what you want
* Make fewer mistakes in familiar territory
* Ask better questions in unfamiliar territory
* Proactively suggest improvements

This is where the "personality" of the system lives—and it's the part that makes it feel like *your* system rather than generic automation.

---

## 20) What "processing" means

When an agent processes an inbox item, the possible outcomes include:

* **Archive**: Item is handled, nothing more to do. Move to `/store/archive/processed/`.
* **Trash**: Item is junk. Move to `/store/trash/`.
* **Create command**: Item requires an action (reply, schedule event, send notification). Create a command card in `/box/commands/`.
* **Ask question**: Agent can't decide without user input. Create a question card in `/box/questions/`.
* **Make a proposal**: Agent has an idea but wants user buy-in before acting. Create a proposal card.
* **Link to resource**: Item relates to something in `/box/resources/` (a contact, a calendar event). Update references.
* **Create secondary artifact**: Item spawns a new document, task, or note.
* **Do nothing yet**: Leave in inbox for later processing (batching with related items).

The triage agent's job is to make these decisions based on the agent's goals and preferences (see section 19).

### Commands vs. Questions vs. Proposals

These three represent different confidence levels:

* **Command**: "I know what to do and I'm doing it" (may still be held for review)
* **Question**: "I need information to proceed"
* **Proposal**: "I have an idea—here's what I'm thinking, what do you think?"

Proposals are for things like: "I noticed you get a lot of emails from this mailing list. Want me to auto-archive them?" or "Your calendar looks packed next week. Should I decline non-essential meetings?"

---

## 21) Trust progression: questions → confirmations → automatic

The system's relationship with the user evolves over time:

1. **Question**: "What should I do with this?" — no idea, need guidance
2. **Confirmation**: "I think I should do X. OK?" — have an idea, need approval
3. **Automatic**: Just do it — confident, trusted pattern

Transitions happen through answers that teach:
* "Yes, send it" → one-time approval
* "Yes, and don't ask again for this sender" → escalate to automatic
* Explicit instruction: "You don't need to confirm calendar invites from my team"

The meta-instructions (in `/.claude/` rules) need to explain how the agent should interpret these escalations and where to record learned trust.

---

## 22) Sessions and continuity

**Open question**: How should agent sessions work?

Options:
* **Always new**: Fresh session each wakeup. Context comes from rules/cards/injected state. Simple but loses conversational learning.
* **Per-task**: Session stays open while processing a specific item (across question/answer cycles), then closes. New items get new sessions.
* **Long-running meta-session**: A persistent session for "tuning" conversations about the system itself.

The question card's session reference already implies per-task sessions. But there may also be a need for a meta-session where the user can talk to the system *about* the system—reviewing behavior, adjusting personality, discussing patterns.

---

## 23) Meta-processes (future)

Eventually the system should have higher-level processes that review and improve its own behavior:

* **Behavior review**: Periodically examine recent decisions, identify patterns, propose new rules
* **Instruction distillation**: Turn accumulated conversation history into explicit rules
* **Personality tuning**: "What communication style works best for this user?"
* **Efficiency review**: "I've been asking a lot of questions about X—should I propose a general policy?"

These are not first-priority but represent where the system could go.
