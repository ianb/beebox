/**
 * `browse clerk-popup <tab>`: open the Clerk's popup as it would open over
 * `<tab>`, in a tab of its own labeled `clerk-popup`.
 *
 * The popup acts on "the active tab in its window", read once when it mounts.
 * Opened as a page it would see itself. So the popup tab is opened, the target
 * tab is brought to the front, and the popup reloads in the background: it
 * mounts with the target as its active tab, and keeps acting on it after this
 * command brings the popup forward for clicks and screenshots.
 *
 * Needs `BROWSE_CLERK=1`, which loads the Clerk test build (bin/browse).
 */

import { createHash } from "node:crypto";
import { run } from "agent-browser-typed";
import { BrowseConfigError } from "./worktree.js";

const POPUP_LABEL = "clerk-popup";
const MOUNT_TIMEOUT_MS = 10_000;
const POLL_MS = 200;

/** Chrome's id for an unpacked extension: sha256 of its absolute path, 32 hex digits spelled a–p. */
export function unpackedExtensionId(extensionDir: string): string {
  const hex = createHash("sha256").update(extensionDir).digest("hex").slice(0, 32);
  return [...hex].map((digit) => "abcdefghijklmnop"[Number.parseInt(digit, 16)]).join("");
}

/** The eval that fronts the target tab and reloads the popup behind it. */
export function frontTargetScript(targetUrl: string): string {
  const url = JSON.stringify(targetUrl);
  return `chrome.tabs.query({}).then((tabs) => {
    const matches = tabs.filter((tab) => tab.url === ${url});
    if (matches.length > 1) return "ambiguous";
    const target = matches[0];
    if (target === undefined || target.id === undefined) return "no-target";
    return chrome.tabs.update(target.id, { active: true }).then(() => { setTimeout(() => location.reload(), 100); return "ok"; });
  })`;
}

async function stdoutOf(args: readonly string[]): Promise<string> {
  return (await run(args, { timeoutMs: 30_000 })).stdout.trim();
}

/** The quoted JSON string agent-browser prints for an eval result, unquoted. */
function evalValue(stdout: string): string {
  const last = stdout.split("\n").at(-1) ?? "";
  try {
    const parsed: unknown = JSON.parse(last);
    return typeof parsed === "string" ? parsed : last;
  } catch (_e) {
    return last;
  }
}

export async function openClerkPopup(target: string | undefined): Promise<number> {
  const extensionDir = process.env["BROWSE_CLERK_EXTENSION_DIR"];
  if (extensionDir === undefined || extensionDir === "") {
    throw new BrowseConfigError("clerk-popup needs BROWSE_CLERK=1, which loads the Clerk test build");
  }
  if (target === undefined) throw new BrowseConfigError("usage: browse clerk-popup <tab id or label>");
  await stdoutOf(["tab", target]);
  const targetUrl = evalValue(await stdoutOf(["get", "url"]));
  // A popup tab from an earlier call holds the earlier target; start fresh.
  await run(["tab", "close", POPUP_LABEL], { timeoutMs: 30_000 }).catch(() => null);
  const popupUrl = `chrome-extension://${unpackedExtensionId(extensionDir)}/popup.html`;
  await stdoutOf(["tab", "new", "--label", POPUP_LABEL, popupUrl]);
  const fronted = evalValue(await stdoutOf(["eval", frontTargetScript(targetUrl)]));
  // Tabs are matched by URL (agent-browser's tab ids are not Chrome's); two
  // tabs at one URL could hold different content, so refuse to guess.
  if (fronted === "ambiguous") throw new BrowseConfigError(`clerk-popup: more than one tab is at ${targetUrl}; close the others`);
  if (fronted !== "ok") throw new BrowseConfigError(`clerk-popup: no tab at ${targetUrl} to act on`);
  // The reload is asynchronous: wait until the popup has mounted again over the target.
  const deadline = Date.now() + MOUNT_TIMEOUT_MS;
  for (;;) {
    const mounted = evalValue(await stdoutOf(["eval", "String(performance.timeOrigin > 0 && document.readyState === 'complete' && performance.getEntriesByType('navigation')[0]?.type === 'reload' && document.querySelector('h1') !== null)"]));
    if (mounted === "true") break;
    if (Date.now() > deadline) throw new BrowseConfigError("clerk-popup: the popup did not mount again within 10s");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  await stdoutOf(["tab", POPUP_LABEL]);
  process.stdout.write(`clerk popup over ${targetUrl}, in tab "${POPUP_LABEL}"\n`);
  return 0;
}

