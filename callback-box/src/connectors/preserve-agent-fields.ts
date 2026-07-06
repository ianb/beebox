/**
 * Connector sync rebuilds cards wholesale from templates; any field the
 * template doesn't know about would be silently destroyed. This re-injects
 * the agent-maintained fields (currently `contains`) from the existing
 * card into freshly templated content before it's written.
 *
 * Run it before any "did the card change?" comparison — a preserved card
 * that matches what's on disk should be recognized as unchanged.
 */

import { promises as fs } from "node:fs";
import { parseFrontmatterObject, renderFrontmatterBlock, splitCardContent } from "../cards/index.js";

/** Fields agents own on connector-managed cards. */
const AGENT_FIELDS = ["contains"] as const;

/**
 * Carry agent-owned fields from the card at `existingPath` (if any) into
 * `cardText`. Missing/unparseable existing cards and template-provided
 * values leave `cardText` unchanged.
 */
export async function preserveAgentFields(
  cardText: string,
  { existingPath }: { existingPath: string }
): Promise<string> {
  let existingRaw: string;
  try {
    existingRaw = await fs.readFile(existingPath, "utf8");
  } catch (_e) {
    return cardText; // new card — nothing to preserve
  }
  const existingFields = parseFrontmatterObject(existingRaw);
  if (existingFields === null) return cardText;

  const next = splitCardContent(cardText);
  const nextFields = parseFrontmatterObject(cardText);
  if (!next.hasFrontmatter || nextFields === null) return cardText;

  let changed = false;
  for (const field of AGENT_FIELDS) {
    const value = existingFields[field];
    if (typeof value !== "string" || value === "") continue;
    if (nextFields[field] !== undefined) continue; // template wins if it set one
    nextFields[field] = value;
    changed = true;
  }
  if (!changed) return cardText;
  return renderFrontmatterBlock(nextFields, next.body);
}
