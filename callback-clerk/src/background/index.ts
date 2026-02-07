import { createDropboxClient } from "../lib/dropbox";
import { getTabSnapshot } from "../lib/tabs";
import { getSyncState, saveSyncState } from "../lib/storage";

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
  if (message.type === "unpaired") {
    sendResponse({ ok: true });
  }
});

async function sync() {
  const client = await createDropboxClient();
  if (!client) return;

  try {
    const tabs = await getTabSnapshot();
    await client.send(
      { type: "tabs", tabs },
      { sender: "clerk", contentType: "application/json" }
    );

    const state = await getSyncState();
    const messages = await client.poll({
      since: state?.lastMessageId ?? undefined,
    });

    let lastId = state?.lastMessageId ?? null;
    for (const msg of messages) {
      if (msg.sender !== "clerk") {
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

async function sendUserMessage(text: string, url: string) {
  const client = await createDropboxClient();
  if (!client) return;

  try {
    await client.send(
      { type: "message", text, url },
      { sender: "clerk", contentType: "application/json" }
    );
  } catch (err) {
    console.error("[callback-clerk] sendMessage error:", err);
  }
}
