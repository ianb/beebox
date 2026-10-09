# Edi Life OS vs Bee Box

*Reviewed 2026-10-08 from the repository at https://github.com/edrisranjbar/lifeos (commit `Add MIT license`, same day). A dated snapshot of both systems; not maintained as our code evolves.*

## What it is

A single-owner, self-hosted "life OS": ten workspaces (Overview, Growth, Focus, Finance, Habittify, Kanban, Calendar, Goals, Notepad, sticky Notes) in one PHP + MySQL + vanilla-JS app that runs on shared hosting. One author, 41 commits since 2026-09-05, 22 stars, 2 forks. The license is MIT as of 2026-10-08; the earlier "no license" reading is out of date, so code reuse is now allowed, though nothing here is worth copying as code. Dates are fixed to Asia/Tehran and money to Toman. A leftover build script at the repository root names a `Documents/ChatGPT/Edi Life OS` working directory, and the docs read as model-written; treat the prose claims as a spec the author intended, then check the code, which is what this note does.

Storage is one `app_state` table of JSON documents, one row per workspace (`edi_goals_v1`, `edi_growth_v1`, `edi_obligations_v1`, Kanban, notes, finance periods), written with compare-and-swap revisions so a stale browser tab gets a 409 instead of overwriting an API write. Habits alone get real tables (`habits`, `habit_logs` with a unique habit+date key).

## The MCP server

`mcp/` is a 150-line Node stdio server built on the official SDK. Every tool is a thin proxy to `/api/v1` with one bearer token that has read and write access to everything; there are no scopes, no resources, no prompts. The 26 tools cover goals (CRUD), tasks (CRUD + complete, over both goal checklists and Kanban cards), habits (list, today, complete, uncomplete by date), finance (summary, expenses, incomes), notes (CRUD), and one `lifeos_dashboard` that returns counts: active/completed/overdue goals, open/overdue/due-today tasks, habits done today, income and expense totals, five recent note previews.

What the assistant can do through it: log a habit for a date, create a SMART goal with measures and checklist tasks, move a Kanban card to Done, log an expense, write a note. What it cannot do: see or run a Life Review, read the Growth dimensions, see the productivity score, or see any financial commitment. The two most recent and most "connected" features, Growth (`docs/growth.md`) and debts/credits (`docs/financial-commitments.md`), both state "no dedicated MCP tool has been added". The tool surface already lags the app by two features after one month.

The client hardening is the best code in the repository and worth a look if Bee Box ever exposes an MCP server (`mcp/src/client.js`): HTTPS required except localhost, URL credentials and query strings rejected, redirects rejected so the token cannot be forwarded, non-JSON responses refused so a login page never enters the model context, the token string redacted from every response, and every tool annotated with `readOnlyHint`, `destructiveHint`, `idempotentHint`.

## The connections

"Connected, not just collected" resolves to three mechanisms.

- **Habit drives goal progress.** A goal has `progressSource: checklist | measure | habit`. For `habit`, progress is `COUNT(DISTINCT log_date)` for one habit inside the goal's start/deadline window, divided by `habitProgress.targetDays`, capped at 99% until the target is met (`lib/goals.php`). Attendance lives only in `habit_logs`; the goal stores the link and the target, never a copy of the count. Undoing a check-in lowers the progress.
- **Growth dimensions.** Six fixed dimensions (Religion & Spirituality, Health, Relationships & Family, Finance, Self Growth, Fun & Rest). A "plan" is a long-term goal in one dimension with `goalIds[]`, `habitIds[]`, `taskKeys[]` pointing at records in the other workspaces. Indicators per dimension are computed client-side on load: mean SMART progress of linked goals, 7-day habit consistency, linked tasks done. The growth doc explicitly refuses to compute a composite: "These indicators are not a wellbeing score. No composite life percentage is invented."
- **Calendar.** Kanban cards with due dates and derived financial dues appear in one month grid.

