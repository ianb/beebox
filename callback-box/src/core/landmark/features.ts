/**
 * Read the chat-feature seed (if any) from a landmark card. The seed
 * lives in a `<chat-app>` element nested inside the landmark's
 * `<navigation>` role:
 *
 *   <landmark>
 *     <navigation>
 *       <chat-app narration="on" prose="off"/>
 *     </navigation>
 *   </landmark>
 *
 * Used at chat-session creation time to seed features for chats opened
 * from a landmark.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseXml, type ElementNode } from "cardworks";
import { isKnownFeature, isValidValue } from "../chat-features.js";

/**
 * Extract feature seeds from a parsed landmark element. Only attributes
 * that name a known feature with a valid value are returned. Unknown
 * features and invalid values are dropped silently — the schema
 * validator already rejects them at parse time, this is defense in
 * depth for hand-edited cards that bypass validation.
 */
export function readLandmarkFeatures(element: ElementNode): Record<string, string> {
  const features: Record<string, string> = {};
  for (const role of element.children) {
    if (role.tagName !== "navigation") continue;
    for (const child of role.children) {
      if (child.tagName !== "chat-app") continue;
      for (const [name, value] of Object.entries(child.attrs)) {
        if (typeof value !== "string") continue;
        if (!isKnownFeature(name)) continue;
        if (!isValidValue(name, value)) continue;
        features[name] = value;
      }
    }
  }
  return features;
}

/**
 * Find the landmark card at the top of `contextDir` (box-relative) and
 * return its feature seeds, or null if no landmark / no seeds. Used by
 * the chat route at new-session creation.
 */
export async function readLandmarkFeaturesForDir(
  boxRoot: string,
  contextDir: string,
): Promise<Record<string, string> | null> {
  const absDir = path.join(boxRoot, contextDir);
  let entries: string[];
  try {
    entries = await fs.readdir(absDir);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
  const landmarkName = entries.find((n) => n.endsWith(".landmark.card"));
  if (!landmarkName) return null;
  const absPath = path.join(absDir, landmarkName);
  let element: ElementNode;
  try {
    const content = await fs.readFile(absPath, "utf-8");
    element = await parseXml(content, absPath);
  } catch (e) {
    console.warn(`readLandmarkFeaturesForDir: failed to read ${landmarkName}: ${(e as Error).message}`);
    return null;
  }
  if (element.tagName !== "landmark") return null;
  const features = readLandmarkFeatures(element);
  return Object.keys(features).length === 0 ? null : features;
}
