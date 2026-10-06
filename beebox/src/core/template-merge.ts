/** Conservative line-based three-way merge of a template update. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRecord } from "./card-io.js";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../exports/cards.js";

/** Parse a card's frontmatter into an object + body, or null if it isn't a card. */
export function parseCard(content: string): { fm: Record<string, unknown>; body: string } | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  const parsed: unknown = parseYaml(split.frontmatterText);
  if (!isRecord(parsed)) return null;
  return { fm: parsed, body: split.body };
}

export async function mergeWithoutConflict({ local, base, upstream, card }: { local: string; base: string; upstream: string; card: boolean }): Promise<string | null> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-template-merge-"));
  const basePath = path.join(temp, "base");
  const upstreamPath = path.join(temp, "upstream");
  try {
    await Promise.all([fs.writeFile(basePath, base), fs.writeFile(upstreamPath, upstream)]);
    try {
      const result = await promisify(execFile)("git", ["merge-file", "-p", "--", local, basePath, upstreamPath], { maxBuffer: 10 * 1024 * 1024 });
      // A clean line merge can still create duplicate YAML keys. Keep such
      // cards parked instead of writing an invalid active card.
      if (card && parseCard(base) !== null) {
        try {
          if (parseCard(result.stdout) === null) return null;
        } catch (_error) {
          return null;
        }
      }
      return result.stdout;
    } catch (error) {
      // git merge-file uses 1 specifically for a content conflict; larger
      // statuses indicate a failed invocation and must remain visible.
      if (isRecord(error) && error.code === 1) return null;
      throw error;
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
