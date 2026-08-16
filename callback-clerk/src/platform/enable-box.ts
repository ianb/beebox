import { addBox, moveBox, removeBox, setActiveBox, type ClerkConfig, type EnabledBox } from "../domain/config.js";
import { loadConfig, saveConfig } from "../platform/config-storage.js";
import { syncRelayRegistration } from "../platform/relay-registration.js";

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
  // Register the box-relay content script for the newly enabled box (path-scoped
  // match patterns — see relay-registration.ts). Best-effort: a relay failure
  // must not fail the enable itself (the box is still usable without silent
  // capture), so it's logged, not thrown.
  await syncRelayRegistration(config).catch((e: unknown) => {
    console.error("[callback-clerk] relay registration failed on enable:", e);
  });
  return config;
}

export async function disableBox(boxUrl: string): Promise<ClerkConfig> {
  const config = removeBox(await loadConfig(), boxUrl);
  await saveConfig(config);
  await syncRelayRegistration(config).catch((e: unknown) => {
    console.error("[callback-clerk] relay registration failed on disable:", e);
  });
  return config;
}

export async function activateBox(boxUrl: string): Promise<ClerkConfig> {
  const config = setActiveBox(await loadConfig(), boxUrl);
  await saveConfig(config);
  return config;
}

/** Reorders the box list (popup edit mode). No relay change — same boxes. */
export async function reorderBox(move: { boxUrl: string; delta: -1 | 1 }): Promise<ClerkConfig> {
  const config = moveBox(await loadConfig(), move);
  await saveConfig(config);
  return config;
}
