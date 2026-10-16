# Chapters

One section per chapter, in talk order. Each chapter is one solution, or a tension that led to one; a few are solutions that failed. The explorer shows the talk as chapters of cards: a chapter's title card (its name and, when it has one, its comic), then the chapter card (the bullets below), then one card per exhibit. A graph exhibit is the timeline zoomed to the chapter's span with the exhibit's stats and lanes showing; every other exhibit covers the timeline.

Fields after the heading, one per line: `span: YYYY-MM-DD — YYYY-MM-DD`; `comic: figures/<file>` for the title card; `stats: id, id` (tests, docs, code, commits, open, closed, testFiles, skills, instructionLines, skillLines, totalFiles, totalDirs, dirMax, dirTop3, dirMean, codebaseShare, doctestCode, doctestProse, otherTestLines, browserCalls, browserSessions, exhibitScreenshots, bashCalls); `kinds: kind, kind` (process, sweeps, product, infrastructure); `events: key|all`. Then the card body as Markdown bullets; `**Bold:**` leads render as labels.

The chapter's own stats, kinds and events make its first exhibit, "On the graph". Each `### title` after the bullets adds one more. An exhibit with `stats:`, `kinds:` or `events:` lines is a graph setting; one with `file: <repo path>` shows that file (optionally `lines: a-b`; a Markdown file renders as a document), with any bullets under it as its caption; one with only bullets lists them. `image: <path under this directory>` adds a picture below either; several make a two-column grid. The generator `figures.ts` writes it all to `data/chapters.json`.

## Developing software with coding agents
span: 2026-01-27 — 2026-10-13
tagline: Ian Bicking · Minneapolis AI Engineering Meetup · October 14, 2026
events: key
- Open source: pip, virtualenv.
- Mozilla. Meta Reality Labs.
- About ten years in prototyping roles.
- ianbicking.org

## The thing I'm building
span: 2026-01-27 — 2026-10-13
comic: figures/app.webp
stats: code, tests, docs
kinds: product
events: key
- **The product:** a personal, or family, knowledge base with an assistant living in it, in the tools-for-thought tradition. You feed it voice memos, emails, clippings, scans; agents file them, take actions, ask questions. The filesystem is state, git is history, and a CLI is how the agent operates it.
- **The site:** beebox.run
- **The parts:** the assistant itself, the server management around it, an iOS companion, a Chrome extension, a scan uploader, the agentic environment underneath, and the authentication that passes through all of it.
- **Some of the features:** voice memos, chat, email, web clipping, scanning, published pages, push notifications, search.
- **The pace:** 9,221 commits over 231 days with commits, about 40 a day; the peak week had 1,020.
- **The queue:** 1,241 issues filed, 746 closed, 495 open.
- **What this talk is about:** none of those numbers. It is about the part of the repository that is not the product, and why that part kept growing.

### Just me
- One person. Nobody's toes to step on.
- A change rewrites every document that mentions the old way. The next agent reads it as if it had always been this way.
- Coworkers remember. They have habits, opinions, and half-read docs.
- A lot of what follows is only cheap because nobody else had to agree.

### Languages
- **Plans:** 138,000 lines of Markdown, 13%. 329 files.
- **Issues:** 80,000 lines, 8%. 1,231 files.
- **Docs:** 79,000 lines, 8%. Research notes, another 25,000.
- **Skills and agent instructions:** 4,700 lines. Under half a percent.
- **Doctests:** 178,000 lines, 17%. 127,000 of them are fenced code, 51,000 are the prose around it.
- **TypeScript:** 409,000 lines, 39%.
- **YAML:** 39,000. **Swift:** 33,000. **JSON:** 30,000.
- **Shell:** 8,000. **HTML:** 7,000. **CSS:** 4,000.

### Commits a week
stats: commits
kinds: product
events: key

### Issues filed and closed
stats: open, closed
kinds: product
events: key

