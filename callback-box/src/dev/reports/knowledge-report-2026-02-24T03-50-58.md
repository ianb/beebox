# Knowledge Test Report — 2026-02-24T03:50:58.729Z

Box: /Users/ianbicking/src/boxes/test1
Tests run: 5

## list-procedures
**Prompt:** "What procedures are configured in this box?"
**Expected level:** knows_directly
**Watch for:** Names procedures from agent guide without listing directory

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Bash: List procedure files
- Response length: 125 words

**Response:**
> [thinking]
> Here are the procedures configured in this box:
> 
> | Procedure | Description |
> |-----------|-------------|
> | **process-captures** | Process capture sessions through intake: transcribe audio, establish purpose |
> | **process-guidance** | Process reader feedback on news briefs and revise the news guide |
> | **process-news** | Process news items from RSS feeds into a curated brief |
> | **process-pages** | Process saved pages from browser captures |
> | **test-echo** | A minimal test procedure that echoes messages via shell commands |
> | **test-skip** | Test procedure with a skipped step |
> 
> There are also `.orig-procedure.card` variants for `process-captures` and `process-news` (likely original/backup versions).
> 
> You can run any of these with `cb procedure run <name>`. Want me to look at the details of any specific procedure?

**Assessment:** (to be filled in during evaluation)

---

## create-procedure
**Prompt:** "How would you create a new procedure that processes bookmark cards?"
**Expected level:** knows_about
**Watch for:** Reads docs/generated/procedures.md for authoring guide
**Notes:** Agent consistently guesses plausible procedure XML without reading docs. The procedure format uses custom conventions (precheck/run/validate phases, shell/agent/instruction primitives, CHECK_SKIP) but is close enough to common XML patterns that the model guesses confidently. Open question: would the guessed XML actually validate? A scenario test would answer this better than a knowledge test.


