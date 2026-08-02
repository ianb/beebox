import { useCallback, useEffect, useState } from "react";
import { getActiveBox, isBoxEnabled, type ClerkConfig, type EnabledBox } from "../domain/config.js";
import { loadConfig } from "../platform/config-storage.js";
import { detectBoxOnActiveTab } from "../platform/detect-box.js";
import { activateBox, disableBox, enableBox } from "../platform/enable-box.js";
import { openBox } from "../platform/open-box.js";
import { ActionsPanel } from "./actions-panel.js";

export function PopupApp() {
  const [config, setConfig] = useState<ClerkConfig | null>(null);
  const [detected, setDetected] = useState<EnabledBox | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig).catch((err: unknown) => {
      console.error("[clerk] failed to load config:", err);
    });
    detectBoxOnActiveTab().then(setDetected).catch((err: unknown) => {
      console.error("[clerk] failed to detect box on active tab:", err);
    });
  }, []);

  const handleEnable = useCallback(() => {
    if (detected === null) return;
    // enableBox calls permissions.request first — it must stay inside the
    // click gesture, so no awaits before this call.
    enableBox(detected)
      .then((next) => {
        if (next !== null) setConfig(next);
      })
      .catch((err: unknown) => {
        console.error("[clerk] failed to enable box:", err);
      });
  }, [detected]);

  const handleActivate = useCallback((boxUrl: string) => {
    activateBox(boxUrl).then(setConfig).catch((err: unknown) => {
      console.error("[clerk] failed to activate box:", err);
    });
  }, []);

  const handleDisable = useCallback((boxUrl: string) => {
    disableBox(boxUrl).then(setConfig).catch((err: unknown) => {
      console.error("[clerk] failed to disable box:", err);
    });
  }, []);

  const handleOpen = useCallback((boxUrl: string) => {
    openBox(boxUrl)
      .then(() => {
        window.close(); // the popup has served its purpose once the tab is up
      })
      .catch((err: unknown) => {
        console.error("[clerk] failed to open box:", err);
      });
  }, []);

  if (config === null) {
    return <div className="w-80 p-4 text-sm text-gray-500">Loading…</div>;
  }

  const showOffer = detected !== null && !isBoxEnabled(config, detected.boxUrl);
  const activeBox = getActiveBox(config);

  return (
    <div className="w-80 p-4">
      <PopupHeader />
      {showOffer ? (
        <EnableOffer box={detected} onEnable={handleEnable} />
      ) : null}
      {/* Above the box list: the primary action must not move as boxes pile up. */}
      {activeBox !== null ? <ActionsPanel box={activeBox} /> : null}
      {config.boxes.length > 0 ? (
        <BoxList
          boxes={config.boxes}
          activeBoxUrl={config.activeBoxUrl}
          onActivate={handleActivate}
          onDisable={handleDisable}
          onOpen={handleOpen}
        />
      ) : null}
      {config.boxes.length === 0 && !showOffer ? (
        <p className="text-sm text-gray-600">
          No box enabled yet. Open one of your callback-box pages and this
          popup will offer to enable it.
        </p>
      ) : null}
    </div>
  );
}

function PopupHeader() {
  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage().catch((err: unknown) => {
      console.error("[clerk] failed to open settings:", err);
    });
  }, []);

  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h1 className="text-lg font-semibold">Callback Clerk</h1>
      <button
        onClick={openSettings}
        className="shrink-0 rounded px-1 text-gray-400 hover:text-gray-700"
        title="Settings"
        aria-label="Settings"
      >
        <GearIcon />
      </button>
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.34 1.5a1 1 0 0 0-.98.8l-.2 1.02a6.5 6.5 0 0 0-1.2.7l-.98-.34a1 1 0 0 0-1.19.45l-1.16 2a1 1 0 0 0 .21 1.25l.78.68a6.6 6.6 0 0 0 0 1.38l-.78.68a1 1 0 0 0-.21 1.25l1.16 2a1 1 0 0 0 1.19.45l.98-.34c.37.28.77.51 1.2.7l.2 1.02a1 1 0 0 0 .98.8h2.32a1 1 0 0 0 .98-.8l.2-1.02c.43-.19.83-.42 1.2-.7l.98.34a1 1 0 0 0 1.19-.45l1.16-2a1 1 0 0 0-.21-1.25l-.78-.68a6.6 6.6 0 0 0 0-1.38l.78-.68a1 1 0 0 0 .21-1.25l-1.16-2a1 1 0 0 0-1.19-.45l-.98.34a6.5 6.5 0 0 0-1.2-.7l-.2-1.02a1 1 0 0 0-.98-.8H8.34ZM10 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface EnableOfferProps {
  box: EnabledBox;
  onEnable: () => void;
}

function EnableOffer({ box, onEnable }: EnableOfferProps) {
  return (
    <div className="mb-3 rounded border border-teal-300 bg-teal-50 p-3">
      <div className="text-sm">
        This page is the box <span className="font-medium">{box.title}</span>.
      </div>
      <div className="truncate text-xs text-gray-500">{box.boxUrl}</div>
      <button
        onClick={onEnable}
        className="mt-2 w-full rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
      >
        Enable this box
      </button>
    </div>
  );
}

interface BoxListProps {
  boxes: EnabledBox[];
  activeBoxUrl: string | null;
  onActivate: (boxUrl: string) => void;
  onDisable: (boxUrl: string) => void;
  onOpen: (boxUrl: string) => void;
}

function BoxList({ boxes, activeBoxUrl, onActivate, onDisable, onOpen }: BoxListProps) {
  return (
    <div className="space-y-2">
      {boxes.map((box) => (
        <BoxRow
          key={box.boxUrl}
          box={box}
          isActive={box.boxUrl === activeBoxUrl}
          onActivate={onActivate}
          onDisable={onDisable}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

interface BoxRowProps {
  box: EnabledBox;
  isActive: boolean;
  onActivate: (boxUrl: string) => void;
  onDisable: (boxUrl: string) => void;
  onOpen: (boxUrl: string) => void;
}

function BoxRow({ box, isActive, onActivate, onDisable, onOpen }: BoxRowProps) {
  const handleActivate = useCallback(() => {
    onActivate(box.boxUrl);
  }, [onActivate, box.boxUrl]);
  const handleDisable = useCallback(() => {
    onDisable(box.boxUrl);
  }, [onDisable, box.boxUrl]);
  const handleOpen = useCallback(() => {
    onOpen(box.boxUrl);
  }, [onOpen, box.boxUrl]);

  const border = isActive ? "border-teal-500 bg-teal-50" : "border-gray-200";
  const dot = isActive ? "bg-teal-500" : "bg-gray-300";

  return (
    <div className={`flex items-center gap-1 rounded border p-2 ${border}`}>
      <button onClick={handleActivate} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Make this the active box">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <BoxLabel box={box} />
      </button>
      <button
        onClick={handleOpen}
        className="shrink-0 px-1 text-lg leading-none text-gray-400 hover:text-teal-700"
        title="Open this box's chat"
        aria-label={`Open ${box.title}`}
      >
        ›
      </button>
      <button
        onClick={handleDisable}
        className="shrink-0 px-1 text-gray-400 hover:text-red-600"
        title="Disable this box"
        aria-label={`Disable ${box.title}`}
      >
        ✕
      </button>
    </div>
  );
}

function BoxLabel({ box }: { box: EnabledBox }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium">{box.title}</span>
      <span className="block truncate text-xs text-gray-400">{box.boxUrl}</span>
    </span>
  );
}
