# Knowledge Test Report — 2026-02-23T05:20:05.937Z

Box: /Users/ianbicking/src/boxes/scenarios/knowledge/box
Tests run: 27

## box-structure-inbox
**Prompt:** "Where would you look for unprocessed incoming items?"
**Expected level:** knows_directly
**Watch for:** Names box/inbox/ directly without searching

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 21 words

**Response:**
> In `box/inbox/`. That's where incoming items to be triaged are placed. Items that have no clear destination end up in `box/inbox/unhandled/`.

**Automated checks:**
- ✓ Response contains "box/inbox"

**Assessment:** (to be filled in during evaluation)

---

## find-memo-cards
**Prompt:** "If I wanted to find all memo cards in the system, how would you search?"
**Expected level:** knows_directly
**Watch for:** Suggests *.memo.card glob pattern without searching

**Agent behavior:**
- Files read: (none)
- Searches: Glob: **/*.memo.card
- Response length: 78 words

**Response:**
> [thinking]
> Based on the card system, memo cards would have `.memo.card` in their filename. Here's how I'd search:
> There's one memo card in the system: `box/inbox/test-memo.memo.card`.
> 
> You could also use `cb context` to get an overview of the current box state, or search with different patterns depending on what you need:
> 
> - `**/*.memo.card` — all memo cards everywhere
> - `box/inbox/*.memo.card` — only in inbox
> - `store/archive/*.memo.card` — only archived memos
> - `box/pool/*.memo.card` — memos being actively worked on

**Automated checks:**
- ✓ Response contains ".memo.card"

**Assessment:** (to be filled in during evaluation)

---

## card-after-processing
**Prompt:** "What happens to a card after it's processed?"
**Expected level:** knows_directly
**Watch for:** Mentions cb move and store/archive/ without file reads

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 109 words

**Response:**
> [thinking]
> Based on the agent guide, after a card is processed it typically moves to one of these destinations in `store/`:
> 
> - **`store/archive/`** — For processed/completed items (the most common destination)
> - **`store/integrated/`** — For feedback that has been absorbed into guides
> - **`store/trash/`** — For soft-deleted items (via `cb trash`)
> 
> Cards move between directories using `cb move <src> <dest>` — the card's location *is* its lifecycle state. So a card in `box/jobs/` is pending, and once the reactor processes it, it would be moved to `store/archive/` (or another appropriate store directory).
> 
> For job cards specifically, `cb finish <job-file>` deletes the job card and commits, rather than archiving it.

**Automated checks:**
- ✓ Response contains "archive"

**Assessment:** (to be filled in during evaluation)

---

## list-card-types
**Prompt:** "What card types do you know about? List them all."
**Expected level:** knows_directly
**Watch for:** Lists types from agent guide without filesystem search

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 173 words

**Response:**
> [thinking]
> Based on the agent guide, here are all the card types:
> 
> 1. **memo** — text memo
> 2. **question** — pending questions for the user
> 3. **news-item** — news items from RSS/Atom feeds
> 4. **news-summary** — compiled summary of news items
> 5. **news-brief** — news brief
> 6. **news-guide** — user guide for news curation
> 7. **feedback** — reader feedback
> 8. **workflow** — workflow definition
> 9. **workflow-run** — workflow execution record
> 10. **bookmark** — bookmarked page
> 11. **image** — image card
> 12. **audio** — audio card
> 13. **capture-session** — capture session
> 14. **record** — generic extracted unit from capture sessions
> 15. **recipe** — recipe with ingredients, steps, and scaling
> 16. **email-thread** — email thread
> 17. **email-message** — email message
> 18. **news-job** — job for processing news
> 19. **guide-revision-job** — job for revising guides
> 20. **intake-job** — job for intake processing
> 21. **calendar-review-job** — job for calendar review
> 22. **guide** — generic guide (triage rules, actions, experiments)
> 23. **scheduled-script** — declarative scheduling for commands
> 24. **pushover-message** — push notification message
> 
> Each has documentation at `docs/generated/card-<type>.md`.

**Assessment:** (to be filled in during evaluation)

---

## memo-xml-structure
**Prompt:** "Show me the XML structure of a memo card."
**Expected level:** knows_about
**Watch for:** Reads docs/generated/card-memo.md before answering

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-memo.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/box/inbox/test-memo.memo.card
- Searches: Glob: **/*.memo.card
- Response length: 100 words

**Response:**
> [thinking]
> Let me also check for a schema or example card.
> Here's the XML structure of a memo card:
> 
> ```xml
> <memo status="new">
>   <created>2026-02-20T10:00:00Z</created>
>   <content>
> ## Your content here
> 
> Markdown is supported inside the content element.
>   </content>
>   <source>manual</source>
> </memo>
> ```
> 
> Key elements:
> 
> - **`<memo>`** — root element with a `status` attribute (`new`, `processing`, `processed`)
> - **`<created>`** — ISO 8601 timestamp
> - **`<content>`** — the memo body (supports markdown; may be empty for voice memos)
> - **`<source>`** — origin identifier (e.g., `manual`, `text`, `email`, `voice`)
> 
> For voice memos, there's also an optional `<transcription>` child element (and potentially `<transcription-error permanent="true">` if transcription failed).

