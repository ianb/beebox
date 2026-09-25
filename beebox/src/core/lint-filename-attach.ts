/**
 * Warn when a media card's `filename.ref` is not in `attach/<file>` form.
 *
 * The `image`, `audio`, `file` and `pdf` schemas keep the card's file in its
 * attach scope, and every reader of `filename.ref` accepts only the `attach/`
 * form (`webapp/box-image.ts`, `capture/transcribe-clips.ts`,
 * `commands/pdf-reanalyze.ts`). Any other form loads as "Failed to load". The
 * `filename-attach-scope` migration repairs the certain cases and leaves the
 * rest; this warning is how an agent finds those. Warning severity, like every
 * other ref finding: legacy data must not block a commit.
 */

import * as path from "node:path";
import type { LintIssue } from "../cards/index.js";
import { attachDirFor, isAttachRef } from "../shared/attach-path.js";
import { isRecord } from "./card-io.js";

const MEDIA_TYPES: ReadonlySet<string> = new Set(["image", "audio", "file", "pdf"]);

export function lintFilenameAttachRef({ path: cardPath, type, fields }: {
  path: string;
  type: string;
  fields: Record<string, unknown>;
}): LintIssue[] {
  if (!MEDIA_TYPES.has(type)) return [];
  const filename = fields["filename"];
  if (!isRecord(filename)) return [];
  const ref = filename["ref"];
  if (typeof ref !== "string" || isAttachRef(ref)) return [];
  const name = path.posix.basename(ref);
  const scope = path.basename(attachDirFor(cardPath));
  return [{
    type: "reference",
    severity: "warning",
    message: `filename.ref must point into the card's attach scope: move ${name} into ${scope}/ and write \`ref: attach/${name}\` (found \`${ref}\`)`,
  }];
}
