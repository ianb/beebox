/**
 * Extension config: which boxes are enabled and which one is active.
 * Pure data + helpers — persistence lives in platform/config-storage.ts.
 *
 * A box is identified by its absolute root URL (boxUrl), taken verbatim
 * from the box page's identity meta — the extension never parses path
 * segments, so boxes on any server (deployed or dev router) work alike.
 */

import { isRecord } from "./is-record.js";

export interface EnabledBox {
  boxUrl: string;
  slug: string;
  title: string;
}

export interface ClerkConfig {
  version: 1;
  boxes: EnabledBox[];
  activeBoxUrl: string | null;
}

export function emptyConfig(): ClerkConfig {
  return { version: 1, boxes: [], activeBoxUrl: null };
}

/** Adds (or replaces) a box and makes it active. */
export function addBox(config: ClerkConfig, box: EnabledBox): ClerkConfig {
  const others = config.boxes.filter((b) => b.boxUrl !== box.boxUrl);
  return { version: 1, boxes: [...others, box], activeBoxUrl: box.boxUrl };
}

/** Removes a box; if it was active, the first remaining box takes over. */
export function removeBox(config: ClerkConfig, boxUrl: string): ClerkConfig {
  const boxes = config.boxes.filter((b) => b.boxUrl !== boxUrl);
  const activeBoxUrl =
    config.activeBoxUrl === boxUrl ? (boxes[0]?.boxUrl ?? null) : config.activeBoxUrl;
  return { version: 1, boxes, activeBoxUrl };
}

/**
 * Moves a box one slot up (-1) or down (+1) in the list. The list order is the
 * user's own, edited from the popup's edit mode; a move past either end is a
 * no-op rather than a wrap.
 */
export function moveBox(config: ClerkConfig, move: { boxUrl: string; delta: -1 | 1 }): ClerkConfig {
  const { boxUrl, delta } = move;
  const from = config.boxes.findIndex((b) => b.boxUrl === boxUrl);
  if (from === -1) return config;
  const to = from + delta;
  if (to < 0 || to >= config.boxes.length) return config;
  const boxes = [...config.boxes];
  const [moved] = boxes.splice(from, 1);
  if (moved === undefined) return config;
  boxes.splice(to, 0, moved);
  return { ...config, boxes };
}

/** No-op when boxUrl isn't an enabled box. */
export function setActiveBox(config: ClerkConfig, boxUrl: string): ClerkConfig {
  if (!config.boxes.some((b) => b.boxUrl === boxUrl)) return config;
  return { ...config, activeBoxUrl: boxUrl };
}

export function getActiveBox(config: ClerkConfig): EnabledBox | null {
  if (config.activeBoxUrl === null) return null;
  return config.boxes.find((b) => b.boxUrl === config.activeBoxUrl) ?? null;
}

export function isBoxEnabled(config: ClerkConfig, boxUrl: string): boolean {
  return config.boxes.some((b) => b.boxUrl === boxUrl);
}

function isEnabledBox(value: unknown): value is EnabledBox {
  if (!isRecord(value)) return false;
  const record = value;
  return (
    typeof record.boxUrl === "string" &&
    typeof record.slug === "string" &&
    typeof record.title === "string"
  );
}

/**
 * Turns whatever was found in storage into a valid config. Unknown shapes
 * (including dropbox-relay-era state) collapse to the empty config.
 */
export function normalizeConfig(value: unknown): ClerkConfig {
  if (!isRecord(value)) return emptyConfig();
  const record = value;
  if (record.version !== 1 || !Array.isArray(record.boxes)) return emptyConfig();
  const boxes = record.boxes.filter(isEnabledBox);
  const activeBoxUrl =
    typeof record.activeBoxUrl === "string" &&
    boxes.some((b) => b.boxUrl === record.activeBoxUrl)
      ? record.activeBoxUrl
      : (boxes[0]?.boxUrl ?? null);
  return { version: 1, boxes, activeBoxUrl };
}
