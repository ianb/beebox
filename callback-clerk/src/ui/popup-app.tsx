import { useCallback, useEffect, useState } from "react";
import { getActiveBox, isBoxEnabled, type ClerkConfig, type EnabledBox } from "../domain/config.js";
import { loadConfig } from "../platform/config-storage.js";
import { detectBoxOnActiveTab } from "../platform/detect-box.js";
import { activateBox, disableBox, enableBox } from "../platform/enable-box.js";
import { ActionsPanel } from "./actions-panel.js";

export function PopupApp() {
  const [config, setConfig] = useState<ClerkConfig | null>(null);
  const [detected, setDetected] = useState<EnabledBox | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig);
    detectBoxOnActiveTab().then(setDetected);
  }, []);

  const handleEnable = useCallback(() => {
    if (detected === null) return;
    // enableBox calls permissions.request first — it must stay inside the
    // click gesture, so no awaits before this call.
    enableBox(detected).then((next) => {
      if (next !== null) setConfig(next);
    });
  }, [detected]);

  const handleActivate = useCallback((boxUrl: string) => {
    activateBox(boxUrl).then(setConfig);
  }, []);

  const handleDisable = useCallback((boxUrl: string) => {
    disableBox(boxUrl).then(setConfig);
  }, []);

  if (config === null) {
    return <div className="w-80 p-4 text-sm text-gray-500">Loading…</div>;
  }

  const showOffer = detected !== null && !isBoxEnabled(config, detected.boxUrl);
  const activeBox = getActiveBox(config);

  return (
    <div className="w-80 p-4">
      <h1 className="mb-3 text-lg font-semibold">Callback Clerk</h1>
      {showOffer && detected !== null ? (
        <EnableOffer box={detected} onEnable={handleEnable} />
      ) : null}
      {config.boxes.length > 0 ? (
        <BoxList
          boxes={config.boxes}
          activeBoxUrl={config.activeBoxUrl}
          onActivate={handleActivate}
          onDisable={handleDisable}
        />
      ) : null}
      {config.boxes.length === 0 && !showOffer ? (
        <p className="text-sm text-gray-600">
          No box enabled yet. Open one of your callback-box pages and this
          popup will offer to enable it.
        </p>
      ) : null}
      {activeBox !== null ? <ActionsPanel box={activeBox} /> : null}
    </div>
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
}

function BoxList({ boxes, activeBoxUrl, onActivate, onDisable }: BoxListProps) {
  return (
    <div className="space-y-2">
      {boxes.map((box) => (
        <BoxRow
          key={box.boxUrl}
          box={box}
          isActive={box.boxUrl === activeBoxUrl}
          onActivate={onActivate}
          onDisable={onDisable}
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
}

function BoxRow({ box, isActive, onActivate, onDisable }: BoxRowProps) {
  const handleActivate = useCallback(() => {
    onActivate(box.boxUrl);
  }, [onActivate, box.boxUrl]);
  const handleDisable = useCallback(() => {
    onDisable(box.boxUrl);
  }, [onDisable, box.boxUrl]);

  const border = isActive ? "border-teal-500 bg-teal-50" : "border-gray-200";
  const dot = isActive ? "bg-teal-500" : "bg-gray-300";

  return (
    <div className={`flex items-center gap-2 rounded border p-2 ${border}`}>
      <button onClick={handleActivate} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Make this the active box">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <BoxLabel box={box} />
      </button>
      <button
        onClick={handleDisable}
        className="shrink-0 px-1 text-gray-400 hover:text-red-600"
        title="Disable this box"
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