## Diving in
span: 2026-01-27 — 2026-02-14
comic: figures/frolic.webp
stats: code
kinds: product, infrastructure
events: all
scale: view
- **Step zero, like everyone:** an empty repository and a coding agent. No process, no checks, no plan beyond the idea.
- **Can I do this?** A smaller project, vibe-coded, had gone well. This one is bigger, and I was exploring the way of building and the thing built at the same time.
- **Ideas from elsewhere,** OpenClaw among them, and a bit of code, borrowed from my previous experiments: notes as typed files in git, a schema per kind of note, an agent that reads feeds and writes a daily brief.
- **Trusting the agent to put it together:** a week in there was a card library, a web UI, a feed connector, a news pipeline, a plugin that validated cards on write. I read the results, not the code.
- **One principle from the first day:** the product has to be comprehensible to the agent. Filesystem as state, git as history, a command line as the interface, documentation written for an agent to read on your behalf. The same principle went into the development.
- **We are just having fun.** Nothing is broken, because we are just getting started.


## Making conscious choices
span: 2026-02-20 — 2026-03-20
comic: figures/laws.webp
stats: code, commits
kinds: process, infrastructure
events: all
- **Every choice I have not made gets made anyway,** one session at a time: a different state pattern per page, a hand-rolled helper where a library exists. The basic architecture was being vibed.
- **Choice one: overbuild at the start.** tRPC, XState, TanStack Query and Router, Zod everywhere, a real logging stack on the list. More than a five-week-old app needed. Not because choosing late is expensive; it is cheap too. For anything of substantial size, asking the most of the agent from the start is a good investment.
- **Choice two: decide, do not drift.** One day in March, a document of 23 technology decisions: XState, tRPC, TanStack Query and Router, Fastify, Tailwind with a component catalog, Zod, a SQLite index, subscriptions, simple-git, CASL, the Agent SDK, Pino with OpenTelemetry, TAP plus doctest, Markdoc, hotkeys, Phosphor icons, Voxtral, knowledge audits, a dev runner, view transitions, syntax highlighting, and utility libraries in place of hand-rolled code. Each names the runner-up and why.
- **Principles from the choices:** writing the choices down produced the principles, and the principles then scored the next choices. For state management the agent built the same page in three frameworks and scored them on a table.
- **Exposed:** I have very little handle on my dependencies. The document decided 23; since then 70 more packages arrived and 12 left, and I chose a few of them.

### I'm not interested in the AI's opinions
- Discuss and document reasoning and principles until the decision doesn't require an opinion.

### Create principles from your choices
- Use the decision process to find the rules underneath it. Write them down. Use them for the next decisions, and as the shared rubric while deciding.
- **Introspectability:** can you enumerate what the system can do.
- **Well-typedness:** the types say something, not ceremony.
- **Accessibility to tooling:** a tool can drive it from outside.
- **Unidirectional data flow:** state in, UI out.
- **Isolation and modularity.**
- **Ecosystem health.**
- **Minimal distance from intuitive.**
- **Power and leverage.**

### Documented decision making
file: beebox/docs/reports/stack-decisions-2026-09-04.md
lines: 90-119
- An example of how the decision-making template is filled out.

## Making it hard for the agent
span: 2026-01-27 — 2026-04-01
comic: figures/proctor.webp
stats: code, tests
kinds: process, infrastructure
events: all
- **Setup:** one checkout, several agents at once in different areas, a few related repositories, and me doing drive-by review: sampling my attention across the code, not watching every edit.
- **Code smell is the skill that sampling depends on:** noticing a problem area from indirect signals. How long something took to implement, the size of the change, a comment buried in the diff, the category of bug that keeps coming back.
- **All the focus here is on making the environment as strict as I can.** Not on teaching the agent to be careful; on making carelessness fail.
- **Type-safe libraries, and rules against type-lax behavior:** strict TypeScript with unchecked index access and implicit returns forbidden; no `any`, no non-null assertions, no floating promises, exhaustive switches; tRPC and Zod so a wrong shape fails at the boundary. One shared preset, 219 rules, two of them written here.
- **Checks on every write.**
- **The code teaches the agent.** Much of an agent's behavior is learned socially, from the code around it. So I could not only hold new code to the rules; all the existing code had to be fixed first, as the exemplar.
- **Caveat:** these were earlier models. Some of what I needed then may not matter now.
- **Exposed:** with the checks catching wrong moves, I could sample less often, and sessions ran longer.

