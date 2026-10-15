# Lanes: the events behind the two-lane chart

Two lanes, four colors. The **code** lane holds process (blue) and sweeps (orange); the **product** lane holds features (green) and infrastructure (purple).

One section per kind, one line per event: `YYYY-MM-DD — label — detail`. The label is what the chart shows, under 30 characters; the detail is one or two plain sentences shown when the event is hovered or selected in the explorer. Trailing tags: ` #key` marks an event for the key layer in the explorer (the rest draw only in the all-events layer); ` #show=stat,stat` names the weekly stats the explorer's "show me" button brings up for the event (ids: tests, docs, code, commits, open, closed, testFiles, skills, instructionLines, skillLines, totalFiles, totalDirs). The generator `figures.ts` reads this file; run `node --import tsx dev/devprocess-talk/figures.ts` after editing. Dates and hashes are in [the timeline](timeline.md), [the inventory](inventory.md), and the sweep reports ([features](reports/sweep-features.md), [infrastructure and sweeps](reports/sweep-infra-and-sweeps.md)).

A sweep that produced a new rule appears under both sweeps and process; that overlap is the point. Kinds: **process** is how the agents are run and checked; **sweeps** are one-off cleanup campaigns across code or docs, including documentation restructuring; **product** is what a person using the app notices; **infrastructure** is what the product runs on and nobody sees.

## process