The Overview then invents exactly the composite the growth doc refuses. The productivity score (`public_html/assets/dashboard.js`) is the mean of the nonzero members of four percentages: today's focus minutes over a 90-minute target, 7-day habit completion average, mean goal progress, and share of Kanban cards in Done. Zero components are dropped from the mean, so a day with no focus time and no habits scores the same as one where those were perfect, as long as goals and cards are unchanged. It gets a grade word ("Exceptional", "Strong", "Steady", "Building", "Starting", "Warming up") and a "vs last week" delta computed with goals forced to zero on the prior side. It is decoration.

## The guided reviews

A Life Review is an eight-step modal: pick a cadence (weekly, monthly, quarterly), one step per dimension, a summary step, save. Each dimension step shows the computed indicators, the previous review's "next step" for that dimension, and two text boxes: a reflection (placeholder "A small win, an honest observation…") and a next step ("What will you do next?"). At least one box across all six must be filled. Saving stores the cadence, date, the two strings per dimension, and an immutable numeric snapshot of the indicators. A cadence is due on a rolling interval from the last review of that cadence (7, 30, 90 days); there are no reminders. A "share as image" export shows scores only.

That is the whole of "guided". The two durable ideas inside it are that the previous next step is placed in front of you when you write the next one, and that the snapshot is frozen at save time so history does not drift when source records change.

## Data model summary

| Thing | Fields |
| --- | --- |
| Goal | title, specific, category, relevant, priority, startDate, deadline, notes, status (active/archived), measures[{metric, target, current, unit}], tasks[{title, done, dueDate, priority}], progressSource, habitProgress{habitId, targetDays} |
| Habit | name, category, color, icon, archived; log rows (habit_id, log_date, done) |
| Growth plan | dimensionId, title, why, targetDate, status (active/achieved/archived), goalIds[], habitIds[], taskKeys[] |
| Review | cadence, date, notes[dimension]{reflection, next}, snapshot[dimension]{goalPct, habitPct, taskPct, counts} |
| Commitment plan | title, payee, direction (debt/credit), type (one-time / recurring same amount / split total), optional, amount or totalAmount+count, startDate, endDate, frequency, interval (1–12), cancelFrom |

Commitments are the most carefully built part. Due occurrences are never stored; they are derived on read from the plan, with stable ids `planId:index`, and a `decisions[occurrenceId]` map holds paid/rejected/restored state plus a link to the ledger expense it created. Paying a due and appending the expense happen in one transaction. Amounts and dates are immutable after creation; new terms mean stop the old plan from a date and create another.

## Bee Box today, for contrast

- **No habits, goals, streaks, finance, Kanban, or focus timer.** Card types are listed in `beebox/src/schemas.ts`; none cover these. Todos are inline tags or a frontmatter list with status, due, start and recheck, no recurrence, no priority (`beebox/src/shared/todo-model.ts`).
- **Reviews are the agent reviewing itself.** The Monday retro reads chat transcripts and updates personality and guide beliefs (`beebox/templates/procedures/process-retrospective.procedure.card`). The daily todo-review sweeps stale todos. There is no user-facing weekly review.
- **The dashboard is operations**, not a life view (`beebox/src/frontend/src/pages/DashboardPage.tsx`): questions, inbox, schedules, recent activity. The architecture doc rules out an app home screen (`beebox/docs/architecture/01-what-is-this.md`).
- **The agent lives inside the box** with filesystem access to every card (`beebox/src/services/claude-chat/core.ts`). Bee Box neither exposes nor consumes MCP; the outside-agent question is open in `issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md`.
- **Prior art in our own queue:** a goals layer is already the top "adopt" from the PAI review (`research/pai/telos.md`); a family-accountability goal with chat check-ins is in `issues/features/2026-03-12-accountability-goal-tracking.md`; "no bank or card data" is a boxholder scope decision recorded in `issues/features/2026-09-25-agent-maintained-ideas-page.md`.

