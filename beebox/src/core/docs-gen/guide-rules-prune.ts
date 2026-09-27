/**
 * Orphan pruning for the guide-derived rule families `compileGuides` writes.
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { readDocId } from "./shared.js";

const GUIDE_RULE_PREFIXES = ["guides-for-", "guide-for-chat-"] as const;

/**
 * Remove a `guides-for-<type>.md` or `guide-for-chat-<chat>.md` rule this run
 * did not write, when the file carries its own DOCID marker: the guide card
 * it listed is gone, so the rule would point an agent at nothing. A file in
 * the family without the marker is not ours and stays.
 */
export async function pruneGuideRules(ctx: { rulesDir: string; written: ReadonlySet<string> }): Promise<void> {
  const { rulesDir, written } = ctx;
  for (const name of await readdir(rulesDir)) {
    if (written.has(name) || !name.endsWith(".md")) continue;
    if (!GUIDE_RULE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const content = await readFile(join(rulesDir, name), "utf8");
    if (readDocId(content) === `.claude/rules/${name}`) await rm(join(rulesDir, name));
  }
}