2026-02-13 — lint preset — I put one shared set of lint, formatting and strict type rules in a package every project uses. A wrong move by an agent now fails a check instead of passing quietly.
2026-02-17 — lint on every write — After each file an agent writes, the linter runs on it and the errors go straight back to the agent. Mistakes show up in seconds, which let me stop watching every edit. #key
2026-02-21 — frozen clock — Scenario tests start, and with them one rule: the app reads time from one function that an environment variable can pin, never from the system clock directly. 19 doctests freeze time today.
2026-02-26 — knowledge audits — A test prompts a real box agent, watches what it reads, and checks what it knew. 423 prompts today, and nine named levels of knowing. #key #show=instructionLines,skillLines
2026-03-02 — the stack, written down — In one day, 23 technology decisions in one document, each with the choice, the runner-up, the alternatives and why: 1,065 lines. The next two days adopted five of them. #key #show=code,commits
2026-03-03 — doctests; first instruction cut — Tests become Markdown documents an agent can read and run. The same day the main instruction file drops from 218 lines to 118, with area rules moved into files loaded only in their directory. #show=doctestCode,doctestProse,otherTestLines #key
2026-05-26 — monorepo, worktrees — Five repositories become one, and each task gets its own separate checkout with its own copy of the test data. Two agents in one tree had clobbered each other. This allows several sessions at once. #key #show=commits,code
2026-05-29 — the plan skill — A plan is designed end to end before implementation and ships as one piece. The template's sections are the failure modes; filling them is the review. 1,071 commits since name their plan. #key
2026-05-27 — browser agent — An agent can drive the app in a real browser from the command line: open a page, click, read it, take a screenshot. The loop of change, look, fix, look again is what made the agent good at frontend work; browser commits peak in August at 59, and in the week of August 17 agents made 1,569 browser calls in 45 sessions. #key #show=browserCalls,browserSessions
2026-05-31 — no-weakening rule for lint — Agents may not turn off or loosen a lint rule to make code pass. It went in the day the count of silently disabled violations hit zero, so it protects that result.
2026-06-04 — cross-model review — A second model family, Codex, reviews what Claude built before I look, because a model cannot catch blind spots it shares with itself. 216 commits mention it, and it has the most recorded catches. #key
2026-06-20 — craft skills — In one day I write five reusable instruction files: debugging, code health, frontend, context, and a vendored kit that writes skills, 1,300 lines of Markdown on its own. Most were retired by October because agents never reached for them. #key #show=skillLines,skills
2026-07-03 — headless finisher — Landing a branch on main moves to a background agent that merges, runs the checks and stops if it needs a human. The merge and test churn leaves the main chat. 659 merges have gone through it since. #key
2026-07-04 — issues tree; doc check — One file per issue replaces a single ideas file that had grown to 1,681 lines, so agents file problems as they go. A check on every docs commit ended skipping hooks on docs. #key #show=open,closed
2026-07-19 — catch-up list — Code was landing faster than I could try it, so I tag landed-but-untried work. That list is my catch-up queue. 35 items are open and 27 closed.
2026-08-04 — Codex as 2nd engine — I can launch OpenAI's Codex in the same kind of separate checkout as Claude, for review and for spare capacity when my Claude allowance is tight. It exposed a cleanup step that never fired, leaving ten checkouts. #key
2026-08-09 — workstreams; test ledger — A unit of work now outlives its checkout: checkouts are disposable and resumed on demand. A log of every test run lets me ask which tests have ever failed in a way that mattered. #key
2026-08-13 — dashboard — A dashboard lists every task in flight, since that list had lived only in terminal tabs, with each one's checkout, session and exhibits.
2026-08-15 — exhibits — An agent shows me its work as a page the app renders: labeled screenshots, a document, or a small page of its own, kept in a store that outlives the checkout. 187 exhibits and 784 screenshots since. #key #show=exhibitScreenshots,browserCalls
2026-08-22 — simulated users — An agent plays one person with one goal, knowing only "an AI-powered app for organising your life", and walks a fresh copy of the app. 74 issues trace to these walks. #key #show=open,closed
2026-08-24 — schedules; trailers — One tick of the Mac's job scheduler runs every timed job, replacing four hand-made ones. Each commit also gets a tag naming its task and plan, since a task had been only a name on a branch. #key
2026-10-07 — retrospective on a schedule — Every three days an agent reads the feedback other sessions left behind and turns it into guidance changes. Eight landed so far. #key
2026-08-25 — tests sized to change — Tests run only where the change reaches, a failing test is rerun once alone, and a job runs every test hourly on main. Full runs had been red for reasons the branch did not cause. #key #show=doctestCode,doctestProse,otherTestLines
2026-08-26 — smoke tier — Before a change lands, a two-minute walk through the real app. Three bad changes in two days had passed every check while the app was broken. It has run 517 times, 101 of them red.
2026-09-12 — calibration rewrite — I cut the root instruction file from 2,242 words to 850 and the package file from 184 lines to 67, after testing on four models what they did against what the text said. Earlier manual cuts had regrown. #key #show=instructionLines
2026-09-18 — alerts, digest — Timed jobs report through automatic warnings. Urgent ones interrupt me and the rest wait for one daily summary. The same problem had been reported three days running.
2026-10-10 — exhibits: show, do not ask — The question-and-answer form on every exhibit and the queue of unanswered ones are removed. An exhibit shows; questions go in chat. The finished notification opens the page, and one button brings up the session's terminal. #show=exhibitScreenshots
2026-10-07 — skills measured — A script counts which instruction files sessions actually use. Six were retired in a day, three added, and lines in skill files fell from a peak of 3,126 to 1,894. #key #show=skillLines,skills
2026-10-08 — do/land ladder — Four named levels, discuss, plan, do and land, set how much an agent may do, and my wording sets the ceiling. "Go ahead" had meant four different things.
2026-10-09 — AGENTS.md — All 20 instruction files are renamed so both Claude and Codex read them directly. The generated copies for Codex go away.

## sweeps

