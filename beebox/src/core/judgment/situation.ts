/**
 * The situation a judgment starts from: whose box this is and what it is for.
 * A judgment card's `situation:` ref names a card whose text is used whole;
 * without one, the root briefing's `{% purpose %}` block is used, so every
 * judgment knows whose box it is. See docs/implemented-plans/notifications.md (Track D and
 * Track F, "Give Jev the situation").
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../shared/error-guards.js";
import { resolveRefPath } from "../../shared/ref-path/core.js";

/** The root briefing, box-relative (`core/docs-gen/compile.ts` reads the same file). */
const ROOT_BRIEFING_PATH = "_content/briefing.briefing.card";

/** The stock stub a new box's briefing carries; it says nothing about the box. */
const STUB_PURPOSE = "What this box is for.";

const PURPOSE_BLOCK = /{%\s*purpose\s*%}([\S\s]*?){%\s*\/purpose\s*%}/;

/** A `situation:` ref that names no card: it escapes the box (`resolved` null) or the card is missing. */
export class SituationRefError extends Error {
  constructor(ref: string, { resolved }: { resolved: string | null }) {
    super(
      resolved === null
        ? `situation ref "${ref}" does not name a card in the box`
        : `situation ref "${ref}" names ${resolved}, which does not exist`,
    );
    this.name = "SituationRefError";
  }
}

export interface Situation {
  /** The text sent first in every question's instructions; empty when there is none. */
  text: string;
  /** Where the text came from, for `--dry-run` and the debug log. */
  source: string;
}

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/**
 * Resolve the situation for a judgment card at box-relative `cardPath`. A
 * `situation` ref resolves like every card ref, relative to the card; a ref
 * that escapes the box or names a missing card throws, never a guess.
 */
export async function resolveSituation(
  boxRoot: string,
  { cardPath, situationRef }: { cardPath: string; situationRef: string | undefined },
): Promise<Situation> {
  if (situationRef !== undefined) {
    const resolved = resolveRefPath({ fromPath: cardPath, ref: situationRef, kind: "card" });
    if (resolved === null) throw new SituationRefError(situationRef, { resolved });
    const text = await readIfPresent(path.join(boxRoot, resolved));
    if (text === null) throw new SituationRefError(situationRef, { resolved });
    return { text: text.trim(), source: resolved };
  }
  const briefing = await readIfPresent(path.join(boxRoot, ROOT_BRIEFING_PATH));
  const purpose = briefing === null ? null : PURPOSE_BLOCK.exec(briefing)?.[1]?.trim() ?? null;
  if (purpose === null || purpose === "" || purpose === STUB_PURPOSE) {
    return { text: "", source: `none (the root briefing ${ROOT_BRIEFING_PATH} has no purpose statement)` };
  }
  return { text: purpose, source: `the root briefing's purpose (${ROOT_BRIEFING_PATH})` };
}