### The stranger rules
- **Files under 300 lines, functions under 150, two positional parameters at most.** The real sticklers, from the first day. A third parameter means an options object; a 301st line means a split.
- **No import redirection.** No barrel files, no re-exports. Import directly from the source. Moving a file causes more churn, and who cares: the agent handles the churn.
- **No default parameters.** Defaults live in the body, where a reader sees them.
- **No `new Error("...")`.** Every error is a custom class that owns its message.
- **`.length > 0`, never truthiness on a length.**
- **JSX nested at most four deep,** to force extracting a component.
- **Problematic APIs are barred except through safe wrappers.** Child processes, non-literal regular expressions.
- **No `export default class`.**


## Blending tests and documents
span: 2026-02-24 — 2026-04-01
comic: figures/scribes.webp
- **Tension:** the agent writes tests I never read. A test file of nested describe and it blocks tells me nothing when I do, and tells the agent little when it reads one back.
- **Solution:** tests as Markdown documents, adopted from an earlier project of mine. Prose between code blocks tells the story; each block is a test case; the output is written for an agent reading a pipe, not a person at a terminal. A weak test still earns its place as documentation.
- **Scale:** today 1,070 of 1,214 test files are doctests, and the runner is its own package, written entirely by the agent.

### On the graph
span: 2026-01-27 — 2026-10-13
stats: doctestCode, doctestProse, otherTestLines
kinds: process
events: key

### How long the full suite takes to run, best estimate
span: 2026-08-24 — 2026-10-13
stats: suiteMinutes
kinds: process
events: key

### What a doctest looks like
file: beebox/test/cli/commands/health.doctest.md
- A real test of a command's printout. The setup block builds three scheduled tasks in three states; the expected output is the text a person would see, with a `«blankline»` wildcard where the value does not matter; a `continue` block keeps checking the same state. The prose between the blocks is the documentation.

## White box testability
span: 2026-02-14 — 2026-10-13
comic: figures/lab.webp
stats: doctestCode, code
kinds: process, infrastructure
events: all
- **The agent should be able to probe its own work with tests.** Any situation it needs to reach: a service down, a wrong clock, a model saying no. I started thorough and have been trimming thoroughness since.
- **So testability is built in, unreservedly.** If something is hard to test, the product changes: one function for the clock, a fake beside every outside service, a flag that turns each seam on. I do not count that as a cost.
- **Careful! Agents put up with a bad environment.** They work around it for a long time without complaining. You have to go and ask.

### The principle, as written
file: beebox/docs/engineering-principles.md
lines: 116-125
- Principle 10 of the engineering principles the agents read. The seams are deliberate even where conventional style would call them over-engineering; the flag keeps them off in production.

## Logs logs logs!
comic: figures/logs.webp
span: 2026-03-01 — 2026-09-30
stats: logCalls, code
kinds: process, infrastructure
events: all
- **The reason:** I want to be able to talk about any bug, even a bug that is just me not liking how something works, and have the agent figure out what happened.
- **I never read logs.** Agents are surprisingly good at tracing what happened even without logs. Better with them.
- **The agent can find and track down logs.** Lazy bug reports now work very well. "Something just went wrong": actionable!
- 2,068 log calls across 557 source files.

### Every log that is kept
- **In each box, for the agent and me**
- The browser and iOS console log
- Scheduler runs, one JSON line each
- Notifications sent
- The judgment model's calls, key never written
- Push delivery
- Security-policy violation reports
- Capture timing
- Link checks after a commit
- Retrospective observations
- The box's upgrade log
- Every request to a model, behind a flag
- **In each box, as records**
- The migration manifest, one line per migration
- The usage manifest, agent sessions to tasks
- A per-thread event log
- Chat session transcripts, read back by the audio features
- **On the machine, for the process**
- The dev router's log per checkout
- Worktree cleanup
- The scheduler's collected stderr
- The test ledger of every run, shared by all checkouts
- The agents' own session transcripts
- **On the server**
- The deploy record, one line per deploy, and the last deploy's output
- The host's package-update log
- The agent runtime's update log
- **On other devices**
- The scan uploader's log on the laptop
- The Chrome extension's last build
- **Read by:** the agent in a session, the retrospective every three days, and a health command that turns several into one status line each.

