#!/usr/bin/env tsx

/** Convert command-written agent feedback files into ordinary doc cards. */

import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { renderFrontmatterBlock } from "../../src/cards/frontmatter.js";
import { errnoCode } from "../../src/lib/error-guards.js";
import { findAbsoluteMachinePaths } from "../../src/lib/absolute-path-check.js";
import { runMigration } from "./_harness.js";

const LEGACY_NAME = /^\d{4}(?:-\d{2}){2}T(?:\d{2}-){3}.+\.md$/;

function isFeedbackPath(file: string): boolean {
  const parts = file.split(sep);
  const config = parts.lastIndexOf("_config");
  return config !== -1 && parts[config + 1] === "feedback" &&
    (parts.length === config + 3 || (parts.length === config + 4 && parts[config + 2] === "resolved"));
}

function titleFromLegacy(name: string, content: string): string {
  const feedback = content.match(/^## Feedback\s*\n\s*([^\n]+)/m)?.[1]?.trim();
  if (feedback) return feedback.slice(0, 160);
  return name.replace(/\.md$/, "").replace(/^\d{4}(?:-\d{2}){2}T(?:\d{2}-){3}/, "").replace(/-/g, " ");
}

export function convertLegacyFeedback(name: string, content: string): string {
  // The old command embedded raw transcript lines. Their trailing spaces made
  // resolving the file fail markdownlint. Its absolute Box path is redundant
  // once the note is a card inside that box, and card validation forbids it.
  const boxPath = content.match(/^\*\*Box path:\*\* ([^\n]+)$/m)?.[1]?.trim();
  const body = content
    .replace(/^\*\*Box path:\*\* [^\n]*\n/m, "")
    .replace(/[\t ]+$/gm, "")
    .replace(/\n*$/, "\n");
  // Old transcript summaries frequently name files inside the box by their
  // machine path. The old header supplies that box root; convert those paths
  // to canonical box-root refs before validating the new card.
  let portableBody = boxPath ? body.replaceAll(`${boxPath}/`, "/") : body;
  const machineHomes = [...new Set(findAbsoluteMachinePaths(portableBody))];
  for (const home of machineHomes) portableBody = portableBody.replaceAll(home, "~/");
  if (machineHomes.length > 0) {
    portableBody += "\n> Machine home paths in this captured context were shortened to `~/` during migration.\n";
  }
  return renderFrontmatterBlock({ title: titleFromLegacy(name, content) }, portableBody);
}

export async function migrateFeedbackFile(file: string): Promise<"converted" | "already"> {
  if (!isFeedbackPath(file) || !LEGACY_NAME.test(basename(file))) return "already";
  const destination = join(dirname(file), basename(file).replace(/\.md$/, ".doc.card"));
  const content = await readFile(file, "utf8");
  const converted = convertLegacyFeedback(basename(file), content);
  // Exclusive creation prevents overwriting a card someone already wrote.
  try {
    await writeFile(destination, converted, { flag: "wx" });
  } catch (error) {
    if (errnoCode(error) !== "EEXIST" || await readFile(destination, "utf8") !== converted) throw error;
    // Retry after a partial run that wrote the destination but did not remove
    // the source. Identical bytes make removing the old copy safe.
  }
  try {
    await unlink(file);
  } catch (error) {
    await unlink(destination);
    throw error;
  }
  return "converted";
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigration({
    description: "Convert legacy _config/feedback/*.md and resolved/*.md to doc cards.",
    match: (name) => LEGACY_NAME.test(name),
    convert: async (file) => migrateFeedbackFile(file),
  });
}
