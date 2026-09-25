---
description: "Bee Box capability areas, one line each, and the kinds of cards a box holds."
---
# What it can do

A **card** is one file with a structured header that gets checked against
its type; a **box** is the directory of them. One page per capability is in
[capabilities/index.md](capabilities/index.md).

## Capability areas

- [Gmail](capabilities/gmail.md): sync watched threads in, draft replies you send yourself.
- [Calendar](capabilities/calendar.md): two-way Google Calendar sync.
- [Drive](capabilities/drive.md): mirror Google Docs, Sheets, and folders both ways.
- [Telegram](capabilities/telegram.md): chat with the box from a messaging app.
- [The web interface](capabilities/web-interface.md): dashboard, browser, questions, map, history, settings, and a display for each kind of card, on desktop and phone.
- [Chat](capabilities/chat.md): the central web conversation, with resumable threads.
- [Voice](capabilities/voice.md): dictation, transcription, and spoken replies.
- [Phone capture](capabilities/phone-capture.md): record, photograph, and upload from a phone.
- [Triage](capabilities/triage.md): classify and file what arrives, with confidence levels.
- [Questions](capabilities/questions.md): the agent asks instead of guessing.
- [Schedules](capabilities/schedules.md): recurring runs and agent-set timers.
- [Procedures](capabilities/procedures.md): declarative multi-step workflows.
- [Dump it in now, shape it later](capabilities/shape-it-later.md): put things in before deciding their structure; what does not fit stays in your words and can be reshaped later.
- [It keeps itself coherent](capabilities/integrity.md): links parsed and checked, references rewritten on a move, cards validated at several layers, so the box stays navigable as it grows.
- [Provenance](capabilities/provenance.md): your exact words kept as quotes, and facts that point back at their source.
- [Views](capabilities/views.md): pages and displays the agent builds for a kind of card, so a collection becomes something to browse.
- [Courses](capabilities/courses.md): structured teaching material and per-learner progress.
- [Recipes](capabilities/recipes.md): scaling-aware cooking cards.
- [Publishing](capabilities/publishing.md): put selected box content on the public web.

## The kinds of things it holds

Every card type has a reference page in
[reference/cards/index.md](reference/cards/index.md).

- Inputs: memo, image, audio, capture-session, upload-batch, file, pdf.
- Web material: webpage, extfile, commentary, tab-arrangement.
- Things you keep: record, doc, person, place, recipe, inventory, figure, todo-view.
- Mail and messages: email-thread, email-message, email-outbound, telegram-message, chat-thread, feedback.
- Google material: gdoc, gsheet, gfolder, glink.
- Teaching the agent: briefing, guide, personality, landmark, question.
- Automation: procedure, procedure-run, scheduled-script, and the job cards the engine queues.
- Learning: course, concept-map, exposition-plan, lesson-plan, progress.
- The interface itself: dashboard, settings, browse, questions, landmarks, history, admin, view, nav.

A box can also define its own card types. See
[making it yours](13-making-it-yours.md).