## In-box agent vs MCP bolted onto an app

Life OS shows the cost of the bolted-on shape concretely. The assistant sees only what someone wrote a tool for, and the tool set already misses Growth, reviews, commitments and the score. Every feature needs the UI, an API domain, a Zod tool, and docs, so the author shipped the last two features without any. The assistant also gets no history: `app_state` holds the current document only, so "what changed since my last review" is unanswerable through the API, while the Growth UI fakes it with frozen snapshots.

Bee Box's agent reads the cards, the git history, and any box-local schema a boxholder adds, with zero integration work per feature. That is the gain. The cost is the mirror image: nothing outside the box can reach it, so the boxholder's own Claude Desktop or a laptop Claude Code session cannot "ask the box what is due". That is exactly the open box-as-MCP-server issue, and Life OS's client is a usable reference for how to harden such a server when it is built.

## Dispositions

| Idea | Disposition | Trace |
| --- | --- | --- |
| MCP server as the agent's interface to the app | **Reject.** Bee Box's in-box agent is the better bet; Life OS's lagging tool surface is the evidence. | `beebox/src/services/claude-chat/core.ts`; `beebox/docs/reports/stack-decisions-2026-09-04.md` |
| MCP client hardening (redirect refusal, non-JSON refusal, token redaction, tool annotations) | **Later.** Reference material for the day Bee Box exposes an MCP server. Pointer added to the issue. | `issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md` |
| Goal progress derived from dated check-ins, stored once, never copied into the goal | **Adapt.** This is the one mechanism worth taking. A goal card names a check-in source and a target count over a window; the agent or a view computes progress from the records. Folded into the accountability issue. | `issues/features/2026-03-12-accountability-goal-tracking.md`; `research/pai/telos.md` |
| Weekly review that shows last week's "next step" and freezes a snapshot | **Adapt**, as a scheduled procedure that opens a conversation, not a six-pane form. Same issue. | `beebox/templates/procedures/process-retrospective.procedure.card`; `beebox/docs/chat/schedules.md` |
| Six fixed life dimensions | **Later.** A taxonomy question for the telos work; PAI's state files already cover the same areas. | `research/pai/telos.md` |
| Daily productivity score and grade words | **Reject.** Mean-of-nonzero is misleading, the app's own growth doc argues against it, and dashboards of this kind are what people abandon. | `research/collection-use-cases-2026-09-19.md`; `beebox/docs/architecture/01-what-is-this.md` |
| Finance ledger, budgets, debts and credits | **Reject** as a feature; bank-free manual entry does not change the scope decision. The derive-occurrences-on-read pattern (plan plus `decisions[occurrenceId]`) is worth remembering if todos ever gain recurrence. | `issues/features/2026-09-25-agent-maintained-ideas-page.md`; `beebox/src/shared/todo-model.ts` |
| Kanban, Pomodoro, sticky notes, weather | **Reject.** Generic app features with no box angle. | |

## Is "life OS" a target use case?

No, not as framed. "Habits + goals + reviews" is served by dozens of products, including this one, and the collection-use-cases evidence is that people abandon habit trackers and dashboards within months. It fails the "underserved" criterion in `issues/decisions/2026-10-05-target-specific-underserved-use-cases.md`.

The narrower variant already in the queue does fit: one goal, check-ins by chat or Telegram, a family group that sees the end-of-day result, and a scheduled weekly conversation that carries last week's next step forward. That uses what the box does (chat, connectors, schedules, private household data) and has no clean product serving it. It belongs on the candidate list for that discussion, which this note adds.

## Follow-ups

- Amended `issues/features/2026-03-12-accountability-goal-tracking.md` with the two mechanisms above and this note as the source.
- Added a reference pointer to `issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md`.
- Added the accountability variant as a candidate in the target-use-cases decision.

Nothing here changes Bee Box's direction. It confirms the in-box agent bet and gives the already-planned goals layer one concrete mechanism.
