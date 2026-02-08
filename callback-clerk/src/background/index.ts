import { createDropboxClient } from "../lib/dropbox";
import { getTabSnapshot } from "../lib/tabs";
import {
  getSyncState,
  saveSyncState,
  getPendingActions,
  savePendingActions,
  removePendingAction,
} from "../lib/storage";

// Set up 1-minute polling alarm
chrome.alarms.create("poll", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll") {
    pollMessages();
  }
});

// Restore badge on startup/install
chrome.runtime.onInstalled.addListener(() => updateBadge());
chrome.runtime.onStartup.addListener(() => updateBadge());

// Handle messages from popup/sidepanel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "syncNow") {
    sync().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "sendMessage") {
    sendUserMessage(message.text, message.url).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
  if (message.type === "paired") {
    pollMessages().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "dismissAction") {
    removePendingAction(message.id)
      .then(() => updateBadge())
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "unpaired") {
    sendResponse({ ok: true });
  }
});

async function pollMessages() {
  const client = await createDropboxClient();
  if (!client) return;

  try {
    const state = await getSyncState();
    const messages = await client.poll({
      since: state?.lastMessageId ?? undefined,
    });

    const pending = await getPendingActions();
    let lastId = state?.lastMessageId ?? null;

    for (const msg of messages) {
      if (msg.sender === "clerk") continue;
      lastId = msg.id;

      const data = msg.data as Record<string, unknown>;
      if (data.type === "open-tab") {
        pending.push({
          id: msg.id,
          type: "open-tab",
          url: data.url as string,
          title: data.title as string,
          message: data.message as string,
          receivedAt: new Date().toISOString(),
        });
      }

      await client.deleteMessage(msg.id);
    }

    await savePendingActions(pending);
    await saveSyncState({
      lastSyncAt: state?.lastSyncAt ?? null,
      tabCount: state?.tabCount ?? null,
      lastMessageId: lastId,
    });
    await updateBadge();
  } catch (err) {
    console.error("[callback-clerk] poll error:", err);
  }
}

async function updateBadge() {
  const actions = await getPendingActions();
  const count = actions.length;
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
}

async function sync() {
  const client = await createDropboxClient();
  if (!client) return;

  try {
    const tabs = await getTabSnapshot();
    await client.send(
      { type: "tabs", tabs },
      { sender: "clerk", contentType: "application/json" }
    );

    await saveSyncState({
      lastSyncAt: new Date().toISOString(),
      tabCount: tabs.length,
      lastMessageId: (await getSyncState())?.lastMessageId ?? null,
    });

    // Also poll while we're at it
    await pollMessages();
  } catch (err) {
    console.error("[callback-clerk] sync error:", err);
  }
}

async function sendUserMessage(text: string, url: string) {
  const client = await createDropboxClient();
  if (!client) return;

  try {
    await client.send(
      { type: "memo", text, url },
      { sender: "clerk", contentType: "application/json" }
    );
  } catch (err) {
    console.error("[callback-clerk] sendMessage error:", err);
  }
}
