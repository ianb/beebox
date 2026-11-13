/**
 * What a `refresh-intentions` commit changed on a landmark besides its
 * `intention` (docs/implemented-plans/place-intention.md, Track D, `verify`).
 *
 * The raw frontmatter mapping is compared, every key included, so a key the
 * landmark schema does not know is protected too; the body is compared as
 * text. `parseLandmarkFields` is not usable here: it strips unknown keys and
 * never reads the body.
 */

import { isDeepStrictEqual } from "node:util";
import { splitCardContent } from "../../../exports/cards.js";
import { parse as parseYaml } from "../../../lib/yaml-package.js";
import { isRecord } from "../../../shared/is-record.js";

/** The frontmatter as a mapping, `{}` for an empty block, or null when it is not a readable mapping. */
function frontmatterMapping(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (_e) {
    return null; // unreadable YAML: the caller compares the raw text instead
  }
  if (parsed === null || parsed === undefined) return {};
  return isRecord(parsed) ? parsed : null;
}

/**
 * A sentence naming what changed outside `intention` between two versions of
 * a landmark card, or null when nothing did.
 */
export function changeOutsideIntention(before: string, after: string): string | null {
  const a = splitCardContent(before);
  const b = splitCardContent(after);
  if (a.body !== b.body) return "its body changed";
  if (a.hasFrontmatter !== b.hasFrontmatter) return "its frontmatter block was added or removed";
  const fieldsA = frontmatterMapping(a.frontmatterText);
  const fieldsB = frontmatterMapping(b.frontmatterText);
  if (fieldsA === null || fieldsB === null) {
    return a.frontmatterText === b.frontmatterText ? null : "its frontmatter is not readable YAML and changed";
  }
  const keys = new Set([...Object.keys(fieldsA), ...Object.keys(fieldsB)]);
  keys.delete("intention");
  const changed = [...keys].filter((key) => !isDeepStrictEqual(fieldsA[key], fieldsB[key])).toSorted();
  return changed.length === 0 ? null : `frontmatter changed: ${changed.join(", ")}`;
}