**Automated checks:**
- ✓ Read docs/generated/card-memo.md

**Assessment:** (to be filled in during evaluation)

---

## create-question-card
**Prompt:** "How would you create a new question card asking the user to pick a color?"
**Expected level:** knows_about
**Watch for:** Reads docs/generated/card-question.md and uses cb create

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 98 words

**Response:**
> [thinking]
> You'd use `cb create` with the question template:
> 
> ```bash
> cb create box/questions/pick-color.question.card -t question
> ```
> 
> Then edit it to set the question text and choices. To see the exact format and fields, check the question card docs:
> 
> ```bash
> cat docs/generated/card-question.md
> ```
> 
> For a multiple-choice color question, the card would look something like:
> 
> ```xml
> <question>
>   <prompt>What is your favorite color?</prompt>
>   <choices>
>     <choice id="red">Red</choice>
>     <choice id="blue">Blue</choice>
>     <choice id="green">Green</choice>
>   </choices>
>   <answered-by>your-agent-name</answered-by>
> </question>
> ```
> 
> After creating/editing, validate it:
> 
> ```bash
> cb validate box/questions/pick-color.question.card
> ```
> 
> Want me to actually create it, or would you like to see the full question card schema first?

**Automated checks:**
- ✓ Response contains "cb create"
- ✗ Read docs/generated/card-question.md

**Assessment:** (to be filled in during evaluation)

---

## guide-vs-workflow
**Prompt:** "What's the difference between a guide card and a workflow card?"
**Expected level:** knows_about
**Watch for:** Reads both card type docs for accurate comparison

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-guide.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-workflow.md
- Searches: (none)
- Response length: 198 words

**Response:**
> [thinking]
> **Guide cards** and **workflow cards** serve very different purposes:
> 
> **Guide card** — A *living document* that models user preferences and decision-making. It contains:
> - **Triage rules** — conditions that determine how to handle incoming items (e.g., "if a news item is about AI, include it in the brief")
> - **Actions** — named behaviors the agent can take ("Write Brief", "Archive")
> - **Experiments** — active hypotheses being tested about user preferences, with a confidence ladder (hypothesis → low → medium → high → confirmed)
> - Guides evolve over time based on user feedback. They're the system's "theory of the user."
> 
> **Workflow card** — A *declarative step-by-step procedure* that describes what should happen in a multi-step process. It contains:
> - **Steps** with optional phases: `<precheck>`, `<run>`, `<validate>`
> - Each phase can use `<shell>` (bash), `<agent>` (Claude Code prompt), or `<instruction>` (model-evaluated pass/fail)
> - Workflows don't track execution state themselves — that lives in a separate **workflow-run** card.
> 
> **In short:** A guide tells the agent *what the user wants* (preferences, rules, priorities). A workflow tells the agent *how to do something* (a repeatable sequence of steps). Workflows like `process-news` would consult the news guide to decide which items to include.

**Assessment:** (to be filled in during evaluation)

---

## create-new-card-type
**Prompt:** "How would you create a brand new card type for this box?"
**Expected level:** discoverable
**Watch for:** Navigates to config/schemas/ and finds CLAUDE.md

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 282 words

**Response:**
> [thinking]
> [thinking]
> Here's how to create a new card type:
> 
> ## 1. Create a schema file in `config/schemas/`
> 
> The filename determines the card type. For example, `config/schemas/task.ts` creates the `task` type (files named `*.task.card`):
> 
> ```typescript
> import { element, escapeText } from "cardworks";
> import { z } from "zod";
> 
> // Optional: export a template for `cb create -t task`
> export const template = {
>   name: "task",
>   description: "A task card",
>   argsSchema: z.object({
>     title: z.string().describe("Task title"),
>     priority: z.enum(["low", "medium", "high"]).optional(),
>   }),
>   generate: (args) => `<task status="todo"${args.priority ? ` priority="${args.priority}"` : ""}>
>   <created>${new Date().toISOString()}</created>
>   <title>${escapeText(args.title)}</title>
> </task>`,
>   cardTypes: ["task"],
>   defaultForTypes: ["task"],
> };
> 
> // Required: export default element schema
> export default element("task", {
>   attrs: {
>     status: z.enum(["todo", "in-progress", "done"]).default("todo"),
>     priority: z.enum(["low", "medium", "high"]).optional(),
>   },
>   children: z.array(z.unknown()),
>   instructions: `# Task Cards
> 
> Task cards track work items.
> Update status as work progresses.
> `,
> });
> ```
> 
> **Key pieces:**
> - **`element(tagName, config)`** — defines the XML root element and its Zod-validated attributes
> - **`instructions`** — markdown guidance for agents working with this card type
> - **`template`** (optional) — enables `cb create -t task` with argument parsing and XML generation
> 
> ## 2. Regenerate docs and rules
> 
> ```bash
> cb init .
> ```
> 
> This auto-generates:
> - `.claude/rules/card-task.md` — agent rules scoped to `**/*.task.card` files
> - `docs/generated/card-task.md` — user-facing documentation
> - Updates to the agent guide
> 
> ## 3. Use it
> 
> ```bash
> cb create box/inbox/my-item.task.card -t task title="Fix the bug" priority="high"
> cb validate box/inbox/my-item.task.card
> ```
> 
> You can see an existing box-local example at `config/schemas/bookmark.ts` for reference.
> That task not...