## Monorepo: there are no roles
span: 2026-05-18 — 2026-06-01
comic: figures/roles.webp
- **Tension:** five repositories for five kinds of expertise. The agent is equally good in every area, so the boundaries only got in the way.
- **No roles, then or since.** I have never used role-based agents: no backend agent, no frontend agent, no reviewer persona. One agent, any area.
- **Agents are great at git.** You can merge and split repositories without losing history. I always could have learned how to use git so well, and I never did (and now never will).
- 46 of 154 pieces of work since touched two or more packages.

## Oops, I forgot!
span: 2026-01-27 — 2026-10-13
comic: figures/oops.webp
stats: code
kinds: sweeps
events: all
- **Tension:** the merge revealed 1,000 silently disabled lint violations across 158 files. Something had been turning my rules off.
- **The sweep:** decide what to do, do it all in one big batch, fix everything, leave no evidence of what was bad before.
- **Fix the whole thing.** Every exception left behind becomes a lesson the next agent learns. The whole point of our brave new future is that we get to just do things.

## Cross-model review
comic: figures/confession.webp
span: 2026-06-01 — 2026-07-06
stats: planEdits
kinds: process, product
events: all
- **I already wasn't reading or reviewing the code.** The motivation is to make it that much harder on the agent.
- **Solution:** June 4: the other model family reviews what the first one built, before I look.
- **Is the value a different model, or just a different perspective?** I don't know! When the other model has no quota, the same model reviews, and that works too.
- **Cost:** a $20 ChatGPT plan was enough for the reviews alone. The reviews got deeper later.
- **Outcome:** the technique with the most recorded catches: eight defects in one branch, two false greens, a guard that failed open.

## Plan & finish: the core skills
span: 2026-05-26 — 2026-10-13
comic: figures/tps.webp
stats: skills, skillLines
kinds: process
events: all
- **A plan is a complete unit of work:** designed end to end before implementation, shipped end to end when it finishes.
- **The plan template is the guide.** Not just a list of instructions, but a form to fill out. The agent has to assert when a section doesn't apply, no skipping.
- **The discipline:** cite, do not assert; no numeric scoring; an empty search is a finding; walk each scenario against the real code before calling the plan ready; an open question inside the first chunk is a missing decision.
- **I don't read the plans.** They serve as agent discipline, not review.
- **317 plan documents today:** 88 open, 229 implemented. 1,071 commits on main name the plan they serve. A plan is edited 7 times at the median, 37 at most.
- **/finish completes the landing,** with additional strictness and linting that is more surface level, as well as accounting.

### The template
- Design
- Smallest fix and budget
- Stated preferences this plan trades against
- What already exists
- Prior art (external)
- Ontology
- Tracks / scope
- Could this be simpler?
- Subplans
- Failure modes
- Agent-flow / user-flow edge cases
- NOT in scope
- Open design questions
- Knowledge audits
- What will hold this after it ships
- Implementation order
- Rollout shape

## Issues and workstreams
comic: figures/workstreams.webp
span: 2026-07-01 — 2026-09-07
stats: open, closed, commits
kinds: process, product
events: key
- **In the beginning my rule had been fix it now, never put work off.** As the project grew, that stopped being possible.
- **Issues:** one Markdown file per issue, and tooling around them. All effectively written by the agent, though I often kick them off pretty explicitly.
- **Workstreams:** an area of work and discussion. Ideally most information ends up in documentation, but for followups it's nice to resume the session.

## Leap before you look
comic: figures/signing.webp
span: 2026-07-06 — 2026-10-13
stats: commits, open
kinds: process, product
events: all
- **Tension:** the questions kept coming, and I could not answer most of them well. Answering badly, slowly, was worse than not answering.
- **Solution:** leap before you look. I mostly accept the agent's decision and critique it after it lands. Three things make that safe enough.
- **1. Write down what I insist on.** Security at the boundaries, resilient and never silent, logs everywhere, one way to do each thing, testability built in. Thirteen engineering principles, July 6, that the agent reads before it designs.
- **2. Then those never come up as questions.** If the agent holds to them, what reaches me is a real compromise, usability against privacy, that only I can answer.
- **3. Design falls where it falls,** and I critique later: a tag for fixes waiting for me to try, a retrospective every three days, comments typed or spoken on the page.
- **Lazy replies, counted:** of my 3,213 messages since July, 687 begin with ok, yes or sure; 257 are under 25 characters; 94 just say "go ahead".

