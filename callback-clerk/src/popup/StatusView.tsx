import { type StoredCredentials, clearCredentials, getSyncState } from "../lib/storage";
import { useEffect, useState } from "react";

interface StatusViewProps {
  credentials: StoredCredentials;
  onUnpair: () => void;
}

export default function StatusView({ credentials, onUnpair }: StatusViewProps) {
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    getSyncState().then((state) => {
      setLastSync(state?.lastSyncAt ?? null);
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

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold mb-3">Callback Clerk</h1>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-gray-700">Connected</span>
        </div>
        <div className="text-xs text-gray-500">
          Channel: {credentials.channelId.slice(0, 8)}...
        </div>
        {lastSync && (
          <div className="text-xs text-gray-500">
            Last sync: {new Date(lastSync).toLocaleTimeString()}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleSyncNow}
            className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            Sync Now
          </button>
          <button
            onClick={handleOpenSidePanel}
            className="flex-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
          >
            Side Panel
          </button>
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