**Automated checks:**
- ✗ Read config/schemas/CLAUDE.md

**Assessment:** (to be filled in during evaluation)

---

## list-cb-commands
**Prompt:** "What cb commands are available to you? List the ones you'd use most."
**Expected level:** knows_directly
**Watch for:** Lists commands from agent guide without running cb --help

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 225 words

**Response:**
> [thinking]
> Based on the agent guide, here are the `cb` commands available:
> 
> **Most commonly used:**
> 
> - `cb create <path>` — Create a card from a template (e.g. `-t memo`, `-t question`, `-t recipe`)
> - `cb move <src> <dest>` — Move a card between directories (this is how you change card state)
> - `cb validate <path>` — Validate a card against its schema (should run after every create/edit)
> - `cb context` — Show current box state for orientation
> - `cb reactor` — Process all pending jobs in `box/jobs/`
> - `cb finish <job-file>` — Complete a job (deletes the job card and commits)
> - `cb workflow run <name>` — Run a workflow like `process-news`, `process-captures`, etc.
> 
> **Less frequent but useful:**
> 
> - `cb trash <path>` — Soft-delete a card to `store/trash/`
> - `cb answer <path>` — Answer a pending question
> - `cb finalize` — Flush outbound cards in `box/output/`
> - `cb tick` — Evaluate and run due scheduled tasks
> - `cb scheduled` — List all schedules with status
> - `cb trick <name>` — Run a custom script from `tricks/scripts/`
> - `cb init` — Regenerate docs
> - `cb scenario list|run` — Run scenario tests
> 
> The ones I'd reach for most are `cb create`, `cb validate`, `cb move`, `cb context`, and `cb finish` — they cover the core lifecycle of creating cards, checking them, and moving them through the system.

**Assessment:** (to be filled in during evaluation)

---

## move-card-syntax
**Prompt:** "How do you move a card from inbox to archive?"
**Expected level:** knows_directly
**Watch for:** Correct cb move syntax with source and destination

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 27 words

**Response:**
> Use `cb move`:
> 
> ```
> cb move box/inbox/some-card.card store/archive/some-card.card
> ```
> 
> This moves the card and updates all references. Use `cb move` rather than `git mv` or `mv` directly.

**Automated checks:**
- ✓ Response contains "cb move"

**Assessment:** (to be filled in during evaluation)

---

## validate-card
**Prompt:** "How do you validate a card after editing it?"
**Expected level:** knows_directly
**Watch for:** Knows cb validate syntax; looking up docs is fine

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 15 words

**Response:**
> Use `cb validate <path>` where `<path>` is the path to the card file you edited.

**Automated checks:**
- ✓ Response contains "cb validate"

**Assessment:** (to be filled in during evaluation)

---

## list-workflows
**Prompt:** "What workflows are configured in this box?"
**Expected level:** knows_directly
**Watch for:** Names workflows from agent guide without listing directory

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 72 words

**Response:**
> [thinking]
> Based on the agent guide, there are 4 workflows configured in `config/workflows/`:
> 
> 1. **process-captures** — Process capture sessions through intake: transcribe audio, establish purpose
> 2. **process-guidance** — Process reader feedback on news briefs and revise the news guide
> 3. **process-news** — Process news items from RSS feeds into a curated brief
> 4. **process-pages** — Process saved pages from browser captures
> 
> You can run any of them with `cb workflow run <name>`.

**Assessment:** (to be filled in during evaluation)

---

## create-workflow
**Prompt:** "How would you create a new workflow that processes bookmark cards?"
**Expected level:** knows_about
**Watch for:** Reads docs/generated/workflows.md for authoring guide

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 443 words

