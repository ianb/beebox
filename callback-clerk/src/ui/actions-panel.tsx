import { useCallback, useEffect, useState } from "react";
import type { EnabledBox } from "../domain/config.js";
import type { ActionResponse, ClerkMessage } from "../domain/messages.js";
import type { CommentaryDestination } from "../contract/clerk-contract.generated.js";
import { getCommentaryDestinations } from "../platform/clerk-api.js";
import { commentBlockedReason } from "../domain/commentary.js";

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
  const [tab, setTab] = useState<CurrentTab | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<CommentaryDestination[]>([]);
  const [selectedDir, setSelectedDir] = useState("");

  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const current = tabs[0];
        const reason = commentBlockedReason(current?.url);
        if (reason !== null) {
          setBlocked(reason);
          return;
        }
        if (current?.id === undefined) {
          setBlocked("No page to comment on.");
          return;
        }
        setTab({ id: current.id, url: current.url ?? "", title: current.title ?? "" });
      })
      .catch((err: unknown) => {
        console.error("[clerk] failed to query active tab:", err);
        setBlocked("Couldn't read the current tab.");
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
      .catch((err: unknown) => {
        console.error("[clerk] failed to load commentary destinations:", err);
        setDestinations([]);
      });
  }, [box]);

  const runAction = useCallback(
    (params: { label: string; message: ClerkMessage; okText: string }) => {
      setBusy(params.label);
      setNotice(null);
      // sendAction's Promise executor has no reject path (chrome.runtime.
      // lastError is translated into a resolved { ok: false } response
      // instead) -- it structurally cannot reject.
      void sendAction(params.message).then((response) => {
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

  const handleOpenBox = useCallback(() => {
    // User-initiated action (policy rule 5): surface via the existing
    // notice banner rather than silently no-opping.
    chrome.tabs.create({ url: box.boxUrl }).catch((err: unknown) => {
      console.error("[clerk] failed to open box tab:", err);
      setNotice({ kind: "error", text: "Could not open the box tab." });
    });
  }, [box.boxUrl]);

  return (
    <div className="mb-3 space-y-3 border-b border-gray-200 pb-3">
      <CommentSection
        busyLabel={busy}
        blockedReason={blocked}
        destinations={destinations}
        selectedDir={selectedDir}
        onSelectDir={handleSelectDir}
        onComment={handleComment}
      />
      {notice !== null ? <NoticeLine notice={notice} onOpenBox={handleOpenBox} /> : null}
    </div>
  );
}

interface CommentSectionProps {
  busyLabel: string | null;
  blockedReason: string | null;
  destinations: CommentaryDestination[];
  selectedDir: string;
  onSelectDir: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onComment: () => void;
}

function CommentSection(props: CommentSectionProps) {
  const { busyLabel, blockedReason, destinations, selectedDir, onSelectDir, onComment } = props;
  const blocked = blockedReason !== null;
  return (
    <div className="space-y-2">
      {/* The tooltip lives on the wrapper: a disabled button fires no mouse
          events, so its own title attribute would never show. */}
      <span className="block" title={blockedReason ?? undefined}>
        <button
          onClick={onComment}
          disabled={busyLabel !== null || blocked}
          className="w-full rounded bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
        >
          {busyLabel === "comment" ? "Creating commentary…" : "Comment on this page"}
        </button>
      </span>
      {/* Nothing to file when there's no page to file — the tooltip carries the why. */}
      {blocked ? null : (
        <DestinationPicker
          destinations={destinations}
          selectedDir={selectedDir}
          onSelectDir={onSelectDir}
        />
      )}
    </div>
  );
}

interface DestinationPickerProps {
  destinations: CommentaryDestination[];
  selectedDir: string;
  onSelectDir: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

/** A selector when the box offers several destinations; a note when it offers one. */
function DestinationPicker({ destinations, selectedDir, onSelectDir }: DestinationPickerProps) {
  const soleDestination = destinations.length === 1 ? destinations[0] ?? null : null;
  if (destinations.length > 1) {
    return (
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
    );
  }
  if (soleDestination === null) return null;
  return (
    <p className="text-xs text-gray-500">
      Filing to {soleDestination.symbol !== null ? `${soleDestination.symbol} ` : ""}
      {soleDestination.label}
    </p>
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
