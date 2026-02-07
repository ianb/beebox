import { createDropboxClient } from "../lib/dropbox";
import { getTabSnapshot } from "../lib/tabs";
import { getSyncState, saveSyncState, getCredentials } from "../lib/storage";

const ALARM_NAME = "callback-clerk-sync";
const SYNC_INTERVAL_MINUTES = 1;

// Set up periodic sync alarm
chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await sync();
  }
});

// Handle messages from popup/sidepanel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "paired" || message.type === "syncNow") {
    sync().then(() => sendResponse({ ok: true }));
    return true; // keep channel open for async response
  }
  if (message.type === "unpaired") {
    chrome.alarms.clear(ALARM_NAME);
    sendResponse({ ok: true });
  }
  if (message.type === "openSidePanel") {
    chrome.sidePanel
      .open({ windowId: _sender.tab?.windowId })
      .catch(() => {
        // sidePanel.open requires a user gesture in some contexts; ignore errors
      });
    sendResponse({ ok: true });
  }
});

// On install, check if already paired and start syncing
chrome.runtime.onInstalled.addListener(async () => {
  const creds = await getCredentials();
  if (creds) {
    await sync();
  }
});

async function sync() {
  const client = await createDropboxClient();
  if (!client) return;

  try {
    // Send tab snapshot
    const tabs = await getTabSnapshot();
    await client.send(
      { type: "tabs", tabs },
      { sender: "clerk", contentType: "application/json" }
    );

    // Poll for incoming messages
    const state = await getSyncState();
    const messages = await client.poll({
      since: state?.lastMessageId ?? undefined,
    });

    // For now, just acknowledge received messages
    let lastId = state?.lastMessageId ?? null;
    for (const msg of messages) {
      if (msg.sender !== "clerk") {
        // Process messages from the agent — for now just track the ID
        lastId = msg.id;
      }
    }

    await saveSyncState({
      lastSyncAt: new Date().toISOString(),
      tabCount: tabs.length,
      lastMessageId: lastId,
    });
  } catch (err) {
    console.error("[callback-clerk] sync error:", err);
  }
}
