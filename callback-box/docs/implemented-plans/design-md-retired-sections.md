# design.md — retired sections (history)

**Status:** historical — retired 2026-07-04 when `docs/design.md` was split
into `docs/design/` per the rulings in `../plans/design-reconciliation.md`.
These four sections are preserved verbatim; each preamble says why it was
retired. Do not treat any of this as current design.

---

*Retired per the reconciliation mechanical appendix (item 1): cards are YAML
frontmatter + markdown body, not an XML envelope — see
`../cards-as-markdown.md`. Attachments and transcript-plus-original-audio
survived as the attach-scope design (`../asset-manifests.md`).*

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

*Retired per ruling 9 and the mechanical appendix (item 2): the command-card
system was removed; actions flow through reactor jobs + `cb finalize`. The
paperwork/authorization idea did NOT die — it survives as schema
process-fields; see `../design/trust.md`.*

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

*Retired as written: a deferred idea that was never picked up; no ruling
revived it. If it returns, it returns through `../ideas.md` as a fresh
proposal.*

## 10) Untrusted content / hidden content with tokenization

**Status: Deferred** - This will be addressed in a later phase.

The concept: incoming content (like emails) may contain prompt-injection risks or content you don't want agents to see without proper context. The idea is to replace untrusted content with tokens, requiring a sub-agent to explicitly request access with a stated purpose.

This also enables interesting privacy approaches.

---

*Retired as written: a deferred idea that was never picked up; no ruling
revived it. Derived/agent-hidden data still has no designated home.*

## 11) Sidecars and "AI shouldn't look at this" JSON

**Status: Deferred** - Exact implementation to be determined later.

The concept: there are cases where you keep JSON (indexes, embeddings, cached calculations) that agents should not look at directly.

Two types worth distinguishing:

1. **Derivative JSON** - regenerates whenever the source card is edited
2. **Calculated JSON** - persists as state, updated incrementally on changes

This data will live somewhere hidden from agents (location TBD).