### What "go ahead" means
file: AGENTS.md
lines: 32-41
- The four levels of how much to do, from the instructions every session reads. A bare "go ahead" is the third.

## “Three things I need from you” 😩
comic: figures/screws.webp
span: 2026-07-01 — 2026-10-13
stats: open, commits, exhibitScreenshots
kinds: process, product
events: all
- **Tension:** decision fatigue. Not the system's fault: it works at a pace where it meets a decision with a real trade-off several times a day, and each one comes to me.
- **And I cannot judge them:** the decisions are internal, or I would have to test for a while to see how the change comes out in the product. A paragraph about a layout does not tell me what I would see.
- **Attempts:** a needs-decision gate on issues, and a folder for decisions alone. Exhibits, August 15: a page the agent renders to show me, with a question on each and a queue of the unanswered. October 10: the question and the queue removed; an exhibit shows, questions go in chat, the finished notification opens the page, and I can answer by typing or speaking on it. A rule for how a question is asked: define its nouns in plain words, give both outcomes for a person using the product, the cost, and a lean. A tag that lets the agent verify without me.
- **Where it stands:** 35 issues wait on a decision now, 26 more in the decisions folder. Many iterations, and I am not happy with the result.

### Questions, as asked
- **August 22:** "With the set fixed at two, what keeps a new call site from picking the wrong one?"
- Shared module + ESLint literal ban (Recommended) · Shared module + structural test · Consolidate, no guard
- **October 6:** "How should the upload batch's attach scope be renamed to match the `<basename>.attach` convention?"
- Slug-named card (Recommended) · Same, plus a migration · Land current work first
- Two of the agent's questions, verbatim, from the session transcripts. Each is a real decision, and each is unanswerable without the hour of context the agent had just spent.

### Exhibit questions
- **September 5, an exhibit titled "Sidecar landmark context strip — three shapes".** The question, verbatim:
- "Pick the shape for the card sidecar's landmark context strip (or reject all three). I build the one you pick, behind the card's OWN directory landmark only — no root fallback — and design it as the slot the companion-context surface (todos, etc.) later shares. B-variants only; A1 is the reverted attempt, shown for contrast."
- **Options:** B1, share the existing toggle row · B2, its own line under the tabs · B3, identity chip, links on disclosure · None of these, say what instead.
- **Every noun is from the plan:** sidecar, landmark context strip, directory landmark, root fallback, companion-context surface, B-variants, A1. The next exhibits are the mockups that came with it.

### The four mockups
image: figures/exhibit-sidecar-a1.webp
image: figures/exhibit-sidecar-b1.webp
image: figures/exhibit-sidecar-b2.webp
image: figures/exhibit-sidecar-b3.webp
- A1, the attempt already reverted, for contrast; then B1, B2 and B3. The question is subtle, and it is a real question: where a row of three links should live in a side panel. Each panel is below, one at a time.

### A1, the reverted attempt
image: figures/exhibit-sidecar-a1.webp
- The whole landmark header above the card: symbol, heading, every link, groups. Reverted because a card in a directory with no landmark fell back to the root's entire link set.

### B1, share the existing row
image: figures/exhibit-sidecar-b1.webp
- The links take the left half of a row the panel already has. No new row, the panel stays as tall as today; the links shorten to "+N" as the pane narrows.

### B2, its own line under the tabs
image: figures/exhibit-sidecar-b2.webp
- A full-width line for the landmark and its links, with room for later segments. Costs about 28 pixels of height on every landmarked card.

### B3, a chip that opens
image: figures/exhibit-sidecar-b3.webp
- Only the landmark's name in the row; the links live behind a caret. The quietest option, and the disclosure is where later context would open too.

## Letting the agent browse
comic: figures/perception.webp
span: 2026-05-20 — 2026-10-12
stats: browserCalls, browserSessions
kinds: process
events: all
- **Skills don't make the agent good at frontend work.** Seeing its work in place does: open the page, click, screenshot, change the code, look again.
- **Since May 27** an agent drives the app in a real browser from the command line. In the week of August 17: 1,569 browser calls in 45 sessions.
- **It takes a lot of tweaking.** The router seeds the sign-in cookie, a scripted transcription service, a fake model stream, dev-only routes that mount real components over fake services, fakes for Gmail, push, notifications.
- **Models got a lot better at vision recently,** so the screenshot half of the loop now works.
- **Exposed:** the loop tests what I point it at. What a person would do with the product, nobody was asking.

