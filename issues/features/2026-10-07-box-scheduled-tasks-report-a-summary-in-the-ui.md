---
title: "Box scheduled tasks end with a task-specific summary the boxholder sees in the UI"
workstream: unattached
area: beebox
labels: [schedules]
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: main — chat-review run on a box showed no visible result
---

On 2026-10-07 the boxholder ran the chat-review scheduled task on a box and
saw nothing happen: no titles appeared, and nothing said why. The run had
done its work. Its summary ("reviewed N session(s), N titled, N below
threshold", `beebox/src/cli/commands/chat/review.ts`, `describeSummary`) went
only to the command's output, which no UI shows. On another box, `bbx chat
review status` showed why most chats were skipped (20 below the title
threshold, 4 with too few user turns, 11 with no transcript), and none of
that is visible to the boxholder either.

Box schedules (`scheduled-script` cards under `_config/schedules/`, run by the
box scheduler) record only machine-local timing
(`beebox/src/core/schedule/state.ts`: `lastRun`, duration). `bbx health`
surfaces failing, overdue, and blocked tasks
([scheduled task health surfacing](../closed/features/2026-05-19-scheduled-task-health-surfacing.md)),
but a task that runs and succeeds says nothing about what it did.

## Wanted

Every scheduled task run ends with a **summary written by the task itself**,
and the boxholder can see it in the UI.

- **Task-specific content.** The task decides what its summary says: chat
  review reports sessions reviewed, titled, and skipped by reason; a sync
  reports items fetched; todo review reports what it changed. The framework
  carries the summary; it does not invent it.
- **A small, common shape** so the UI can render any task: a one-line
  headline, an outcome (did work, nothing to do, partial, failed), optional
  counts or a short Markdown body, and links to what changed (cards, chats).
- **Where it appears:** on the task's schedule card page as a run history
  (latest first), and somewhere the boxholder already looks for a run they
  started by hand ("Run now" should show its result when it finishes).
  Whether routine successes also reach a digest or notification is a
  question; failures already have health.
- **Script tasks and agent tasks.** A `runs:` command (like `bbx chat review
  run`) needs a way to emit its summary (structured stdout, a summary file,
  or a `bbx` call); an agent-run task needs an instruction to end with one.
  Existing `bbx notify` and callouts
  ([agent outcomes need a voice](../closed/features/2026-08-09-agent-outcomes-need-a-voice.md))
  are the related mechanisms for agent turns.

## Questions

- Storage: summaries are per-box run history. Machine-local like timing, or
  committed so they survive and travel with the box? Retention.
- The dev monorepo's `bin/schedules` already has an alert/done reporting
  contract (`bin/docs/schedules.md`); reuse its ideas, not necessarily its
  code.
- First adopters: chat review (the trigger for this issue), todo review, and
  connector syncs.
