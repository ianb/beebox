import { z } from "zod";
import { body, cardSchema } from "../cards/index.js";
import { SYSTEM_CARD_PATHS } from "../shared/system-card-paths.js";

export const BrowseSchema = cardSchema("browse", {
  description: "The canonical Browse interface card",
  category: "system",
  searchable: false,
  fields: { body: body(z.string()) },
  instructions: `# Browse card

The one Browse card lives at ${SYSTEM_CARD_PATHS.browse}.
The filename infers its type; no view property is needed. Open this existing
card instead of creating another instance. Its title and markdown body are
editable notes, available through source inspection. The instrument does not
render the body. Live UI state is not card content.

Do not delete or move this required card. Restore an accidentally removed card
from Git, or use a declared engine migration. Closing its tab is safe.
Browse uses directory and optional selected-file detail view state. Directory navigation never creates another Browse card or edits its body.`,
});
