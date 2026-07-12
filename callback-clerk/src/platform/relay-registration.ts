/**
 * Registers the box-relay content script dynamically (Track C of
 * docs/plans/see-as-the-user.md). Unlike the manifest-static path, we register
 * at box-enable time with match patterns derived from each enabled box's full
 * boxUrl (path-scoped — see relay-auth.ts), persist the registration across
 * browser restarts, and reconcile against the stored config on startup so the
 * registered patterns never drift from the enabled-box list.
 */

import { boxUrlToMatchPatterns } from "../domain/relay-auth.js";
import type { ClerkConfig } from "../domain/config.js";

const RELAY_SCRIPT_ID = "callback-clerk-box-relay";
// WXT builds `box-relay.content.ts` to this path (mirrors the injected
// `content-scripts/commentary-capture.js`).
const RELAY_SCRIPT_JS = "content-scripts/box-relay.js";

/** Dedup'd, sorted match patterns covering every enabled box. */
function desiredMatches(config: ClerkConfig): string[] {
  const patterns = new Set<string>();
  for (const box of config.boxes) {
    for (const pattern of boxUrlToMatchPatterns(box.boxUrl)) patterns.add(pattern);
  }
  return [...patterns].toSorted();
}

function sameMatches(a: string[] | undefined, b: string[]): boolean {
  if (a === undefined || a.length !== b.length) return false;
  const sortedA = a.toSorted();
  return sortedA.every((value, i) => value === b[i]);
}

async function currentRegistration(): Promise<chrome.scripting.RegisteredContentScript | undefined> {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [RELAY_SCRIPT_ID] });
  return registered[0];
}

/**
 * Brings the relay content-script registration in line with `config`:
 * registers on first enable, updates match patterns when the enabled set
 * changes, and unregisters when no boxes remain. Idempotent — safe to call on
 * every enable/disable and once on background startup (drift reconciliation).
 */
export async function syncRelayRegistration(config: ClerkConfig): Promise<void> {
  const matches = desiredMatches(config);
  const current = await currentRegistration();

  // TEMP diagnostics (remove once relay injection is confirmed working): show
  // the desired patterns, whether we already hold host permission for them, and
  // the current registration — so a failing enable is diagnosable from the SW
  // console without re-running with a debugger attached.
  let hasPermission: boolean | string;
  try {
    hasPermission = matches.length === 0 ? true : await chrome.permissions.contains({ origins: matches });
  } catch (e) {
    hasPermission = `contains() threw: ${e instanceof Error ? e.message : String(e)}`;
  }
  console.info(
    "[relay-reg] sync:",
    JSON.stringify({ boxes: config.boxes.map((b) => b.boxUrl), matches, hasPermissionForMatches: hasPermission, alreadyRegistered: current !== undefined }),
  );

  if (matches.length === 0) {
    if (current !== undefined) {
      await chrome.scripting.unregisterContentScripts({ ids: [RELAY_SCRIPT_ID] });
      console.info("[relay-reg] unregistered (no enabled boxes)");
    }
    return;
  }

  const script: chrome.scripting.RegisteredContentScript = {
    id: RELAY_SCRIPT_ID,
    js: [RELAY_SCRIPT_JS],
    matches,
    runAt: "document_idle",
    allFrames: false,
    persistAcrossSessions: true,
  };

  try {
    if (current === undefined) {
      await chrome.scripting.registerContentScripts([script]);
      console.info("[relay-reg] registered", JSON.stringify(matches));
    } else if (!sameMatches(current.matches, matches)) {
      await chrome.scripting.updateContentScripts([{ id: RELAY_SCRIPT_ID, js: [RELAY_SCRIPT_JS], matches }]);
      console.info("[relay-reg] updated", JSON.stringify(matches));
    } else {
      console.info("[relay-reg] already up to date");
    }
  } catch (e) {
    // Surface loudly AND rethrow — the caller (enable-box) also logs. The most
    // likely cause is a match pattern not covered by a granted host permission.
    console.error("[relay-reg] registerContentScripts FAILED for", JSON.stringify(matches), e);
    throw e;
  }
}