2026-02-25 — one color palette, 42 files — Ad hoc colors across the frontend are replaced by one systematic palette in a single commit.
2026-03-04 — tRPC migration complete — Every frontend component moves to typed tRPC hooks, 51 files in the closing commit.
2026-04-17 — UI primitives; semantic palette — A typed primitive library takes over appearance, and a lint rule confines page code to layout classes. Colors switch to a semantic palette the same day; 132 files over two commits.
2026-05-14 — Activities system removed — A whole subsystem is deleted in one commit of 46 files.
2026-05-22 — schemas to frontmatter; news deleted — Every card schema migrates to YAML frontmatter in 19 commits in one day, 236 files, and the news subsystem is deleted.
2026-05-27 — accessibility sweep — Three rounds driven by an axe-core tour: landmark roles, labels and accessible names across the app shell, 31 files.
2026-05-30 — fakes beside the real services — A fake chat model, a fake Drive and a fake speech service live in the product next to the real ones, so a test or a developer can run the app with no outside call. Nine more follow through October. #key #show=doctestCode,code
2026-05-30 — lint suppressions, 1,000 to 0 — Merging the repositories revealed about 1,000 silently disabled lint violations across 158 files. A cap that could only go down took them to zero in two days. #key #show=commits
2026-06-19 — old card parser deleted — I delete the old XML card-parsing package, 101 files, after notes moved to Markdown, along with a data migration for existing data stores.
2026-06-21 — doctests regrouped, 300 files — Every test document declares its language, 147 files, and 152 files move into subdirectories. The test runner now enforces the language tag.
2026-06-26 — user-story catalog — Agents read the source and list 413 things the product can do, then check each against the code and the running app. I annotate the result. It later seeded the simulated user walks.
2026-07-03 — knowledge audits rerun — I rerun the whole quiz of what the app's agents know, in nine batches. It found real gaps in the instructions they are handed, and I closed them.
2026-07-04 — docs reorg; one file per issue — I restructure the docs in eight tracks and sort plans by status, 165 files. The single ideas file splits into one file per issue. #key
2026-07-05 — architectural review — Seventeen scans of the codebase for structural problems, followed by a written engineering-principles document. Follow-up rounds added caps in the lint rules.
2026-07-10 — issues sorted into folders — 167 issue files are sorted into category folders with titles in their headers, so the issue browser can rely on the layout.
2026-08-03 — first skills review — The skill-writing kit and the prompt-review skill are deleted, the review procedure moved into a doc. Skill lines drop by a fifth; the next three skills written are for issues, doctests and knowledge audits. #key #show=skillLines,skills
2026-08-09 — frontmatter on 613 files — Plans and issues get a standard header block, applied to 613 files. A check now enforces it. #key
2026-08-24 — knip backlog 342 to 4 — A tool that finds unused code listed 342 unused exports. I cleared them down to 4 across 151 files, and a weekly timed job now keeps watch. #key
2026-08-25 — last .mjs to TypeScript — The last logic files in plain JavaScript and every lint config move to TypeScript. The rule now: a JavaScript file may only be a thin loader.
2026-08-28 — bin/ under lint — The scripts that run the process itself sat outside the lint rules. I brought them under the same rules and fixed the backlog across 133 files.
2026-08-30 — rename, 4,188 files — The product is renamed across 4,188 files, plus migrations for every machine's manifest. A check on every commit now blocks the old name. #key
2026-09-02 — UI vocabulary sweep — I align the words on the app's screens, such as chat and thinking, to one glossary across 33 files.
2026-09-04 — one-root paths, 527 files — A data store's layout collapses to a single root folder. 527 files that used the old paths are re-pointed in one pass.
2026-09-12 — instructions rewritten — The rewrite itself: I decided each instruction's purpose and where it belongs, then tested routing on four models. Total lines in skill files fell from 3,766 to 3,092. #key #show=instructionLines
2026-09-24 — docs restructured like code — Documentation areas are split into sections the way code is split into modules, with a hash check in each plan. Eight areas, from chat to media, were done over three days.
2026-09-27 — layout moves, 8 commits — Eight commits move 154 to 736 files each to fix where source files live. A layout check now runs before every commit, because path moves had broken code that computed paths at runtime. #key #show=totalDirs,dirMax,dirMean
2026-10-06 — oxlint warnings cleared — I clear the 21 standing warnings from a second linter across 17 files.
2026-10-07 — skills review — Usage counts from 60 days of transcripts drive the review: six skills retired, the largest ones halved, and 85 stale doc references fixed along the way. #show=skillLines,skills
2026-10-08 — migrations retired, 133 files — Every data migration for existing data stores is retired, 133 files, once every store had converged to the current shape.
2026-10-09 — CLAUDE.md to AGENTS.md — The sweep behind the rename touches 355 and 321 files across the repository. A check now fails on any leftover CLAUDE.md, because one stray file makes Claude skip every AGENTS.md. #key

