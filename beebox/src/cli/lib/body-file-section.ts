/**
 * The `body-file` sidecar of a card, as text to print after it. An
 * email-message card keeps its body out of the card in a `body-file: { ref }`
 * sidecar (the Gmail connector writes `attach/msg-NNN.body.txt`), so a reader
 * of the card alone sees only the snippet. `bbx changes --cat` and `bbx judge
 * --cards` append this section so the email's text is judged and read.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseFrontmatterObject } from "../../cards/frontmatter.js";
import { errnoCode } from "../../shared/error-guards.js";
import { isRecord } from "../../shared/is-record.js";
import { parseRef, resolveRefPath } from "../../shared/ref-path/core.js";

/** How much of a sidecar is printed; the trial's 400 was too short to judge on (2026-09-26). */
export const BODY_FILE_CAP = 4000;

/**
 * `--- body ---` and the sidecar's text (cut at {@link BODY_FILE_CAP} with a
 * marker), a one-line note when the sidecar is missing, or null when the
 * card's frontmatter has no `body-file.ref`. `file` is the card's
 * box-relative path; `text` its content.
 */
export async function bodyFileSection(boxRoot: string, { file, text }: { file: string; text: string }): Promise<string | null> {
  const bodyFile = parseFrontmatterObject(text)?.["body-file"];
  if (!isRecord(bodyFile) || typeof bodyFile["ref"] !== "string") return null;
  const ref = bodyFile["ref"];
  const missing = `--- body: ${ref} is missing ---`;
  const resolved = resolveRefPath({ fromPath: file, ref: parseRef(ref).path, kind: "card" });
  if (resolved === null) return missing;
  let body: string;
  try {
    body = (await fs.readFile(path.join(boxRoot, resolved), "utf-8")).replace(/\n$/, "");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    return missing;
  }
  if (body.length <= BODY_FILE_CAP) return `--- body ---\n${body}`;
  return `--- body ---\n${body.slice(0, BODY_FILE_CAP)}\n[… truncated; the body is ${String(body.length)} characters]`;
}