## Knowledge audits
comic: figures/polygraph.webp
span: 2026-02-26 — 2026-10-13
stats: auditPrompts
kinds: process
events: key
- **Tension:** I spent all this time documenting, but the agent sounds equally confident whether it uses the documentation or not.
- **Solution: knowledge audits.** Quiz the agent and see *how* it came to an answer, not just *if* it got the right answer. 421 prompts in the definitions today.
- **The goal:** the agent can find everything, without loading everything into context right away.
- **Nine levels of knowing,** written down so a failure has a name: knows directly, knows about, discoverable, deducible, researchable, guessable, improvised, knows it does not know, does not know. Guessable is the dangerous one: the answer sounds right and is the common default, not ours.
- **Exposed:** the same fact sits at a different level depending on what the agent is doing, because directory rules load only in context. Guidance has to be placed, not just written.

### The nine levels
- **1. Knows directly.** Already in context.
- **2. Knows about.** Knows where to look.
- **3. Discoverable.** Has to search.
- **4. Deducible.** Reads the code.
- **5. Researchable.** Only on the internet.
- **6. Guessable.** Sounds right, is wrong.
- **7. Improvised.** Builds its own way.
- **8. Knows it doesn't know.**
- **9. Does not know.**

## User journeys
comic: figures/journeys.webp
span: 2026-08-21 — 2026-10-13
stats: journeyWalks, journeyIssues
kinds: process, product
events: key
- **Tension:** I can't keep up with user testing, *and* I can't be objective.
- **Solution: a simulated person.** An agent pretends to be an actual user with a real task, knowing one sentence about the product and none of its vocabulary, and walks a fresh box in a real browser.
- **Requires lots of harness work and debugging.** The first bugs will be entirely about the harness.
- **Six people:** who has my stuff; I never know what I have got; reconnecting with people; teaching myself chemistry; the school schedule; what would I even use this for. 20 walks since August 23; 112 issues trace to a walk.
- **Too effective!** Produces more real bugs than you will know what to do with.

### The six journeys
file: beebox/docs/plans/user-story-journeys.md
lines: 19-67

## Scheduling sweep ups
comic: figures/sweeps.webp
span: 2026-08-24 — 2026-10-13
stats: schedules, scheduledCommits
kinds: process
events: key
- **Tension:** by August the process had grown reviews that nobody was running. Dead-code reports, the manual test suite, the browser tours, the SDK changelogs, the agent documentation: each went stale between the times I remembered it.
- **Schedules:** since August 24 one tick of the Mac's job scheduler runs every timed job. A schedule is a folder: a script that gathers and compares, and a prompt that holds the judgment. The script only decides whether anything changed; a script that reasons at 03:00 with nobody watching is wrong.
- **Two scales of problem:** some things are handled small, inside a plan. Some are holistic, like repeated code, and only show up when you look across the whole thing, so they have to run at a different scale and cadence.
- **Two shapes:** run-only, where the alert is the whole product, and handoff, where the script found work and an agent in its own worktree decides what to do about it. Fifteen schedules today, nine of them handoffs.
- **The reviews:** weekly dead-code sweep, supplemental lint, smoke-tier review, browser-tour check, manual-test triage, agent-docs refresh, cross-box leak scan; daily SDK watch; every three days, a retrospective that reads the feedback sessions left and turns it into guidance changes. Since October 7.
- **What came back:** 99 commits on main from scheduled sessions in seven weeks, 38 of them SDK updates and 19 dead-code removals. The retrospective has landed eight.
- **Exposed:** a schedule whose alerts nobody reads is noise on a cadence. Alerts open for a week now become issues on their own, which is the catch-up list again, one level up.

## Nothing stops mattering
comic: figures/recursion.webp
span: 2026-01-27 — 2026-10-13
stats: codebaseShare, commits
kinds: process, sweeps
events: key
- **The pattern so far:** each improvement relieves one limit and exposes the next. That is true, and it suggests the old limits are solved. They are not.
- **I still want new correctness requirements.** A second linter's warnings cleared in October; the scripts that run the process came under lint in August; a layout check before every commit arrived in September. Ten commits touched lint rules, hooks and checks this month.
- **I still refine what the agent thinks matters,** so it asks me only when it should. The four levels of "how much to do" are from October 8; the instruction files were edited 43 times this month, 102 in August.
- **I am still on the lookout for new things to be on the lookout for.** Skills measured against transcripts, a second engine's instructions reconciled with the first, and the question of what a question should look like, all this month.
- **So the talk is not a sequence of solved problems.** It is a stack. Everything in it is still running, and still being worked on.

