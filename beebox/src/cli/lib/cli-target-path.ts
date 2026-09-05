/**
 * Shared guard for a `bbx` command's box-path CLI argument (a positional
 * card/file path, not a glob-only pattern) — `validate`, `ls`, `mv`, `rm`,
 * `create` all take one and independently hand-rolled the same
 * `path.isAbsolute(p) ? p : <join>` resolution, which mis-handles two
 * things the same way everywhere (`docs/plans/display-path-guard.subplan.md`):
 *
 *  - A boxholder DISPLAY-FORM path (`Config:box.json`) is the boxholder's
 *    CONVERSATION vocabulary, never a canonical path — rejected outright
 *    with a message naming the canonical form, rather than being treated as
 *    a (nonexistent) relative filesystem path.
 *  - A canonical box-ref form (`/_config/box.json`) LOOKS filesystem-
 *    absolute to `path.isAbsolute` (any leading `/` does), so it used to be
 *    passed through as-is — resolving from the OS filesystem root instead
 *    of the box root, and silently finding nothing. Recognized here by its
 *    first segment naming a real underscore area, and joined onto
 *    `boxRoot` instead. A genuine OS-absolute path (one a shell already
 *    expanded, e.g. via tab-completion inside the box) is untouched.
 */

import * as path from "node:path";
import {
  detectDisplayFormPath,
  displayFormPathMessage,
  type DisplayFormPathMatch,
} from "../../shared/display-path.js";
import { BOX_ROOT_VOCABULARY } from "../../lib/box-root-vocabulary.js";

const AREA_NAMES: ReadonlySet<string> = new Set(
  BOX_ROOT_VOCABULARY.filter((entry) => entry.kind === "area").map((entry): string => entry.name)
);

/** A CLI path argument was written in the boxholder's display form, not a canonical path. */
export class DisplayFormPathArgError extends Error {
  constructor(raw: string, match: DisplayFormPathMatch) {
    super(displayFormPathMessage(raw, match));
    this.name = "DisplayFormPathArgError";
  }
}

/** Whether `raw`'s first segment (after its leading `/`) names a real underscore area. */
function looksLikeCanonicalBoxRef(raw: string): boolean {
  if (!raw.startsWith("/")) return false;
  const firstSegment = raw.slice(1).split("/")[0] ?? "";
  return AREA_NAMES.has(firstSegment);
}

/**
 * Resolve one CLI positional path argument to an absolute filesystem path.
 * Throws {@link DisplayFormPathArgError} for a display-form leak.
 * `relativeTo` is the base a plain relative argument joins onto — `boxRoot`
 * for `ls`/`mv`/`rm`/`create` (paths are conceptually box-relative);
 * `process.cwd()` for `validate` (arguments are real filesystem paths, as
 * typed wherever the CLI was invoked from).
 */
export function resolveCliTargetPath({
  boxRoot,
  raw,
  relativeTo,
}: {
  boxRoot: string;
  raw: string;
  relativeTo: string;
}): string {
  const displayForm = detectDisplayFormPath(raw);
  if (displayForm !== null) throw new DisplayFormPathArgError(raw, displayForm);
  if (looksLikeCanonicalBoxRef(raw)) return path.join(boxRoot, raw);
  return path.isAbsolute(raw) ? raw : path.join(relativeTo, raw);
}