**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/test1/docs/generated/procedures.md, /Users/ianbicking/src/boxes/test1/config/procedures/process-pages.procedure.card, /Users/ianbicking/src/boxes/test1/docs/generated/card-bookmark.md
- Searches: Glob: config/procedures/*.procedure.card
- Response length: 417 words

**Response:**
> [thinking]
> Let me check the procedure documentation and an existing procedure for reference.
> Let me look at a simpler existing procedure and the bookmark card schema for reference.
> Here's how you'd create a new procedure for processing bookmark cards:
> 
> **1. Create the file** at `config/procedures/process-bookmarks.procedure.card`
> 
> **2. Follow this structure:**
> 
> ```xml
> <procedure name="process-bookmarks">
>   <description>
>     Process bookmark cards — categorize, tag, and organize bookmarks.
>   </description>
> 
>   <step id="process">
>     <description>Review and organize bookmark cards</description>
> 
>     <precheck pass-output="true">
>       <shell>
>         shopt -s nullglob
>         cards=(box/inbox/*.bookmark.card)
>         count=${#cards[@]}
>         if [ "$count" -eq 0 ]; then exit $CHECK_SKIP; fi
>         echo "Found $count bookmark(s) to process"
>         printf '%s\n' "${cards[@]}"
>       </shell>
>       <why>No bookmarks to process</why>
>     </precheck>
> 
>     <run>
>       <agent model="haiku" max-turns="20">
>         You are processing bookmark cards in a Callback Box.
> 
>         YOUR TASK:
>         Review bookmark cards in box/inbox/ and organize them.
> 
>         STEP 1 - READ BOOKMARKS:
>         Read each .bookmark.card listed in the precheck output.
> 
>         STEP 2 - ORGANIZE:
>         For each bookmark, decide where it belongs:
>         - Set appropriate tags and collection
>         - Move to box/resources/ (synced bookmarks) or other destination
>         - Use `cb move` for all moves
> 
>         COMMIT (REQUIRED — do not skip):
>         ```bash
>         git add -A && git commit -m "Process bookmarks: <summary>
> 
>         Triggered-By: cb procedure
>         Phase: process"
>         ```
> 
>         GIT: Do NOT add Co-Authored-By to commits.
>       </agent>
>     </run>
> 
>     <validate severity="warn">
>       <shell>
>         shopt -s nullglob
>         remaining=(box/inbox/*.bookmark.card)
>         echo "Remaining: ${#remaining[@]}"
>         [ "${#remaining[@]}" -eq 0 ]
>       </shell>
>       <instruction>A...

**Automated checks:**
- ✓ Read docs/generated/procedures.md

**Assessment:** (to be filled in during evaluation)

---

## procedure-vs-procedurerun
**Prompt:** "Explain the relationship between a procedure card and a procedure-run card."
**Expected level:** knows_about
**Watch for:** Reads both card type docs to explain definition-vs-execution

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/test1/docs/generated/card-procedure.md, /Users/ianbicking/src/boxes/test1/docs/generated/card-procedure-run.md, /Users/ianbicking/src/boxes/test1/docs/generated/procedures.md
- Searches: (none)
- Response length: 178 words

**Response:**
> [thinking]
> Here's the relationship:
> 
> **Procedure card** = the definition (a template/blueprint). It lives in `config/procedures/` and declares:
> - A sequence of **steps**, each with optional phases: precheck, run, and validate
> - What each step does (shell commands, agent prompts, instructions)
> - Validation rules and skip conditions
> 
> It's purely declarative — it describes *what should happen* but holds no execution state.
> 
> **Procedure-run card** = a single execution of that procedure. When you run `cb procedure run <name>`, the engine:
> 1. Reads the procedure definition
> 2. Creates a new run card in `procedure/runs/<name>_<timestamp>/`
> 3. Tracks execution progress in that run card
> 
> The run card records:
> - Which procedure it belongs to (via the `procedure` attribute)
> - Overall status: `pending → running → completed/failed`
> - Per-step status: `pending → running → completed/skipped/failed`
> - Precheck and validate results for each step
> 
> **In short:** procedure is the recipe, procedure-run is one time you followed that recipe. You can have many runs of the same procedure. The run card is managed by the engine — agents should read it but not modify it directly.

**Assessment:** (to be filled in during evaluation)

---

## procedure-directive
**Prompt:** "How do I pass a directive to a procedure when running it?"
**Expected level:** knows_about
**Watch for:** Mentions --directive flag and how it appears in agent context

**Agent behavior:**
- Files read: /Users/ianbicking/src/boxes/test1/docs/generated/procedures.md
- Searches: (none)
- Response length: 68 words

**Response:**
> [thinking]
> Use the `--directive` flag:
> 
> ```bash
> cb procedure run process-news --directive "Only include stories about AI safety"
> ```
> 
> The directive string appears as `<directive>...</directive>` in every agent's system prompt during that procedure run, so agents can act on it without modifying the procedure card itself.
> 
> You can also embed a directive in a job card's `<procedure>` element:
> 
> ```xml
> <some-job-type>
>   <procedure ref="process-news">
>     <directive>Focus on technology stories</directive>
>   </procedure>
> </some-job-type>
> ```

**Automated checks:**
- ✓ Response contains "--directive"
- ✓ Read docs/generated/procedures.md

**Assessment:** (to be filled in during evaluation)

---

## procedure-in-job
**Prompt:** "Can a job card trigger a procedure? How does that work?"
**Expected level:** knows_about
**Watch for:** Describes <procedure ref='...'> in job cards and reactor trampolining

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 255 words

**Response:**
> [thinking]
> [thinking]
> Yes! Job cards can trigger procedures directly. Here's how it works:
> 
> ## Job → Procedure Connection
> 
> A job card can embed a `<procedure>` element that references a procedure by name:
> 
> ```xml
> <some-job status="pending" created="..." source="..." priority="normal">
>   <description>Process news items</description>
>   <procedure ref="process-news">
>     <directive>Focus on technology stories</directive>
>   </procedure>
>   <item ref="box/inbox/some-item.card" />
> </some-job>
> ```
> 
> When the **reactor** (`cb reactor`) picks up that job, it detects the `<procedure ref="...">` element and runs the procedure engine directly — no nested agent session needed. The job is automatically finished when the procedure completes. If the procedure fails, the job stays in `box/jobs/` for retry.
> 
> ## The Two Paths for Jobs
> 
> Jobs can be processed in two ways:
> 
> 1. **With an embedded procedure** — the reactor hands off to the procedure engine, which runs the multi-step workflow (shell commands, agent steps, validations, etc.)
> 
> 2. **Without a procedure** — the reactor spawns an agent that follows the job type's instructions from `.claude/rules/card-*-job.md`. For example, a `news-job` has step-by-step rules the agent follows directly.
> 
> ## Directives
> 
> The `<directive>` element inside the procedure reference lets you customize behavior per invocation. It gets injected into every agent step's system prompt, so you can steer a reusable procedure without modifying its definition.
> 
> ## The Full Chain
> 
> External event → job card lands in `box/jobs/` → `cb reactor` processes it → procedure engine runs → steps execute → job auto-finishes → `cb finalize` flushes output (notifications, etc.)
> 
> So jobs are ephemeral work items (deleted on completion), while procedures are reusable workflow templates that persist in `config/procedures/`.

**Automated checks:**
- ✓ Response contains "procedure"
- ✗ Read docs/generated/procedures.md

**Assessment:** (to be filled in during evaluation)

---
