# TELOS and the identity pair — PAI's user-description layer

Sources:
- `$PAI/PAI/USER/TELOS/` — nine source files + `README.md` + generated summary + `CURRENT_STATE/`/`IDEAL_STATE/` dirs
- `$PAI/PAI/USER/PRINCIPAL_IDENTITY.md`, `$PAI/PAI/USER/DA_IDENTITY.md`
- `$PACKS/Telos/` — the skill (workflows: Update, InterviewExtraction, CreateNarrativePoints, WriteReport)

All files ship as sample templates with `(sample)` placeholder entries; `/interview`
(a guided multi-phase interview) replaces them. The templates are unusually good at
*showing the intended shape* — most of the value here is in the per-file footnotes
that tell the model what each file is **for**.

## Why this matters for bbx

bbx's user-description layer (`config/main.personality.card`, guide cards, the
boxholder fields) answers *how should the assistant behave*. TELOS answers *what is
the boxholder trying to do* — and bbx has no representation of that at all. Every
TELOS file footer describes a concrete consumption pattern ("the DA uses this
to…"), which is the right test for whether a context file earns its tokens.

## The file inventory

From `$PAI/PAI/USER/TELOS/README.md`:

> | File | What goes in it |
> |------|------------------|
> | `MISSION.md` | The 1–3 things you're putting your life behind. Big, durable, often unfinishable. |
> | `GOALS.md` | Concrete year-scale goals tied to each mission. SMART-ish; revisited quarterly. |
> | `PROBLEMS.md` | The world-level problems your work is trying to solve (vs. internal challenges). |
> | `STRATEGIES.md` | The plays you've chosen to make progress on the problems. |
> | `NARRATIVES.md` | The story you tell yourself and others about what you're doing and why. |
> | `CHALLENGES.md` | Personal blockers — habits, fears, patterns that get in your way. |
> | `BELIEFS.md` | The opinions and frames you operate from. The DA uses these to read drafts in your voice. |
> | `WISDOM.md` | Lessons you've extracted from experience and want to keep applying. |
> | `BOOKS.md` | Books that shaped you. Useful when the DA picks recommendations or framings. |
> | `PRINCIPAL_TELOS.md` | **Auto-generated summary** of all the above. Loaded into every session via CLAUDE.md. |

Plus `CURRENT_STATE/` and `IDEAL_STATE/` subdirectories — "Where you are right now
across the dimensions of your life — health, finances, relationships, work,
learning" vs. "where you want to be … across the same dimensions."

Entries carry stable short IDs (`M0`, `G1`, `C2`) so other files and the DA can
reference them.

## The distinctions that do real work

These are the definitional moves worth keeping even if the file layout changes.

**Mission vs. goal** (`MISSION.md`):

> Missions are more stable than goals. A goal is done when its ISCs pass; a mission
> keeps going. If your mission list shifts every few months, you're describing goals.
>
> Good missions answer: *if the world had more of X because of you, what would X be?*

**Goal vs. wish** (`GOALS.md` footer):

> *Goals are ISC-bearing (measurable success criteria). "Ship X by date Y" is a goal;
> "be better at X" is a wish. The DA uses this list to prioritize suggestions — if a
> request doesn't serve an active goal, it gets flagged.*

(Note the consumption pattern: goals aren't just displayed, they're a filter on the
assistant's own suggestions. GOALS.md is also sectioned `Active` / `Deferred /
Ongoing` / `Completed This Year` — lifecycle, not just a list.)

**Challenge vs. problem** (`CHALLENGES.md`) — the most distinctive file. Sample
entries show the register:

> - **C0:** (sample) I tend to start more projects than I finish — when something
>   gets hard or boring, a new idea looks more attractive than completing the
>   current one.
> - **C2:** (sample) I optimize small surface-area tasks (inbox, tweaks) when I'm
>   avoiding the one big thing that actually matters this week.
>
> Challenges are different from problems-you're-solving (see PROBLEMS.md).
> Challenges are *about you* — procrastination patterns, energy management,
> emotional triggers, ways you sabotage yourself.
>
> Naming them here gives the DA context to coach against them instead of
> accidentally feeding them.
>
> *The DA uses this to surface moments when you're likely doing a known pattern
> (e.g., stalling on a big task by polishing a small one). Honest inputs here pay
> back enormously.*

This is the user *inviting pushback in writing* — a standing authorization the
assistant can cite when it says "this looks like C2."

**Core vs. provisional beliefs** (`BELIEFS.md`) — a crude, hand-rolled version of
bbx's evidence model:

> ## Provisional Beliefs
>
> - (sample) Generalists win the next decade more than specialists do — provisional,
>   watching this play out.
>
> *Beliefs differ from opinions: a belief frames everything downstream. The DA uses
> these to understand *why* you react certain ways to suggestions. If a
> recommendation conflicts with a core belief, it won't land regardless of how
> logical it is.*

**Wisdom as a tiebreaker** (`WISDOM.md`):

> One line each. Should read like aphorisms you'd write on an index card. Not
> clichés — things you've actually earned by going through something.
>
> *Wisdom entries are a filter the DA runs recommendations through. If your wisdom
> says "ship at 80% and iterate" and an advisor is telling you to wait for 100%,
> the DA knows which to weight more.*

## The compile step

The source files are *not* what loads at session start. `PRINCIPAL_TELOS.md` is an
auto-generated compression (`bun PAI/TOOLS/GenerateTelosSummary.ts`), and *that* is
`@`-imported by CLAUDE.md. Its header:

> Auto-generated from TELOS source files (MISSION, GOALS, PROBLEMS, STRATEGIES,
> NARRATIVES, CHALLENGES, etc). Do not edit manually — rerun
> `bun PAI/TOOLS/GenerateTelosSummary.ts` after updating any TELOS/*.md file.

And its footer states the consumption contract:

> *This file is the DA's compressed view of who you are and what you're trying to
> do. The Algorithm uses it to prioritize, the Advisor uses it to catch drift, and
> every skill uses it to tailor recommendations.*

The summary ends with a section the source files don't have — a distilled steering
hint:

> ## Context Filter
>
> When steering work, bias toward: (sample — what makes this user distinctive when
> the DA is picking between options. Examples: long-horizon thinking, building over
> consuming, open-source over proprietary, depth over breadth).

Same architecture as bbx's agent-guide generation (`src/core/agent-guide/`):
human-editable sources, compiled artifact in context. bbx already has the machinery.

## The identity pair

**`PRINCIPAL_IDENTITY.md`** — who the user is. Structure: Quick Reference
(name/pronunciation/location/timezone/role/focus), Career Essence, Worldview, Key
Positions, Personal Interests, Work Patterns & Communication, Preferences, and a
closing section worth quoting for its last line:

> ## For the DA's Reference
>
> When representing the user or working in their context:
> - (interview — what one sentence summarizes who they are?)
> - (interview — what background or perspective do they bring?)
> - (interview — what are they explicitly NOT?)

**`DA_IDENTITY.md`** — who the assistant is. Name, color, two ElevenLabs voice IDs
(main + a separate "algorithm" narration voice), personality prose, writing-style
prose, relationship framing ("We are peers, not commander/executor"), and — the
part bbx should copy — an explicit autonomy boundary:

> ## Autonomy
>
> **Can initiate:** send_notification, create_reminder, log_learning, routine_checks
> **Must ask:** send_external_message, modify_code_unprompted, financial_action, delete_data, publish_content

bbx enforces this boundary structurally (staged outbound cards, `bbx finalize`,
question cards) but nowhere *states* it where the boxholder can read and edit it.
A `can-initiate` / `must-ask` pair on the personality card would make the policy
legible, and gives retro a place to propose loosening ("you've approved every
calendar-event creation for a month — promote to can-initiate?").

## Mapping onto bbx

Proposed shape — not a new subsystem, an extension of the existing user-description
surface:

1. **A telos card** (e.g. `config/main.telos.card`, sibling of
   `main.personality.card`): sections for missions, active goals (with
   active/deferred/completed lifecycle), challenges, beliefs, wisdom. Entries get
   stable IDs and — this is where bbx improves on PAI — the existing evidence model:
   `source: user-stated | feedback | inferred`, confidence, provenance ref. PAI's
   Core/Provisional belief split collapses into that model naturally.
2. **Interview as the bootstrap, retro as the maintainer.** PAI fills TELOS via a
   one-time `/interview`; nothing in the public release keeps it current. bbx's
   retro is the missing maintenance loop: chat reveals an implicit goal → retro
   proposes an `inferred` entry; behavior contradicts a stated goal or matches a
   stated challenge → escalate as a question card. The same recurrence gating that
   governs personality beliefs applies.
3. **Consumption, not just storage.** Each section should have a stated consumer,
   PAI-footer style: triage can weigh "does this relate to an active goal" when
   prioritizing; chat can cite challenges when pushing back; scheduled reviews
   (weekly/quarterly) can walk the goals list — which also gives bbx's currently
   thin "daily briefing" story a spine. A telos section with no consumer shouldn't
   exist (drop BOOKS/NARRATIVES unless a use appears).
4. **Compile into the agent guide.** Like the personality section, a compressed
   telos digest (the `Context Filter` one-liner idea is good) goes into the
   generated guide; full cards load on demand.

Skip: `CURRENT_STATE/`/`IDEAL_STATE/` life-dimension trees (aspirational scaffolding
with no consuming code in the release), McKinsey-report/dashboard generation
(`$PACKS/Telos/` templates are full Next.js apps), and the `PROBLEMS`/`STRATEGIES`/
`NARRATIVES` distinction unless it proves necessary — missions/goals/challenges/
beliefs/wisdom is already a lot of surface to keep honest.