## product

2026-01-28 — cards in a git repo — Notes are stored as typed text files with fields, links and validation, in a git repository. Everything else in the product builds on this. #key
2026-02-01 — daily news brief — An agent reads feeds each day and writes a curated edition with excerpts and sources. It was the first real workflow.
2026-02-07 — Chrome extension — A popup and side panel save the current page into your notes. Saving to the brief and page capture followed within the next week. #key
2026-02-17 — Gmail, Calendar — Email threads become notes, and Google Calendar syncs in. Calendar later gained two-way edits.
2026-02-24 — talk to the box — Live speech-to-text in chat, then spoken replies and turn-taking, so you can talk to your notes. #key
2026-03-06 — capture page — A page that records audio and takes photos straight into your notes. Full-resolution photos and retries followed in March. #key
2026-03-19 — agent-written views — Agents write small interface pages that you open in the app.
2026-04-14 — images, files in chat — You can paste or drop images into chat, and upload files into capture and then into chat.
2026-04-19 — activities — Guided, reusable sessions with their own chat screen. A language-practice session shipped first.
2026-05-04 — landmarks — A curated set of entry points to your notes, each with its own linked chats. #key
2026-05-13 — narration mode — You dictate while the app listens and answers with short acknowledgments. A higher-accuracy transcript is swapped in afterward. #key
2026-05-22 — cards become Markdown — Notes change from XML to readable Markdown with a header block. #key
2026-06-09 — full-text search — Search across all your notes, from the command line first. Quick search from anywhere came later. #key
2026-06-15 — clipper with commentary — The web clipper keeps a frozen copy of the page along with your own commentary, and a chip jumps to the quoted passage.
2026-06-23 — figures; courseware — Interactive diagrams and sketches embed in notes and chat. Courseware adds concept maps, lesson plans and a skill that builds a course.
2026-07-06 — iOS app — A native iPhone companion app. Secure pairing followed the next day, and offline capture with background uploads on July 17. #key
2026-07-31 — chats grouped by place — The chat history groups by landmark, the first of many reworkings of how you get around: a place chip and switch menu in the top bar on August 2, a way back to chat on August 23, important cards first in September, arrival at a landmark in October. #key
2026-07-15 — publishing — You can put selected notes on the web as a static site, with a scan that stops private content leaking, and account tiers. #key
2026-07-19 — password login — Password login and first-run setup, with authentication on by default.
2026-08-06 — invites — You can invite other people to your data store and manage invites and passwords in the app.
2026-08-17 — secrets manager — API keys and credentials move into one machine-level store, with an Admin section and per-agent grants. #key
2026-08-30 — renamed Bee Box — The product gets its name, Bee Box. Until then it carried a working name. #key
2026-09-08 — card themes — Paper surfaces and themed card workspaces in chat change how notes look. #key
2026-09-10 — resilient voice — Voice recordings upload in pieces, survive disconnects, and get a late high-accuracy correction. #key
2026-09-21 — quick chat — A fast, lightweight path for short thoughts that captures and routes them, using a small model.
2026-10-05 — spoken replies stream — Spoken replies start playing as they are generated, with a clear error when speech fails. Voice had been reworked every month since February: 959 commits mention it.
2026-10-06 — box home — A home page for each data store on the web, and later on iOS. #key
2026-10-08 — theme sets — Ten theme collections, seven material-inspired and three expressive, with composition and material controls.
2026-10-10 — plugins — Installable extensions for a data store. The first slice moves a set of note tags and the recipe type out of the core and into a plugin. #key

## infrastructure

