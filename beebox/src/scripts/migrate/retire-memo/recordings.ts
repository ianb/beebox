/**
 * Where a memo's recording is: inside its attach scope (quick capture), a
 * same-basename sibling such as `Note.m4a` (the old transcribe pre-action), or
 * already moved under an audio card by an interrupted run. Part of the
 * `retire-memo-2026-10` plan (`plan.ts`).
 */

import * as path from "node:path";
import { parseYaml } from "../../../lib/read-yaml.js";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { attachDirFor, cardBasename } from "../../../shared/attach-path.js";
import { isRecord } from "../../../shared/is-record.js";
import type { PlanInput } from "./plan.js";

/** Audio extensions the transcribe pre-action and quick capture produced. */
const AUDIO_EXTENSIONS = new Set([".webm", ".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac", ".mp4"]);

export interface Recording {
  /** Audio file in its old layout, box-relative. */
  from: string;
  /** An interrupted run already moved it; moving again only repairs annex links. */
  moved: boolean;
  to: string;
  card: string;
  /** File name inside the audio card's attach scope. */
  name: string;
  stem: string;
  /** The memo body links it as `attach/<name>` (attach layout) or `<name>` (sibling). */
  bodyRef: string;
  sibling: boolean;
}

function audioStem(name: string): string | null {
  const ext = path.posix.extname(name).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext) ? name.slice(0, -ext.length) : null;
}

/** Recordings this memo has, in its old layouts or already moved by an interrupted run. */
export function findRecordings(memoPath: string, input: PlanInput): { found: Recording[]; failures: string[] } {
  const dir = path.posix.dirname(memoPath);
  const base = cardBasename(memoPath);
  const attach = attachDirFor(memoPath);
  const found: Recording[] = [];
  const failures: string[] = [];
  const place = (args: { from: string; name: string; sibling: boolean; bodyRef: string }): void => {
    const stem = audioStem(args.name) ?? args.name;
    const card = `${attach}/${stem}.audio.card`;
    found.push({ ...args, stem, card, moved: false, to: `${attachDirFor(card)}/${args.name}` });
  };
  for (const file of input.files) {
    if (path.posix.dirname(file) === dir) {
      const name = path.posix.basename(file);
      const stem = audioStem(name);
      if (stem === base) place({ from: file, name, sibling: true, bodyRef: name });
    } else if (path.posix.dirname(file) === attach) {
      const name = path.posix.basename(file);
      if (audioStem(name) !== null) place({ from: file, name, sibling: false, bodyRef: `attach/${name}` });
    }
  }
  // Already moved: an audio card in the scope whose file sits in its own attach scope.
  for (const [cardPath, text] of input.texts) {
    if (path.posix.dirname(cardPath) !== attach || !cardPath.endsWith(".audio.card")) continue;
    const fields = frontmatter(text);
    const ref = isRecord(fields?.["filename"]) ? fields["filename"]["ref"] : undefined;
    if (typeof ref !== "string" || !ref.startsWith("attach/")) continue;
    const name = ref.slice("attach/".length);
    const moved = `${attachDirFor(cardPath)}/${name}`;
    if (!input.files.has(moved) || found.some((r) => r.to === moved)) continue;
    const stem = cardBasename(cardPath);
    const sibling = stem === base;
    const from = sibling ? (dir === "." ? name : `${dir}/${name}`) : `${attach}/${name}`;
    found.push({ from, to: moved, moved: true, card: cardPath, name, stem, sibling, bodyRef: sibling ? name : `attach/${name}` });
  }
  if (found.length > 1) failures.push(`${memoPath}: more than one recording (${found.map((r) => r.from).join(", ")}); move the extra ones out first`);
  for (const r of found) {
    if (!r.moved && input.files.has(r.to)) failures.push(`${memoPath}: ${r.to} already exists`);
  }
  return { found, failures };
}

export function frontmatter(text: string): Record<string, unknown> | null {
  const split = splitCardContent(text);
  if (!split.hasFrontmatter) return null;
  try {
    const parsed: unknown = parseYaml(split.frontmatterText);
    return isRecord(parsed) ? parsed : null;
  } catch (_e) {
    // Unparseable YAML: the caller reports the memo as unconvertible.
    return null;
  }
}

