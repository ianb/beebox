/**
 * Read and compile this box's guide and personality cards without writing
 * anything. `compile.ts` writes the compiled docs and rules from these
 * results during `generateDocs`; the agent guide's read-only callers
 * (`pnpm agent-context guide`, `pnpm lint:guide`) use them directly.
 */

import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { parseGuide, parseGuideCard } from "../../../schemas/guide/parse.js";
import { compileGuide } from "../../../schemas/guide/compile.js";
import { compilePersonality, type PersonalityFields } from "../../../schemas/personality/schema.js";
import { loadBoxholders } from "./boxholder-cards.js";
import { parseCardText } from "../../card-io.js";
import { createCardSchemaMap } from "../../../schemas.js";
import { DOCS_DIR } from "../shared.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { getBoxDir, BOX_DIRS } from "../../../lib/paths/core.js";

/**
 * Summary of a compiled guide, for inclusion in the agent guide.
 */
export interface GuideSummary {
  name: string;
  guidePath: string;
  compiledPath: string;
  appliesTo: string;
  jobTypes: string[];
}

/** One `_config/*.guide.card`: its summary and its compiled markdown. */
interface ConfigGuide {
  summary: GuideSummary;
  compiled: string;
}

async function configFiles(boxRoot: string, suffix: string): Promise<string[]> {
  const configDir = getBoxDir(boxRoot, "config");
  try {
    return (await readdir(configDir)).filter((f) => f.endsWith(suffix));
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[generate-docs] could not read ${configDir}; assuming no ${suffix} cards:`, e);
    }
    return [];
  }
}

/** Parse and compile every `_config/*.guide.card`, skipping (with a warning) any that do not parse. */
export async function readConfigGuides(boxRoot: string): Promise<ConfigGuide[]> {
  const configDir = getBoxDir(boxRoot, "config");
  const guides: ConfigGuide[] = [];
  for (const filename of await configFiles(boxRoot, ".guide.card")) {
    const guidePath = `${BOX_DIRS.config}/${filename}`;
    const name = filename.replace(".guide.card", "");
    try {
      const fields = parseGuideCard(await readFile(join(configDir, filename), "utf-8"));
      if (fields === null) {
        console.warn(`Skipping unparseable guide: ${guidePath}`);
        continue;
      }
      const parsed = parseGuide(fields);
      guides.push({
        summary: {
          name,
          guidePath,
          compiledPath: `${DOCS_DIR}/${name}-guide.md`,
          appliesTo: parsed.appliesTo ?? "",
          jobTypes: parsed.jobTypes,
        },
        compiled: compileGuide(parsed, name),
      });
    } catch (e) {
      // Skip unparseable guide cards, but surface them so malformed cards aren't silent.
      console.warn(`[generate-docs] could not parse guide card ${filename}:`, e);
    }
  }
  return guides;
}

/** The box's personality card, parsed and compiled. */
interface Personality {
  /** The card's basename, e.g. `main`. */
  name: string;
  fields: PersonalityFields;
  /** The compiled `## Personality` section. */
  compiled: string;
}

/**
 * Parse and compile `_config/*.personality.card` (only one, `main`, is
 * supported). Undefined when the box has none or it does not parse.
 */
export async function readPersonality(boxRoot: string): Promise<Personality | undefined> {
  const [filename] = await configFiles(boxRoot, ".personality.card");
  if (filename === undefined) return undefined;
  const name = filename.replace(".personality.card", "");
  try {
    const content = await readFile(join(getBoxDir(boxRoot, "config"), filename), "utf-8");
    const parsed = parseCardText(content, {
      source: filename,
      schemas: await createCardSchemaMap(boxRoot),
    });
    // parseCardText validated these fields against the personality schema
    // (createCardSchemaMap includes it). PersonalityFields is a hand-written
    // interface not derived from that schema, so TS can't connect the generic
    // `Record<string, unknown>` to it — see the follow-up to derive one from
    // the other.
    // eslint-disable-next-line no-restricted-syntax -- validated at parse; hand-written interface can't be inferred from the CardSchema-typed schema
    const fields = parsed.fields as unknown as PersonalityFields;
    const boxholders = await loadBoxholders(boxRoot);
    return { name, fields, compiled: compilePersonality(fields, { boxholders }) };
  } catch (e) {
    console.error(`[generate-docs] Failed to compile personality ${filename}:`, e);
    return undefined;
  }
}
