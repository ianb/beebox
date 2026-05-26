/**
 * Compose the compact agent guide (`.callback-box/agent-guide.md`,
 * always loaded into context via @-include).
 *
 * Each section is a small file in this directory; the orchestrator below just
 * concatenates them in the order they appear in the rendered guide. Adding or
 * editing prose: pick the right section file. Adding a section: write a new
 * file and slot it into the array below.
 */

import type { ElementSchema } from "cardworks";
import { schemas } from "../../schemas/registry.js";
import type { ProcedureSummary, GuideSummary } from "../generate-docs.js";

import { directoryLayoutSection, howItemsEnterSection } from "./box-shape.js";
import { keyCommandsSection } from "./commands.js";
import { calendarSection } from "./calendar.js";
import { driveSection } from "./drive.js";
import {
  proceduresSection,
  guidesSection,
  schedulesSection,
  tricksSection,
} from "./extensibility.js";
import {
  externalToolsSection,
  chatAttachmentsSection,
  viewsSection,
} from "./chat.js";
import {
  cardTypesSection,
  creatingCardsSection,
  questionsSection,
} from "./cards.js";
import {
  generalPrinciplesSection,
  gitHistorySection,
  whereToRecordSection,
} from "./behavior.js";
import { landmarksSection } from "./landmarks.js";

export interface AgentGuideOptions {
  procedures: ProcedureSummary[];
  allSchemas?: ElementSchema[];
  personalitySection?: string | undefined;
  guides?: GuideSummary[];
}

export function generateAgentGuide(options: AgentGuideOptions): string {
  const {
    procedures,
    allSchemas = schemas,
    personalitySection,
    guides = [],
  } = options;

  const lines: string[] = [
    "# Callback Box Agent Guide",
    "",
    ...directoryLayoutSection(),
    ...landmarksSection(),
    ...howItemsEnterSection(),
    ...keyCommandsSection(),
    ...calendarSection(),
    ...driveSection(),
    ...proceduresSection(procedures),
    ...guidesSection(guides),
    ...schedulesSection(),
    ...tricksSection(),
    ...externalToolsSection(),
    ...chatAttachmentsSection(),
    ...viewsSection(),
    ...cardTypesSection(allSchemas),
    ...creatingCardsSection(),
    ...questionsSection(),
    ...generalPrinciplesSection(),
    ...gitHistorySection(),
    ...whereToRecordSection(),
  ];

  if (personalitySection) {
    lines.push(personalitySection);
  }

  return lines.join("\n");
}
