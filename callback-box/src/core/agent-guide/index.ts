/**
 * Compose the compact agent guide (`.callback-box/agent-guide.md`,
 * always loaded into context via @-include).
 *
 * Each section is a small file in this directory; the orchestrator below just
 * concatenates them in the order they appear in the rendered guide. Adding or
 * editing prose: pick the right section file. Adding a section: write a new
 * file and slot it into the array below.
 */

import type { CardSchema } from "../../cards/index.js";
import { cardSchemas } from "../../schemas/registry.js";
import type { ProcedureSummary, GuideSummary } from "../generate-docs.js";

import { directoryLayoutSection, howItemsEnterSection } from "./box-shape.js";
import { keyCommandsSection } from "./commands.js";
import { locationSection } from "./location.js";
import {
  proceduresSection,
  guidesSection,
  schedulesSection,
  tricksSection,
} from "./extensibility.js";
import {
  externalToolsSection,
  chatAttachmentsSection,
  selectionsSection,
  viewsSection,
} from "./chat.js";
import {
  aboutCardsSection,
  cardTypesSection,
  questionsSection,
} from "./cards.js";
import {
  generalPrinciplesSection,
  gitHistorySection,
  whereToRecordSection,
} from "./behavior.js";
import { landmarksSection } from "./landmarks.js";
import { secretsSection } from "./secrets.js";
import { lawsSection } from "./laws.js";
import { quotesSection } from "./quotes.js";
import { sourceSection } from "./source.js";
import { searchSection } from "./search.js";
import { briefingTagsSection } from "./briefing-tags.js";

export interface AgentGuideOptions {
  procedures: ProcedureSummary[];
  allCardSchemas?: CardSchema[];
  personalitySection?: string | undefined;
  guides?: GuideSummary[];
}

export function generateAgentGuide(options: AgentGuideOptions): string {
  const {
    procedures,
    allCardSchemas = cardSchemas,
    personalitySection,
    guides = [],
  } = options;

  const lines: string[] = [
    "# Callback Box Agent Guide",
    "",
    ...lawsSection(),
    ...aboutCardsSection(),
    ...cardTypesSection(allCardSchemas),
    ...questionsSection(),
    ...directoryLayoutSection(),
    ...landmarksSection(),
    ...howItemsEnterSection(),
    ...keyCommandsSection(),
    ...searchSection(),
    ...locationSection(),
    ...proceduresSection(procedures),
    ...guidesSection(guides),
    ...schedulesSection(),
    ...tricksSection(),
    ...secretsSection(),
    ...externalToolsSection(),
    ...chatAttachmentsSection(),
    ...selectionsSection(),
    ...viewsSection(),
    ...quotesSection(),
    ...sourceSection(),
    ...briefingTagsSection(),
    ...generalPrinciplesSection(),
    ...gitHistorySection(),
    ...whereToRecordSection(),
  ];

  if (personalitySection) {
    lines.push(personalitySection);
  }

  return lines.join("\n");
}