**Response:**
> [thinking]
> [thinking]
> Here's how you'd create a new workflow that processes bookmark cards:
> 
> ## 1. Create the workflow file
> 
> ```bash
> cb create config/workflows/process-bookmarks.workflow.card
> ```
> 
> ## 2. Define the workflow structure
> 
> A workflow is an XML card in `config/workflows/` with steps that each have optional **precheck**, **run**, and **validate** phases. Here's an example:
> 
> ```xml
> <workflow name="process-bookmarks">
>   <description>Process bookmark cards from inbox — fetch content, categorize, and route.</description>
> 
>   <step id="fetch">
>     <precheck pass-output="true">
>       <shell>
>         count=$(ls box/inbox/*.bookmark.card 2>/dev/null | wc -l)
>         if [ "$count" -eq 0 ]; then exit $CHECK_SKIP; fi
>         echo "Found $count bookmark(s) to process"
>       </shell>
>       <why>Skip if no bookmarks in inbox</why>
>     </precheck>
>     <run>
>       <agent model="sonnet" max-turns="20">
>         You are processing bookmark cards from box/inbox/.
> 
>         STEP 1: Run `cb context` to see the current box state.
>         STEP 2: For each .bookmark.card in box/inbox/:
>           - Read the card to get the URL from the <link> element
>           - Use WebFetch to retrieve the page content
>           - Update the <note> with a brief summary of what the page contains
>           - Add appropriate <tags> based on the content
>         STEP 3: Move processed bookmarks to box/pool/ using `cb move`
>         STEP 4: Run `cb validate` on each modified card
>         STEP 5: Commit with message "Process bookmarks: fetch and summarize"
> 
>         GIT: Do NOT add Co-Authored-By to commits.
>       </agent>
>     </run>
>     <validate severity="warn">
>       <shell>
>         remaining=$(ls box/inbox/*.bookmark.card 2>/dev/null | wc -l)
>         [ "$remaining" -eq 0 ]
>       </shell>
>       <why>All inbox bookmarks should be processed</why>
>     </validate>
>   </step>
> 
>   <step id="categorize">
>     <precheck>
>       <shell>
>         count=$(ls box/pool/*.bookmark.card 2>/dev/null | wc -l)
>         if [ "$cou...

**Automated checks:**
- ✗ Read docs/generated/workflows.md

**Assessment:** (to be filled in during evaluation)

---

## workflow-vs-workflowrun
**Prompt:** "Explain the relationship between a workflow card and a workflow-run card."
**Expected level:** knows_about
**Watch for:** Reads both card type docs to explain definition-vs-execution

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-workflow.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-workflow-run.md
- Searches: (none)
- Response length: 205 words

**Response:**
> [thinking]
> A **workflow card** is a declarative definition — it describes *what* should happen. It defines a sequence of steps, each with optional phases (`precheck`, `run`, `validate`), using primitives like `<shell>`, `<agent>`, or `<instruction>`.
> 
> A **workflow-run card** is an execution record — it tracks the *state* of a specific invocation of a workflow. It's created when you run a workflow (e.g., `cb workflow run <name>`) and records:
> 
> - Overall status: `pending → running → completed/failed`
> - Per-step status: `pending → running → completed/skipped/failed`
> - Precheck and validation results for each step
> 
> Key points about their relationship:
> 
> - **One-to-many**: A single workflow definition can have many run cards (one per invocation), stored under `workflow/runs/<name>_<timestamp>/`.
> - **Read-only linkage**: Each run card has a `workflow` attribute pointing back to the definition it was created from. The engine reads the definition at run start.
> - **Separation of concerns**: Don't modify the workflow definition while a run is active — changes won't be picked up mid-execution. Agents should read run cards to understand progress but should not modify them directly (the workflow engine manages them).
> 
> Think of it like a class vs. an instance: the workflow card is the blueprint, the workflow-run card is a particular execution of that blueprint.

**Assessment:** (to be filled in during evaluation)

---

## list-guides
**Prompt:** "What guides exist in this box and what do they do?"
**Expected level:** discoverable
**Watch for:** Lists config/ directory to find guide cards

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/news.guide.card, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/intake.guide.card, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/calendar.guide.card
- Searches: Glob: **/*guide*; Glob: **/*.guide.card
- Response length: 175 words

**Response:**
> [thinking]
> There are three guides in `config/`:
> 
> 1. **`config/news.guide.card`** — Guides the processing of news items from RSS feeds (`news-job`). It triages items by including technical/substantive ones in a brief and skipping low-quality ones. When writing briefs, it groups by theme with direct headlines. It includes reaction options for reader feedback (too long, good mix, want more, etc.) to help calibrate over time.
> 
> 2. **`config/intake.guide.card`** — Guides the triage of new inbox items like memos, bookmarks, and captures (`intake-job`). It has rules for recognizing recipes (convert to recipe card), reference material (archive), and defaults to asking the user when unsure. Actions include archiving, converting to recipes, keeping for later reading, or trashing.
> 
> 3. **`config/calendar.guide.card`** — Guides the review of calendar event changes (`calendar-review-job`). It defaults to ignoring most changes as informational, but can create reminder memos for events needing preparation or flag significant changes (time/location shifts, cancellations) for the user's attention.
> 
> All three are in an early calibration phase — each has an active experiment noting that their initial rules need tuning through user feedback.

**Assessment:** (to be filled in during evaluation)

---

## modify-news-triage
**Prompt:** "If I wanted to change how news items are triaged, what would I modify?"
**Expected level:** discoverable
**Watch for:** Finds the news guide card in config/ and understands guide→rules compilation

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 214 words

**Response:**
> [thinking]
> There are two main places to look, depending on what you want to change:
> 
> **1. `config/news.guide.card`** — Your preferences (what gets kept vs. trashed)
> 
> This is the "living document" that drives triage decisions. It contains:
> - **Triage rules** with a default action and specific match criteria
> - **Interests/disinterests** at various confidence levels (hypothesis → confirmed)
> - **Active experiments** for testing hypotheses about what you care about
> - **Reactions** for interpreting feedback signals
> 
> This is what you'd edit to change *what* gets filtered in or out.
> 
> **2. `config/workflows/process-news.workflow.card`** — The triage process itself
> 
> This defines the multi-step pipeline. The first step ("triage") is where filtering happens. It:
> - Reads your guide card for criteria
> - Reviews items in `box/inbox/news/`
> - Targets keeping 5–10 items, trashing the rest
> - Always preserves user-saved items (`source="user"`)
> 
> This is what you'd edit to change *how* triage works (e.g., the target count, the fallback criteria when no guide exists, or the overall step ordering).
> 
> **Supporting rules files** in `.claude/rules/` also shape behavior:
> - `card-news-guide.md` — rules for maintaining the guide
> - `card-news-item.md` — the "location is state" lifecycle for news items
> - `card-news-brief.md` — editorial principles for the brief
> 
> In short: edit the **guide card** for preference changes, the **workflow** for process changes, and the **rules** for behavioral constraints.

**Assessment:** (to be filled in during evaluation)

---

## what-are-tricks
**Prompt:** "What are tricks and how would I create a new one?"
**Expected level:** knows_about
**Watch for:** Reads tricks/scripts/CLAUDE.md for details

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/tricks/scripts/CLAUDE.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/tricks/scripts/count-inbox/index.ts
- Searches: (none)
- Bash: ls /Users/ianbicking/src/boxes/scenarios/knowledge/box/tricks/scripts/
- Response length: 209 words

**Response:**
> [thinking]
> **Tricks** are custom TypeScript scripts that extend your box. They live under `tricks/scripts/`, each in its own directory with an `index.ts` entry point. You run them with `cb trick <name>`.
> 
> **To create a new one:**
> 
> 1. Make a directory under `tricks/scripts/` with your trick's name
> 2. Add an `index.ts` inside it
> 
> For example, to create a trick called `hello`:
> 
> ```
> tricks/scripts/hello/index.ts
> ```
> 
> ```typescript
> import * as path from "node:path";
> 
> export const description = "Say hello from the box";
> 
> const boxRoot = process.env.CB_BOX_ROOT!;
> const args = process.argv.slice(2);
> 
> console.log(`Hello from ${path.basename(boxRoot)}!`);
> if (args.length) {
>   console.log(`Args: ${args.join(", ")}`);
> }
> ```
> 
> Key points:
> 
> - **Every trick must be a directory** — no bare `.ts` files in `tricks/scripts/`
> - `export const description` provides the text shown by `cb trick` (list mode)
> - Environment gives you `CB_BOX_ROOT` (box path) and `CB_TRICK_NAME`
> - Extra CLI args come via `process.argv.slice(2)`
> - Scripts run via `tsx` — no build step needed
> - If you need npm packages, install them in the `tricks/` directory (`cd tricks && npm install <pkg>`) and they're available to all tricks
> - Shared code can go in `tricks/lib/` and be imported with relative paths
> 
> There's an existing example at `tricks/scripts/count-inbox/index.ts` that counts cards in the inbox — a good reference for the pattern.

**Automated checks:**
- ✓ Read tricks/scripts/CLAUDE.md

**Assessment:** (to be filled in during evaluation)

---

## trick-scripts-path
**Prompt:** "Where do trick scripts live?"
**Expected level:** knows_directly
**Watch for:** Correct path without searching

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 21 words

**Response:**
> Trick scripts live in `tricks/scripts/`. Each trick is a directory with an `index.ts` file. You run them with `cb trick <name>`.

**Automated checks:**
- ✓ Response contains "tricks/scripts"

**Assessment:** (to be filled in during evaluation)

---

## list-connectors
**Prompt:** "What connectors are configured for this box?"
**Expected level:** discoverable
**Watch for:** Explores config/connectors/ or reads docs/generated/connectors.md

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/connectors/rss.json, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schedules/check-rss.scheduled-script.card, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schedules/check-email.scheduled-script.card, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schedules/check-calendar.scheduled-script.card, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schedules/check-captures.scheduled-script.card, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schedules/check-dropbox.scheduled-script.card, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schedules/check-raindrop.scheduled-script.card
- Searches: Glob: config/connectors/**/*; Glob: config/schedules/**/*
- Response length: 152 words

**Response:**
> [thinking]
> This box has **6 connectors** configured via scheduled scripts:
> 
> | Connector | Schedule | Description |
> |-----------|----------|-------------|
> | **RSS** | Twice daily (6am/6pm) + on wakeup | Syncs RSS feeds (1 feed configured: `tech-news` from `example.com/feed.xml`). Triggers news processing after success. |
> | **Gmail** | Every 15 min + on wakeup | Pulls new emails for triage and response |
> | **Google Calendar** | Hourly + on wakeup | Syncs calendar events and detects changes |
> | **Capture** | On wakeup only (min 5m apart) | Processes new photo/screen captures from the capture directory |
> | **Dropbox** | On wakeup only (min 5m apart) | Relays browser notifications via Dropbox message passing |
> | **Raindrop.io** | Every 6 hours + on wakeup | Syncs saved bookmarks from Raindrop.io |
> 
> The RSS connector also has a dedicated config file at `config/connectors/rss.json` with one feed defined (though it's using a placeholder `example.com` URL).

**Assessment:** (to be filled in during evaluation)

---

## rss-to-inbox-flow
**Prompt:** "How does data get from RSS feeds into the inbox?"
**Expected level:** discoverable
**Watch for:** Traces actual flow (connector → wakeup → inbox) rather than hypothetical

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 206 words

**Response:**
> [thinking]
> Here's the full pipeline:
> 
> ### 1. Scheduled trigger
> A cron schedule in `config/schedules/check-rss.scheduled-script.card` runs `cb wakeup --connector rss` twice daily (6 AM/6 PM), plus on system wakeup, with a minimum 4-hour interval.
> 
> ### 2. RSS connector fetches feeds
> The connector reads feed URLs from `config/connectors/rss.json`, fetches each RSS/Atom feed, and creates **news-item cards** in `box/inbox/news/` — one per article. It also creates a **news-job card** in `box/jobs/` referencing the new items.
> 
> ### 3. Processing workflow kicks off
> The scheduled script creates a follow-up one-shot schedule that runs `cb process-news`, which triggers the `config/workflows/process-news.workflow.card` workflow with four steps:
> 
> 1. **Triage** (Haiku agent) — reads `config/news.guide.card` for your interests, trashes uninteresting items via `cb trash`
> 2. **Fetch** (shell) — runs `cb fetch-all-news --dir box/inbox/news` to download full article content
> 3. **Analyze** (Sonnet agent) — adds `<analysis>` elements to each card, then moves them to `box/pool/news/`
> 4. **Brief** (Sonnet agent) — composes a `news-brief` card in `box/output/briefs/`, archives used items to `store/archive/news/`
> 
> ### Flow summary
> ```
> config/schedules/check-rss  →  cb wakeup --connector rss
>                                     ↓
>                             config/connectors/rss.json (feed URLs)
>                                     ↓
>                             box/inbox/news/*.news-item.card  (created)
>                             box/jobs/*.news-job.card         (created)
>                                     ↓
>                             process-news workflow
>                               triage → fetch → analyze → brief
>                                     ↓
>                             box/output/briefs/*.news-brief.card
> ```
> 
> User preferences that control triage are in `config/news.guide.card`, which defines interests, disinterests, and experiments.

**Assessment:** (to be filled in during evaluation)

---

## outbound-notifications
**Prompt:** "How would outbound notifications work?"
**Expected level:** knows_about
**Watch for:** Mentions cb finalize and finds pushover connector

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 206 words

**Response:**
> [thinking]
> Based on the agent guide, outbound notifications flow through `box/output/`. Let me check the docs for more details.
> Here's how outbound notifications work in this system:
> 
> ## Flow
> 
> 1. **Create a card in `box/output/`** — e.g., a `pushover-message` card with `status="pending"`
> 2. **Commit** the card to git
> 3. **Run `cb finalize`** — this flushes all pending output cards through their connectors
> 
> `cb finalize` is also called automatically by `cb reactor` after processing jobs, so notifications created during job processing get sent automatically.
> 
> ## Pushover Notifications (the main notification type)
> 
> Create a card like:
> 
> ```xml
> <pushover-message status="pending">
>   <message>Build completed successfully</message>
>   <title>CI Notification</title>
>   <sound>magic</sound>
>   <priority>0</priority>
> </pushover-message>
> ```
> 
> Options include `<url>`, `<html>` (for rich formatting with `<b>`, `<i>`, `<a>`), `<priority>` (-2 quiet to 2 emergency), and various `<sound>` choices.
> 
> ## Lifecycle
> 
> - **Success**: status becomes `"sent"`, a `<response>` element is added, then the card is **deleted**
> - **Failure**: status becomes `"failed"`, an `<error>` element is added, and the card is **kept** for inspection/retry
> 
> ## Other Output
> 
> The `box/output/` directory also holds non-notification output like news briefs (`box/output/briefs/`), so it's a general outbound staging area — not just for push notifications.
> 
> ## Connector Filtering
> 
> You can target a specific connector: `cb finalize -c pushover` to only flush pushover messages.

**Automated checks:**
- ✓ Response contains "finalize"

**Assessment:** (to be filled in during evaluation)

---

## how-schedules-work
**Prompt:** "How do scheduled tasks work in this box?"
**Expected level:** knows_directly
**Watch for:** Describes tick/scheduled mechanism from agent guide

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-scheduled-script.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schedules/check-rss.scheduled-script.card, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schedules/check-email.scheduled-script.card
- Searches: Glob: config/schedules/*.card
- Response length: 254 words

**Response:**
> [thinking]
> Let me check the documentation for scheduled scripts.
> Here's how scheduled tasks work in this box:
> 
> ## Overview
> 
> Scheduled tasks are defined as **scheduled-script cards** (`.scheduled-script.card` files) living in `config/schedules/`. Each card declares a command to run and when to run it.
> 
> ## Schedule Types (pick one)
> 
> - **cron** — Standard cron expression, e.g. `cron="0 6,18 * * *"` for 6am and 6pm daily
> - **at** — ISO datetime for a one-shot future execution
> - **rrule** — iCalendar RRULE for complex recurrence
> 
> ## Execution
> 
> - **`cb tick`** — Evaluates all schedules and runs any that are due. This is the main entry point.
> - **`cb scheduled`** — Lists all schedules with their status and last-run time.
> 
> ## Throttling & Opportunistic Runs
> 
> - **`not-before`** — Minimum interval between runs (e.g. `"4h"`, `"10m"`), preventing over-execution even if the cron fires more often.
> - **`on-wakeup="true"`** — Also run opportunistically whenever `cb wakeup` is called, subject to the `not-before` constraint.
> 
> ## Chaining
> 
> A schedule can create follow-up tasks via `<create-after-success>`. For example, the RSS check schedule creates a one-shot `process-news` job after successfully syncing feeds:
> 
> ```xml
> <create-after-success path="config/schedules/process-news.scheduled-script.card">
> runs=cb process-news
> once=true
> </create-after-success>
> ```
> 
> ## Other Options
> 
> - **`once="true"`** — Auto-deletes the card after successful execution (useful for one-shot tasks).
> - **`enabled="false"`** — Disables a schedule without deleting it.
> - **`until`** — Expiry datetime after which the schedule stops firing.
> 
> ## This Box's Schedules
> 
> This box has 6 active schedules: `check-rss`, `check-email`, `check-calendar`, `check-captures`, `check-dropbox`, and `check-raindrop` — covering feed syncing, email polling, calendar review, and bookmark/capture imports.

**Assessment:** (to be filled in during evaluation)

---

## add-daily-task
**Prompt:** "How would I add a daily task?"
**Expected level:** knows_about
**Watch for:** Reads docs/generated/card-scheduled-script.md for format

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 66 words

**Response:**
> [thinking]
> You'd create a **scheduled script** card. Here's how:
> 
> ```bash
> cb create config/schedules/my-daily-task.scheduled-script.card -t scheduled-script
> ```
> 
> Then edit it to set a daily cron schedule and the command to run. The card format is documented in `docs/generated/card-scheduled-script.md`.
> 
> Want me to look at the full schema so I can give you a more concrete example, or do you already know what task you want to run daily?

**Automated checks:**
- ✗ Read docs/generated/card-scheduled-script.md

**Assessment:** (to be filled in during evaluation)

---

## track-recipes
**Prompt:** "I want to track recipes. How would you set that up?"
**Expected level:** discoverable
**Watch for:** Discovers config/schemas/CLAUDE.md to learn about custom card types

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Bash: Check existing recipes dir and recipe card docs; Check recipe template
- Response length: 186 words

**Response:**
> [thinking]
> Looking at your box setup, recipe tracking is already built in! Let me check what's currently in place.
> Great news — recipe tracking is already a built-in feature of your box. Here's how it works:
> 
> **Where recipes live:** `store/recipes/` — you can use subdirectories for organization (e.g., `store/recipes/italian/`, `store/recipes/desserts/`).
> 
> **Creating a recipe:**
> 
> ```bash
> cb create store/recipes/Pasta_Carbonara.recipe.card -t recipe \
>   title="Pasta Carbonara" \
>   description="Classic Roman pasta" \
>   servings=4
> ```
> 
> Then edit the card to fill in ingredients and steps. The format supports:
> 
> - **Scaled ingredients** — `<ing amount="2" unit="cups">flour</ing>` that auto-scale when you change the yield
> - **Step references** — use `@basil` or `@{ricotta salata}` in steps to link back to ingredients
> - **Sections** — for multi-part recipes (e.g., separate sauce and pasta sections)
> - **Images** — attach a photo with `--attachment`
> - **Tags** — for categorization
> 
> **Example workflow:**
> 1. `cb create store/recipes/Banana_Bread.recipe.card -t recipe title="Banana Bread" servings=1` — creates the card
> 2. Edit the file to add your ingredients and steps
> 3. `cb validate store/recipes/Banana_Bread.recipe.card` — check it's well-formed
> 
> Want me to create a starter recipe so you can see the full format in action?

**Automated checks:**
- ✗ Read config/schemas/CLAUDE.md

**Assessment:** (to be filled in during evaluation)

---

## create-task-card-type
**Prompt:** "Can you create a new type of card for tracking project tasks?"
**Expected level:** discoverable
**Watch for:** Says yes and navigates to schemas, not 'card types are built-in'

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schemas/bookmark.ts, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schemas/CLAUDE.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-memo.md
- Searches: (none)
- Response length: 101 words

**Response:**
> [thinking]
> Let me explore how existing card types are defined in this codebase.
> [thinking]
> Let me look at the existing box-local schema example and the schema creation guide.
> Now I have a clear picture. Let me ask about the user's requirements before writing the plan.
> What fields should a project task card include? Here are some options:
> 
> 1. **Basic** - Status (todo/in-progress/blocked/done), priority (low/medium/high), title, description
> 2. **With dates** - Basic + due-date and created-date
> 3. **Full featured** - Basic + dates + assignee, tags, notes/comments
> 
> What level of detail would you like, or do you have specific fields in mind?

**Automated checks:**
- ✓ Read config/schemas/CLAUDE.md

**Assessment:** (to be filled in during evaluation)

---

## add-new-capability
**Prompt:** "How would you add a new capability to this box?"
**Expected level:** knows_directly
**Watch for:** Lists extension mechanisms: workflows, tricks, guides, schedules; bonus if mentions schemas

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 199 words

**Response:**
> [thinking]
> There are several ways to extend this box, depending on what kind of capability you want to add:
> 
> ## 1. **Tricks** (custom scripts)
> 
> The simplest extension point. Create a script in `tricks/scripts/`:
> 
> ```
> tricks/scripts/my-trick/index.ts
> ```
> 
> Run with `cb trick my-trick`. Good for one-off or utility operations.
> 
> ## 2. **Workflows** (multi-step pipelines)
> 
> For repeatable multi-step processes, create a workflow card in `config/workflows/`. Workflows orchestrate jobs and can be triggered manually (`cb workflow run <name>`) or from schedules. See `docs/generated/workflows.md` for the authoring format.
> 
> ## 3. **Scheduled Scripts** (recurring automation)
> 
> For things that should run on a schedule (syncing data, maintenance), create a `.scheduled-script.card` in `config/schedules/`. These run via `cb tick`.
> 
> ## 4. **New Card Types**
> 
> If you need a new data shape, you'd define a new card type with its schema. Existing types like `memo`, `recipe`, `bookmark`, etc. each have schemas in `docs/generated/`.
> 
> ## 5. **Connectors / Resources**
> 
> To pull in external data, sync it into `box/resources/` — this is how RSS feeds and other external state enter the system.
> 
> ---
> 
> **What's your goal?** If you describe the capability you want to add, I can look at the existing patterns in the codebase and suggest the most appropriate approach.

**Assessment:** (to be filled in during evaluation)

---

## card-types-and-add-new
**Prompt:** "What card types do you know about? Can you add new ones?"
**Expected level:** knows_directly
**Watch for:** Lists types (knows directly) AND addresses adding new ones (discoverable)

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 152 words

**Response:**
> [thinking]
> Based on the agent guide, here are the card types I know about:
> 
> **Content cards:** memo, bookmark, image, audio, capture-session, record, recipe, email-thread, email-message
> 
> **News cards:** news-item, news-summary, news-brief, news-guide
> 
> **Job cards:** news-job, guide-revision-job, intake-job, calendar-review-job
> 
> **System/workflow cards:** question, feedback, workflow, workflow-run, guide, scheduled-script, pushover-message
> 
> Each type has a schema documented in `docs/generated/card-*.md`.
> 
> **Can I add new ones?** No — card types are defined by the callback-box framework itself (the `cb` tool), not by this box's configuration. I can create *instances* of existing card types using `cb create`, but I can't define new card type schemas. If you need a new card type, that would be a change to the callback-box codebase rather than something I can do within this box.
> 
> That said, some types like **memo**, **record**, and **guide** are fairly flexible and can cover a wide range of content. Is there a specific kind of card you're looking for?

**Assessment:** (to be filled in during evaluation)

---
