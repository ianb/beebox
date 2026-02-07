import { type StoredCredentials, clearCredentials, getSyncState } from "../lib/storage";
import { useEffect, useState } from "react";

interface StatusViewProps {
  credentials: StoredCredentials;
  onUnpair: () => void;
}

export default function StatusView({ credentials, onUnpair }: StatusViewProps) {
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    getSyncState().then((state) => {
      setLastSync(state?.lastSyncAt ?? null);
    });
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.url) {
        setCurrentUrl(tabs[0].url);
      }
    });
  }, []);

  async function handleUnpair() {
    await clearCredentials();
    chrome.runtime.sendMessage({ type: "unpaired" });
    onUnpair();
  }

  async function handleOpenSidePanel() {
    const win = await chrome.windows.getCurrent();
    if (win.id != null) {
      await chrome.sidePanel.open({ windowId: win.id });
    }
    window.close();
  }

  function handleSyncNow() {
    chrome.runtime.sendMessage({ type: "syncNow" });
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    chrome.runtime.sendMessage(
      { type: "sendMessage", text: message.trim(), url: currentUrl },
      () => {
        setSending(false);
        setSent(true);
        setMessage("");
        setTimeout(() => setSent(false), 2000);
      }
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold mb-3">Callback Clerk</h1>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-gray-700">Connected</span>
        </div>

        <form onSubmit={handleSend}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Send a message..."
            rows={3}
            className="w-full px-3 py-2 border rounded text-sm resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
          {currentUrl && (
            <div className="text-xs text-gray-400 truncate mt-1">
              {currentUrl}
            </div>
          )}
          <button
            type="submit"
            disabled={sending || !message.trim()}
            className="w-full mt-2 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {sent ? "Sent!" : sending ? "Sending..." : "Send"}
          </button>
        </form>

        <div className="flex gap-2">
          <button
            onClick={handleSyncNow}
            className="flex-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
          >
            Sync Tabs
          </button>
          <button
            onClick={handleOpenSidePanel}
            className="flex-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
          >
            Side Panel
          </button>
        </div>

        <div className="text-xs text-gray-400">
          Channel: {credentials.channelId.slice(0, 8)}...
          {lastSync && (
            <> &middot; Last sync: {new Date(lastSync).toLocaleTimeString()}</>
          )}
        </div>

        <button
          onClick={handleUnpair}
          className="w-full px-3 py-1.5 text-red-600 text-xs hover:text-red-800"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
