import { useCallback, useEffect, useState } from "react";
import type { EnabledBox } from "../domain/config.js";
import type { ActionResponse, ClerkMessage } from "../domain/messages.js";
import type { SaveIntent } from "../domain/save-page.js";
import type { CommentaryDestination } from "../domain/commentary.js";
import { getCommentaryDestinations } from "../platform/clerk-api.js";

interface Notice {
  kind: "ok" | "error" | "auth";
  text: string;
}

interface CurrentTab {
  id: number;
  url: string;
  title: string;
}

function sendAction(message: ClerkMessage): Promise<ActionResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: ActionResponse | undefined) => {
      if (chrome.runtime.lastError || response === undefined) {
        const detail = chrome.runtime.lastError?.message ?? "no response from background";
        resolve({ ok: false, status: 0, message: detail });
        return;
      }
      resolve(response);
    });
  });
}

function toNotice(response: ActionResponse, okText: string): Notice {
  if (response.ok) return { kind: "ok", text: okText };
  if (response.status === 401 || response.status === 403) {
    return { kind: "auth", text: "Session expired — open the box to sign in." };
  }
  return { kind: "error", text: response.message };
}

interface ActionsPanelProps {
  box: EnabledBox;
}

export function ActionsPanel({ box }: ActionsPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [memo, setMemo] = useState("");
  const [tab, setTab] = useState<CurrentTab | null>(null);
  const [destinations, setDestinations] = useState<CommentaryDestination[]>([]);
  const [selectedDir, setSelectedDir] = useState("");

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const current = tabs[0];
      if (current === undefined || current.id === undefined) return;
      const url = current.url ?? "";
      if (!url.startsWith("http://") && !url.startsWith("https://")) return;
      setTab({ id: current.id, url, title: current.title ?? "" });
    });
  }, []);

  // Load the box's commentary destinations. With exactly one, file there
  // automatically (no selector); with several, the user picks (default inbox).
  useEffect(() => {
    getCommentaryDestinations(box)
      .then((dests) => {
        setDestinations(dests);
        const sole = dests.length === 1 ? dests[0] : undefined;
        if (sole !== undefined) setSelectedDir(sole.dir);
      })
      .catch(() => setDestinations([]));
  }, [box]);

  const runAction = useCallback(
    (params: { label: string; message: ClerkMessage; okText: string }) => {
      setBusy(params.label);
      setNotice(null);
      sendAction(params.message).then((response) => {
        setBusy(null);
        setNotice(toNotice(response, params.okText));
      });
    },
    [],
  );

  const handleComment = useCallback(() => {
    if (tab === null) return;
    const message: ClerkMessage =
      selectedDir === ""
        ? { type: "commentOnPage", tabId: tab.id }
        : { type: "commentOnPage", tabId: tab.id, destinationDir: selectedDir };
    runAction({ label: "comment", message, okText: "Commentary created — opening…" });
  }, [tab, selectedDir, runAction]);

  const handleSelectDir = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDir(e.target.value);
  }, []);

  const handleSavePage = useCallback(() => {
    if (tab === null) return;
    const message: ClerkMessage = { type: "savePage", intent: "save" as SaveIntent, tabId: tab.id };
    runAction({ label: "save", message, okText: "Page saved" });
  }, [tab, runAction]);

  const handleDoPage = useCallback(() => {
    if (tab === null) return;
    const message: ClerkMessage = { type: "savePage", intent: "do" as SaveIntent, tabId: tab.id };
    runAction({ label: "do", message, okText: "Page saved as to-do" });
  }, [tab, runAction]);

  const handleSendMemo = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = memo.trim();
      if (text === "") return;
      setMemo("");
      runAction({
        label: "memo",
        message: { type: "sendMemo", text, url: tab?.url, title: tab?.title },
        okText: "Memo sent",
      });
    },
    [memo, tab, runAction],
  );

  const handleMemoChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMemo(e.target.value);
  }, []);

  const handleSyncTabs = useCallback(() => {
    runAction({ label: "tabs", message: { type: "syncTabs" }, okText: "Tabs synced" });
  }, [runAction]);

  const handleOpenBox = useCallback(() => {
    chrome.tabs.create({ url: box.boxUrl });
  }, [box.boxUrl]);

  return (
    <div className="mt-3 space-y-3 border-t border-gray-200 pt-3">
      {tab !== null ? (
        <CommentSection
          busyLabel={busy}
          destinations={destinations}
          selectedDir={selectedDir}
          onSelectDir={handleSelectDir}
          onComment={handleComment}
        />
      ) : null}
      <div className="space-y-2 border-t border-gray-100 pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Other actions</p>
        {tab !== null ? (
          <SaveButtons busyLabel={busy} onSave={handleSavePage} onDo={handleDoPage} />
        ) : null}
        <form onSubmit={handleSendMemo}>
          <textarea
            value={memo}
            onChange={handleMemoChange}
            placeholder={`Send a memo to ${box.title}…`}
            rows={2}
            className="w-full resize-none rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <SubmitRow isBusy={busy !== null} canSend={memo.trim() !== ""} onSyncTabs={handleSyncTabs} />
        </form>
      </div>
      {notice !== null ? <NoticeLine notice={notice} onOpenBox={handleOpenBox} /> : null}
    </div>
  );
}

