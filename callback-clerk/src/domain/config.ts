/**
 * Extension config: which boxes are enabled and which one is active.
 * Pure data + helpers — persistence lives in platform/config-storage.ts.
 *
 * A box is identified by its absolute root URL (boxUrl), taken verbatim
 * from the box page's identity meta — the extension never parses path
 * segments, so boxes on any server (deployed or dev router) work alike.
 */

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

/** Adds (or replaces) a box; the first enabled box becomes active. */
export function addBox(config: ClerkConfig, box: EnabledBox): ClerkConfig {
  const others = config.boxes.filter((b) => b.boxUrl !== box.boxUrl);
  const activeBoxUrl = config.activeBoxUrl === null ? box.boxUrl : config.activeBoxUrl;
  return { version: 1, boxes: [...others, box], activeBoxUrl };
}

/** Removes a box; if it was active, the first remaining box takes over. */
export function removeBox(config: ClerkConfig, boxUrl: string): ClerkConfig {
  const boxes = config.boxes.filter((b) => b.boxUrl !== boxUrl);
  const activeBoxUrl =
    config.activeBoxUrl === boxUrl ? (boxes[0]?.boxUrl ?? null) : config.activeBoxUrl;
  return { version: 1, boxes, activeBoxUrl };
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
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
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
  if (typeof value !== "object" || value === null) return emptyConfig();
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.boxes)) return emptyConfig();
  const boxes = record.boxes.filter(isEnabledBox);
  const activeBoxUrl =
    typeof record.activeBoxUrl === "string" &&
    boxes.some((b) => b.boxUrl === record.activeBoxUrl)
      ? record.activeBoxUrl
      : (boxes[0]?.boxUrl ?? null);
  return { version: 1, boxes, activeBoxUrl };
}
