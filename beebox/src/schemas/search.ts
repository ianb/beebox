import { z } from "zod";
import { cardSchema } from "../cards/index.js";
import { SYSTEM_CARD_PATHS } from "../shared/system-card-paths.js";

const searchDefaultPath = z.string().min(1).refine((value) => !value.startsWith("/"), "paths must be box-relative");

export const SearchSchema = cardSchema("search", {
  description: "A copyable search interface with durable default filters.",
  category: "authored",
  searchable: false,
  fields: {
    paths: z.array(searchDefaultPath).max(32).optional(),
    types: z.array(z.string().min(1)).max(32).optional(),
    query: z.string().max(500).optional(),
    limit: z.number().int().positive().max(100).optional(),
  },
  instructions: `# Search card

The system Search card lives at ${SYSTEM_CARD_PATHS.search}. It is installed
by the host, but Search cards may be copied to create focused instruments.

The optional frontmatter fields are durable defaults: paths contains
box-relative path prefixes, types contains card types, query is an
initial query, and limit bounds the displayed results. They are not access
control; the live view may clear or narrow them. Live query and filter state
is view state, not card content. The card searches the box's current cards and
markdown through the host search index.`,
});

export interface SearchFields {
  paths?: string[];
  types?: string[];
  query?: string;
  limit?: number;
}