2026-01-28 — schema registry — A registry validates every note against its type when it loads.
2026-02-21 — job reactor — Queued work stored as notes is picked up and run in the background, so the app works through inbox items and questions on its own.
2026-02-24 — one server, many boxes — One server process serves several data stores. Scripted work auto-commits with tags recording its origin. #key
2026-02-25 — Cloudflare tunnel — The server runs behind a Cloudflare Tunnel, with trusted proxy headers and no wildcard cross-origin access.
2026-02-28 — Google sign-in — Google sign-in gates access to the cloud-hosted server, and deploy scripts provision that server.
2026-03-03 — tRPC API layer — Frontend and server share one typed API layer. All frontend calls had moved over by the next day. #key
2026-03-04 — Git LFS for media — Audio and image files are tracked with Git LFS. git-annex replaced it in September.
2026-03-08 — SQLite event bus — Events between parts of the app move onto an event bus backed by SQLite.
2026-03-30 — central OAuth tokens — Google sign-in tokens are stored centrally, with a per-data-store service policy.
2026-04-12 — git lock collisions — A fix for lock collisions on git's index file, caused by Git LFS post-commit hooks. It was the first of a long line of git-locking fixes.
2026-05-16 — attach manifests — A scheme of manifests tracks large files by walking directories. It was replaced in September.
2026-03-10 — browser log to the server — The web app forwards console errors and warnings to the server, into a rolling log file per box, so a bug on a phone leaves a record an agent can read. The iOS app forwards into the same file from August. #key #show=code
2026-05-22 — cards to Markdown — Storage moves from XML to Markdown with YAML headers, and a dispatcher reads both formats during the move. #key
2026-05-31 — pnpm workspace — The merged repository switches from file-path dependencies to a pnpm workspace. #key
2026-06-08 — WebSocket transport — Chat and events move to a WebSocket transport on the same API layer.
2026-06-21 — agent-applied migrations — A migration of existing data can be a checklist an agent follows instead of a script.
2026-06-28 — schema hot reload — Note types specific to one data store reload in the running server without a restart.
2026-06-30 — content security policy — An app-wide Content-Security-Policy, first set to only report violations to a log.
2026-07-02 — REST into tRPC — Remaining REST routes are folded into the typed API layer.
2026-07-04 — hub; boxes as packages — Many data stores run behind one hub that handles login, and stores become installable packages. #key
2026-07-12 — Docker image — The server ships as a Docker image with a compose file and an entrypoint. #key
2026-07-19 — auth on by default — Local password login with first-run setup and a login throttle makes authentication on by default.
2026-08-12 — scroll trace by flag — A flag in the composer records every scroll event and reconcile cycle on a phone and flushes it through the browser log, numbers only, for a feel bug no devtools could reach.
2026-08-15 — Codex SDK backend — Codex runs in chat through its official SDK, beside Claude.
2026-08-17 — secrets store — A machine-level secrets store with a resolver, and every connector reads its keys from it. #key
2026-08-18 — box git lock — A lock serializes everything that writes to a data store's git repository, so two writers cannot collide on its index.
2026-08-19 — migrations on deploy — Pending data migrations now apply automatically on deploy.
2026-08-23 — connector sync isolation — A connector whose sync fails no longer stops the others.
2026-09-04 — one-root box layout — A data store's layout collapses to one root folder, with a conversion for existing stores. The separate package root no longer exists. #key
2026-09-14 — git-annex replaces LFS — Large media moves from Git LFS to git-annex, replacing the manifest scheme too. New stores are created annex-shaped. #key
2026-09-17 — host packages via root wrapper — Agents inside a data store can install system packages through a wrapper that runs as root.
2026-09-18 — maintenance page on deploy — A maintenance page is served while production restarts, and deploy timings are recorded.
2026-09-26 — push delivery channels — Push-notification delivery channels for iPhone and web, with their key setup.
2026-10-10 — plugins: tags move out — Four core note tags and the recipe type move into a plugin, and a migration retires the core tags from all notes.
