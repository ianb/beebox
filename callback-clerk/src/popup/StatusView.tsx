import {
  type StoredCredentials,
  type PendingAction,
  clearCredentials,
  getSyncState,
  getPendingActions,
} from "../lib/storage";
import { useCallback, useEffect, useState } from "react";

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
  const [savingPage, setSavingPage] = useState<"save" | "do" | null>(null);
  const [savedPage, setSavedPage] = useState<"save" | "do" | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);

  useEffect(() => {
    getSyncState().then((state) => {
      setLastSync(state?.lastSyncAt ?? null);
    });
    getPendingActions().then(setPendingActions);
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.url) {
        setCurrentUrl(tabs[0].url);
      }
    });

    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.pendingActions) {
        setPendingActions((changes.pendingActions.newValue as PendingAction[] | undefined) ?? []);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const handleUnpair = useCallback(async () => {
    await clearCredentials();
    chrome.runtime.sendMessage({ type: "unpaired" });
    onUnpair();
  }, [onUnpair]);

  const handleOpenSidePanel = useCallback(async () => {
    const win = await chrome.windows.getCurrent();
    if (win.id != null) {
      await chrome.sidePanel.open({ windowId: win.id });
    }
    window.close();
  }, []);

  const handleSyncNow = useCallback(() => {
    chrome.runtime.sendMessage({ type: "syncNow" });
  }, []);

  const handleSend = useCallback(async (e: React.FormEvent) => {
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
  }, [message, currentUrl]);

  const handleMessageChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }, [handleSend]);

  const handleSavePage = useCallback((intent: "save" | "do") => {
    setSavingPage(intent);
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;
      const msgType = intent === "save" ? "savePage" : "doPage";
      chrome.runtime.sendMessage({ type: msgType, tabId }, () => {
        setSavedPage(intent);
        setSavingPage(null);
      });
    });
  }, []);

  const handleSavePageSave = useCallback(() => {
    handleSavePage("save");
  }, [handleSavePage]);

  const handleSavePageDo = useCallback(() => {
    handleSavePage("do");
  }, [handleSavePage]);

  const dismissAction = useCallback((id: string) => {
    chrome.runtime.sendMessage({ type: "dismissAction", id });
  }, []);

  const openAction = useCallback((action: PendingAction) => {
    chrome.tabs.create({ url: action.url });
    chrome.runtime.sendMessage({ type: "dismissAction", id: action.id });
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold mb-3">Callback Clerk</h1>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-gray-700">Connected</span>
        </div>

        {pendingActions.length > 0 ? (
          <div className="space-y-2">
            {pendingActions.map((action) => (
              <PendingActionCard
                key={action.id}
                action={action}
                onOpen={openAction}
                onDismiss={dismissAction}
              />
            ))}
          </div>
        ) : null}

        {currentUrl ? (
          <div className="flex gap-2">
            <button
              onClick={handleSavePageSave}
              disabled={savingPage !== null || savedPage !== null}
              className="flex-1 px-3 py-2 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
            >
              {savedPage === "save" ? "Saved!" : savingPage === "save" ? "Saving..." : "Save"}
            </button>
            <button
              onClick={handleSavePageDo}
              disabled={savingPage !== null || savedPage !== null}
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {savedPage === "do" ? "Saved!" : savingPage === "do" ? "Saving..." : "Do"}
            </button>
          </div>
        ) : null}

        <form onSubmit={handleSend}>
          <textarea
            value={message}
            onChange={handleMessageChange}
            placeholder="Send a message..."
            rows={3}
            className="w-full px-3 py-2 border rounded text-sm resize-none"
            onKeyDown={handleKeyDown}
          />
          {currentUrl ? (
            <div className="text-xs text-gray-400 truncate mt-1">
              {currentUrl}
            </div>
          ) : null}
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
          {lastSync ? (
            <> &middot; Last sync: {new Date(lastSync).toLocaleTimeString()}</>
          ) : null}
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

interface PendingActionCardProps {
  action: PendingAction;
  onOpen: (action: PendingAction) => void;
  onDismiss: (id: string) => void;
}

function PendingActionCard({ action, onOpen, onDismiss }: PendingActionCardProps) {
  const handleOpen = useCallback(() => {
    onOpen(action);
  }, [onOpen, action]);

  const handleDismiss = useCallback(() => {
    onDismiss(action.id);
  }, [onDismiss, action.id]);

  return (
    <div className="border border-amber-300 bg-amber-50 rounded p-2">
      <div className="text-sm font-medium">{action.title}</div>
      <div className="text-xs text-gray-500 truncate">
        {action.url}
      </div>
      {action.message ? (
        <div className="text-xs text-gray-600 mt-1">
          {action.message}
        </div>
      ) : null}
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleOpen}
          className="flex-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
        >
          Open
        </button>
        <button
          onClick={handleDismiss}
          className="flex-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