### The share of my effort on the codebase, not the product, has grown
- **By my own estimate:** a quarter at the start, I was never lazy about it; a third soon after the monorepo; inching toward half now. And the product work that comes out the other side: more of it, and better.
- **Measured by commits:** under 10% most months through July, 27% in August, 33% in September, 34% in October.
- **The proxy:** each commit is product or codebase by the files it touched. Codebase is everything that serves the making of the product: scripts, instructions, skills, checks, the dev dashboard, plans.
- **My own estimate runs higher** because it is about head time. Commits undercount thinking, reviewing and deciding, which is most of what the codebase side takes from me.

## The End
span: 2026-02-01 — 2026-10-13
tagline: ianbicking.org · beebox.run · github.com/ianb/beebox
events: key
- Thank you.

## Appendix · The plan skill's discipline, as written
span: 2026-05-26 — 2026-10-13
- The section of the plan skill that sets how a plan is reviewed, verbatim.

### The discipline, as written
file: .claude/skills/bbx-plan/SKILL.md
lines: 56-85

## Appendix · Instructions regrow
span: 2026-08-25 — 2026-10-01
stats: instructionLines, docs
kinds: process, sweeps
events: all
- **Tension:** the file every session reads grew from 868 words to 2,204 between cuts, one rule per correction. The line that told the agent to improve its own instructions made it worse.
- **Solution:** the knowledge audit turned on the instructions: a pilot measured what sessions did against what the text said, then the September 12 rewrite: root cut to 850 words, the main package from 184 lines to 67.
- **Principle:** trimming needs a principled approach. A sweep first, then the principles on top. What that means in practice is still to work out.
- **Failed:** telling the agent to improve its own instructions. Instructions I trim by hand grow back; the one with a word budget does not.

## Appendix · Everything into subdirectories
span: 2026-09-18 — 2026-10-06
stats: totalDirs, dirMax, dirMean
kinds: sweeps
events: all
- **Tension:** the tree had stayed flat far too long. Everything sat beside everything else.
- **Solution:** September 24 to 27: documentation split into sections the way code is split into modules, then eight commits moving 154 to 736 files each. Directories went from 495 to 939 in a week.
- **Exposed:** moves broke code that found files by path, so a layout check now runs before every commit.

## Appendix · Measuring the instructions
span: 2026-09-28 — 2026-10-13
stats: skills, commits
kinds: process, sweeps
events: all
- **Tension:** with the machinery in place, the limit was what the agents were told, and I had no measurement of it.
- **Solution:** skills reviewed against transcripts; a lint on skill size; the rule that agent files only ever grow unless pruned; "go ahead" pinned to one of four meanings; one instruction file both agents read.
- **Next:** whatever this exposes.

## Appendix · Worktree isolation, v1
span: 2026-05-24 — 2026-06-15
comic: figures/clobber.webp
stats: commits, code
kinds: process, infrastructure
events: all
- **Tension:** I had stopped quizzing the agent on every detail. Runs got longer and more successful, and they started clobbering each other.
- **Solution:** each task in its own checkout, with a registry: spin up, tear down, resurrect later. A chat session holds context worth going back to, so I resume the session rather than start the feature over.
- **Limit:** sessions are private, so this is not a system for collaboration. The full version, with a dashboard, came in August.

## Appendix · Tests too slow for the commits
comic: figures/punchcards.webp
span: 2026-08-18 — 2026-09-05
stats: tests, testFiles
kinds: process, sweeps
events: all
- **Tension:** the full suite could no longer run at the pace commits landed; my computer could not keep up. Switching to selected tests let broken changes land: three in two days passed typecheck, lint, and their tests while the app was broken.
- **Solution:** a smoke test for the basics, tests selected for the change, and the full suite hourly on main.
- **Still open:** the hourly suite still caused a lot of problems.
