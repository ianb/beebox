/**
 * Read the chat-feature seed (if any) from a landmark card. The seed
 * lives in the landmark's `navigation.chat-app` mapping:
 *
 *   navigation:
 *     chat-app:
 *       narration: on
 *       prose: off
 *
 * Used at chat-session creation time to seed features for chats opened
 * from a landmark.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseLandmarkFields, type LandmarkNavigationData } from "../../schemas/landmark.js";
import { isKnownFeature, isValidValue } from "../chat/features.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { loadHqDictationDefault } from "../box/config.js";
import { mergeSeedFeatures } from "../chat/features.js";
import { landmarkScanRelDir } from "./root-dir.js";
import { resolveBoxNamespacePathOnDisk } from "../../lib/box-namespace-resolve.js";

class LandmarkDirReadError extends Error {
  constructor(cause: unknown, dir: string) {
    super(`Failed to read landmark directory: ${dir}`);
    this.name = "LandmarkDirReadError";
    this.cause = cause;
  }
}

/**
 * Extract feature seeds from a landmark's navigation role. Only entries
 * that name a known feature with a valid value are returned. Unknown
 * features and invalid values are dropped silently — the schema validator
 * already rejects them at parse time, this is defense in depth for
 * hand-edited cards that bypass validation.
 */
export function readLandmarkFeatures(
  navigation: LandmarkNavigationData | undefined,
): Record<string, string> {
  const features: Record<string, string> = {};
  const chatApp = navigation?.["chat-app"];
  if (chatApp === undefined) return features;
  for (const [name, value] of Object.entries(chatApp)) {
    if (typeof value !== "string") continue;
    if (!isKnownFeature(name)) continue;
    if (!isValidValue(name, value)) continue;
    features[name] = value;
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
  // Fail closed on a `contextDir` that would resolve outside the box
  // namespace — treated the same as a missing directory (below), not as an
  // error: the caller (chat-session creation) just gets no landmark seeds
  // rather than reading another box's landmark card through this box's scope.
  const ns = await resolveBoxNamespacePathOnDisk({
    boxRoot,
    rawPath: landmarkScanRelDir(contextDir),
    mode: "read",
  });
  if (ns === null) return null;
  const absDir = ns.resolved;
  let entries: string[];
  try {
    entries = await fs.readdir(absDir);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw new LandmarkDirReadError(e, absDir);
  }
  const landmarkName = entries.filter((n) => n.endsWith(".landmark.card")).toSorted()[0];
  if (!landmarkName) return null;
  const absPath = path.join(absDir, landmarkName);
  let fields;
  try {
    const content = await fs.readFile(absPath, "utf-8");
    fields = parseLandmarkFields(content);
  } catch (e) {
    console.warn(`readLandmarkFeaturesForDir: failed to read ${landmarkName}: ${errorMessage(e)}`);
    return null;
  }
  if (fields === null) return null;
  const features = readLandmarkFeatures(fields.navigation);
  return Object.keys(features).length === 0 ? null : features;
}

/** Resolve every inherited feature source for a newly created chat. */
export async function seedFeaturesForNewChat(options: {
  boxRoot: string;
  contextDir: string | null | undefined;
  request?: Record<string, string> | null | undefined;
}): Promise<Record<string, string>> {
  const { boxRoot, contextDir, request } = options;
  const [boxHq, landmark] = await Promise.all([
    loadHqDictationDefault(boxRoot),
    contextDir === null || contextDir === undefined ? null : readLandmarkFeaturesForDir(boxRoot, contextDir),
  ]);
  return mergeSeedFeatures({ box: { "hq-dictation": boxHq }, landmark, request });
}