interface CommentSectionProps {
  busyLabel: string | null;
  destinations: CommentaryDestination[];
  selectedDir: string;
  onSelectDir: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onComment: () => void;
}

function CommentSection({ busyLabel, destinations, selectedDir, onSelectDir, onComment }: CommentSectionProps) {
  const soleDestination = destinations.length === 1 ? destinations[0] ?? null : null;
  return (
    <div className="space-y-2">
      <button
        onClick={onComment}
        disabled={busyLabel !== null}
        className="w-full rounded bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {busyLabel === "comment" ? "Creating commentary…" : "Comment on this page"}
      </button>
      {destinations.length > 1 ? (
        <label className="block text-xs text-gray-500">
          File to
          <select
            value={selectedDir}
            onChange={onSelectDir}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800"
          >
            <option value="">Inbox</option>
            {destinations.map((d) => (
              <option key={d.dir} value={d.dir}>
                {d.symbol !== null ? `${d.symbol} ` : ""}{d.label}
              </option>
            ))}
          </select>
        </label>
      ) : soleDestination !== null ? (
        <p className="text-xs text-gray-500">
          Filing to {soleDestination.symbol !== null ? `${soleDestination.symbol} ` : ""}
          {soleDestination.label}
        </p>
      ) : null}
    </div>
  );
}

interface SaveButtonsProps {
  busyLabel: string | null;
  onSave: () => void;
  onDo: () => void;
}

function SaveButtons({ busyLabel, onSave, onDo }: SaveButtonsProps) {
  return (
    <div className="flex gap-2">
      <button
        onClick={onSave}
        disabled={busyLabel !== null}
        className="flex-1 rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {busyLabel === "save" ? "Saving…" : "Save page"}
      </button>
      <button
        onClick={onDo}
        disabled={busyLabel !== null}
        className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busyLabel === "do" ? "Saving…" : "Do page"}
      </button>
    </div>
  );
}

interface SubmitRowProps {
  isBusy: boolean;
  canSend: boolean;
  onSyncTabs: () => void;
}

function SubmitRow({ isBusy, canSend, onSyncTabs }: SubmitRowProps) {
  return (
    <div className="mt-1 flex gap-2">
      <button
        type="submit"
        disabled={isBusy || !canSend}
        className="flex-1 rounded bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
      >
        Send memo
      </button>
      <button
        type="button"
        onClick={onSyncTabs}
        disabled={isBusy}
        className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
      >
        Sync tabs
      </button>
    </div>
  );
}

interface NoticeLineProps {
  notice: Notice;
  onOpenBox: () => void;
}

function NoticeLine({ notice, onOpenBox }: NoticeLineProps) {
  if (notice.kind === "ok") {
    return <p className="text-sm text-teal-700">{notice.text}</p>;
  }
  if (notice.kind === "auth") {
    return (
      <p className="text-sm text-red-700">
        {notice.text}{" "}
        <button onClick={onOpenBox} className="underline">
          Open box
        </button>
      </p>
    );
  }
  return <p className="break-words text-sm text-red-700">{notice.text}</p>;
}
