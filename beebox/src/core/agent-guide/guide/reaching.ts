/**
 * The default "Reaching me" briefing section, quoted for the guide's
 * REACHING_THE_BOXHOLDER section (guide.md, placeholder `{{reaching_default}}`).
 * The policy of when and how loud lives in the root briefing; a box whose
 * briefing predates that section reads this default. See docs/notifications.md.
 */

import { REACHING_ME_DEFAULT, REACHING_ME_HEADING } from "../../../schemas/briefing.js";

/** The default briefing section as a blockquote, so its heading does not split the guide section. */
export function reachingDefaultQuote(): string {
  return REACHING_ME_DEFAULT.split("\n")
    .map((line) => (line === "" ? ">" : `> ${line === REACHING_ME_HEADING ? "**Reaching me.**" : line}`))
    .join("\n");
}
