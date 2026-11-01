/**
 * What `bbx webpage save` and `bbx pdf save` share: the failure type that
 * prints as one line with exit 1, shell quoting for the follow-up line they
 * print on a redirect, and the check that `--to` and `--update` stay in the box.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../shared/error-guards.js";

/** A failure to report to the agent as one line. */
export class SaveError extends Error {
  override name = "SaveError";
  constructor(what: { readonly detail: string }) {
    super(what.detail);
  }
}

/** One shell word: a redirect target is the site's text, and the agent may paste this line. */
export function shellWord(text: string): string {
  return /^[\w%+,./:=@-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

/** `target` relative to the box root, or an error when it leaves the box, by path or through a link. */
export async function insideBox({ boxRoot, target, flag, command }: { boxRoot: string; target: string; flag: string; command: string }): Promise<string> {
  const refused = new SaveError({ detail: `${command}: ${flag} must be inside the box: ${target}` });
  const absolute = path.resolve(boxRoot, target);
  const relative = path.relative(boxRoot, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw refused;
  const realRoot = await fs.realpath(boxRoot);
  let existing = absolute;
  for (;;) {
    try {
      existing = await fs.realpath(existing);
      break;
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
      existing = path.dirname(existing);
    }
  }
  if (existing !== realRoot && !existing.startsWith(`${realRoot}${path.sep}`)) throw refused;
  return relative;
}

/** What `--meta` holds: `retrieved` is the capture time, the rest is kept on the card. */
const META = z.looseObject({ retrieved: z.iso.datetime({ offset: true }).optional() });

export function parseMeta({ text, command }: { text: string | undefined; command: string }): { retrieved: string | undefined; meta: Record<string, unknown> } {
  if (text === undefined) return { retrieved: undefined, meta: {} };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new SaveError({ detail: `${command}: --meta is not JSON: ${e instanceof Error ? e.message : String(e)}` });
  }
  const parsed = META.safeParse(json);
  if (!parsed.success) throw new SaveError({ detail: `${command}: --meta: ${z.prettifyError(parsed.error)}` });
  const { retrieved, ...meta } = parsed.data;
  return { retrieved, meta };
}
