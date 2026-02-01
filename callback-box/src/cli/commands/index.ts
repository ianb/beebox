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
export { wakeupCommand } from "./wakeup.js";
export { answerCommand } from "./answer.js";
export { pullCommand } from "./pull.js";
export { trashCommand } from "./trash.js";
export { fetchNewsCommand } from "./fetch-news.js";
export { processNewsCommand } from "./process-news.js";
