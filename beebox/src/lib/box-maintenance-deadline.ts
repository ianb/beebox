/**
 * The time from which an owner that cannot defer (a deployment, a development
 * reload) ends chats that sit between turns with live background tasks. A
 * deferrable owner passes none, and its drain times out instead
 * (docs/implemented-plans/maintenance-live-tasks.md, Track 2).
 */
const END_BACKGROUND_TASKS_AFTER_MS = 60_000;

export function backgroundTasksDeadline(): string {
  return new Date(Date.now() + END_BACKGROUND_TASKS_AFTER_MS).toISOString();
}
