/**
 * CLI command registry.
 *
 * All commands are exported from here for the main CLI to use.
 */

export { initCommand } from "./init.js";
export { statusCommand } from "./status.js";
export { validateCommand } from "./validate.js";
export { createCommand } from "./create.js";
export { contextCommand } from "./context.js";
export { serveCommand } from "./serve.js";
export { answerCommand } from "./answer.js";
export { wakeupCommand } from "./wakeup.js";
export { trashCommand } from "./trash.js";
export { moveCommand } from "./move.js";
export { fetchNewsCommand } from "./fetch-news.js";
export { fetchAllNewsCommand } from "./fetch-all-news.js";
export { processNewsCommand } from "./process-news.js";
export { processFeedbackCommand } from "./process-feedback.js";
export { triageFeedbackCommand } from "./triage-feedback.js";
export { procedureCommand } from "./procedure.js";
export { initRulesCommand } from "./init-rules.js";
export { transcribeCapturesCommand } from "./transcribe-captures.js";
export { assembleTimelineCommand } from "./assemble-timeline.js";
export { googleAuthCommand } from "./google-auth.js";
export { calendarCommand } from "./calendar.js";
export { finishCommand } from "./finish.js";
export { reactorCommand } from "./reactor.js";
export { scenarioCommand } from "./scenario.js";
export { tickCommand } from "./tick.js";
export { scheduledCommand } from "./scheduled.js";
export { trickCommand } from "./trick.js";
export { finalizeCommand } from "./finalize.js";
export { promptCommand } from "./prompt.js";
export { sessionCommand } from "./session.js";
export { schedulerCommand } from "./scheduler.js";
export { lsCommand } from "./ls.js";
export { renderCommand } from "./render.js";
