import { useEffect, useState } from "react";
import {
  getCredentials,
  getSyncState,
  type StoredCredentials,
  type SyncState,
} from "../lib/storage";

export default function App() {
  const [credentials, setCredentials] = useState<StoredCredentials | null>(
    null
  );
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getCredentials(), getSyncState()]).then(([creds, state]) => {
      setCredentials(creds);
      setSyncState(state);
      setLoading(false);
    });

    // Listen for storage changes to update in real-time
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local") return;
      if (changes.credentials) {
        setCredentials(changes.credentials.newValue ?? null);
      }
      if (changes.syncState) {
        setSyncState(changes.syncState.newValue ?? null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">Loading...</div>
    );
  }

  if (!credentials) {
    return (
      <div className="p-4">
        <h1 className="text-lg font-semibold mb-2">Callback Clerk</h1>
        <p className="text-sm text-gray-600">
          Not connected. Use the popup to enter a pairing code.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold mb-4">Callback Clerk</h1>

      <section className="mb-4">
        <h2 className="text-sm font-medium text-gray-500 mb-1">Status</h2>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm">Connected</span>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Channel: {credentials.channelId.slice(0, 8)}...
        </div>
        {syncState?.lastSyncAt && (
          <div className="text-xs text-gray-500">
            Last sync: {new Date(syncState.lastSyncAt).toLocaleTimeString()}
          </div>
        )}
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-medium text-gray-500 mb-1">Tabs</h2>
        {syncState?.tabCount != null ? (
          <p className="text-sm">{syncState.tabCount} tabs tracked</p>
        ) : (
          <p className="text-sm text-gray-400">No tab data yet</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-gray-500 mb-1">Actions</h2>
        <button
          onClick={() => chrome.runtime.sendMessage({ type: "syncNow" })}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          Sync Now
        </button>
      </section>
    </div>
  );
}
