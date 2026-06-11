import { addBox, removeBox, setActiveBox, type ClerkConfig, type EnabledBox } from "../domain/config.js";
import { loadConfig, saveConfig } from "../platform/config-storage.js";

/**
 * Enables a box: requests the per-origin host permission (must be called
 * from a user-gesture handler — the permission prompt is the explicit
 * "enable" consent), then persists the box. Returns the new config, or
 * null when the user declined the permission.
 */
export async function enableBox(box: EnabledBox): Promise<ClerkConfig | null> {
  const origin = new URL(box.boxUrl).origin;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return null;
  const config = addBox(await loadConfig(), box);
  await saveConfig(config);
  return config;
}

export async function disableBox(boxUrl: string): Promise<ClerkConfig> {
  const config = removeBox(await loadConfig(), boxUrl);
  await saveConfig(config);
  return config;
}

export async function activateBox(boxUrl: string): Promise<ClerkConfig> {
  const config = setActiveBox(await loadConfig(), boxUrl);
  await saveConfig(config);
  return config;
}
