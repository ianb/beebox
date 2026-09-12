import { z } from "zod";
import { body, cardSchema } from "../cards/index.js";
import { SYSTEM_CARD_PATHS } from "../shared/system-card-paths.js";

export const HistorySchema = cardSchema("history", {
  description: "The canonical History interface card",
  category: "system",
  searchable: false,
  fields: { body: body(z.string()) },
  instructions: `# History card

The one History card lives at ${SYSTEM_CARD_PATHS.history}. Its filename infers
its type; no view property is needed. Open it for the default History entrance.
Authored saved filters remain plural view cards. The editable body holds notes,
not live filter or selected-commit state. Open History with this card target and
validated view state, not a separate page. Legacy query values resolve per key
over authored defaults, which override canonical defaults. An explicit view-state
filter replaces that resolved filter. A missing filter uses the card's defaults;
an explicitly empty filter means no filtering. A missing commit
selects the newest match, while a null commit stays on the timeline. Reset returns
to the opened card's saved or canonical defaults. A session inside the History
filter does not select a chat recipient. Restore a removed canonical card from
Git or with the declared engine migration.`,
});
