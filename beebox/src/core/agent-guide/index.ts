/**
 * Compose the agent guide (`.beebox/agent-guide.md`, always loaded into
 * context via @-include) from its hand-written source, `guide.md`.
 *
 * The prose lives in `guide.md`; this file maps each placeholder there to the
 * filler that builds it from box data, and renders through `render.ts`. To
 * change what the guide says, edit `guide.md` and its ledger row
 * (`ledger.yaml`); the procedure is in docs/agent-guide.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CardSchema } from "../../cards/index.js";
import type { TemplateDefinition } from "../../schemas/templates.js";
import { cardSchemas } from "../../schemas/registry.js";
import type { ProcedureSummary, GuideSummary } from "../docs-gen/index.js";
import type { BoxShape } from "../../lib/box-shape.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

import { directoryLayoutRows, boxCodeRows } from "./box-shape.js";
import { procedureList, guideList } from "./extensibility.js";
import { createExamples, cardTypesList } from "./cards.js";
import { engineSourceNote } from "./where-docs.js";
import { renderGuideLines, strippedText, type Filler, type GuideLine } from "./render.js";

/** The guide's source; read at runtime, so the package ships it. */
export const GUIDE_SOURCE_PATH = join(PACKAGE_ROOT, "src", "core", "agent-guide", "guide.md");

export interface AgentGuideOptions {
  procedures: ProcedureSummary[];
  /** This box's physical layout; decides the BOX_CODE table's paths. */
  shape: BoxShape;
  allCardSchemas?: CardSchema[];
  /** The box-local schemas (a subset of `allCardSchemas`); their docs live in
   *  the box rather than the package. */
  boxCardSchemas?: CardSchema[];
  /** Templates this box's own schemas registered (see `cardTypesList`). */
  boxTemplates?: TemplateDefinition[];
  /** Whether the engine's TypeScript source is present beside the package
   *  docs (a checkout) — a packed install ships only `dist`. Decides whether
   *  the guide offers the source as the fallback reference. */
  engineSourcePresent?: boolean;
  /** The compiled personality section (`compilePersonality`), heading included. */
  personalitySection?: string | undefined;
  guides?: GuideSummary[];
}

/** The heading `compilePersonality` writes; the guide's own heading replaces it. */
const PERSONALITY_HEADING = "## Personality";

class PersonalityHeadingError extends Error {
  constructor() {
    super(`a compiled personality section must open with "${PERSONALITY_HEADING}"`);
    this.name = "PersonalityHeadingError";
  }
}

/** PERSONALITY's body: the compiled section without its heading, or null to omit the section. */
function personalityBody(compiled: string | undefined): string | null {
  if (compiled === undefined || compiled === "") return null;
  if (!compiled.startsWith(`${PERSONALITY_HEADING}\n`)) throw new PersonalityHeadingError();
  return compiled.slice(PERSONALITY_HEADING.length).replace(/^\n+/, "").replace(/\n+$/, "");
}

/** Each placeholder in `guide.md` and the filler that builds it. */
function guideFillers(options: AgentGuideOptions): Record<string, Filler> {
  const {
    procedures,
    shape,
    allCardSchemas = cardSchemas,
    boxCardSchemas = [],
    boxTemplates = [],
    engineSourcePresent = false,
    personalitySection,
    guides = [],
  } = options;
  return {
    engine_source_note: () => engineSourceNote(engineSourcePresent),
    create_examples: () => createExamples(),
    card_types: () => cardTypesList({ allCardSchemas, boxCardSchemas, boxTemplates }),
    directory_layout: () => directoryLayoutRows(),
    box_code_dirs: () => boxCodeRows(shape),
    procedures: () => procedureList(procedures),
    guides: () => guideList(guides),
    personality: () => personalityBody(personalitySection),
  };
}

/** The guide's lines with placeholders filled and comments kept, tagged for the linter. */
export function renderAgentGuideLines(options: AgentGuideOptions & { source?: string }): GuideLine[] {
  const source = options.source ?? readFileSync(GUIDE_SOURCE_PATH, "utf-8");
  return renderGuideLines({ source, fillers: guideFillers(options) });
}

/** The guide a box gets (before `withDocId` adds its marker line). */
export function generateAgentGuide(options: AgentGuideOptions): string {
  return strippedText(renderAgentGuideLines(options));
}
