import { useCallback, useEffect, useState } from "react";
import { getActiveBox, isBoxEnabled, type ClerkConfig, type EnabledBox } from "../domain/config.js";
import { loadConfig } from "../platform/config-storage.js";
import { detectBoxOnActiveTab } from "../platform/detect-box.js";
import { activateBox, disableBox, enableBox } from "../platform/enable-box.js";
import {
  hasSilentCapturePermission,
  requestSilentCapturePermission,
  revokeSilentCapturePermission,
} from "../platform/capture-permission.js";
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

  if (config === null) {
    return <div className="w-80 p-4 text-sm text-gray-500">Loading…</div>;
  }

  const showOffer = detected !== null && !isBoxEnabled(config, detected.boxUrl);
  const activeBox = getActiveBox(config);

  return (
    <div className="w-80 p-4">
      <h1 className="mb-3 text-lg font-semibold">Callback Clerk</h1>
      {showOffer ? (
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
      {config.boxes.length > 0 ? <SilentCaptureToggle /> : null}
      {activeBox !== null ? <ActionsPanel box={activeBox} /> : null}
    </div>
  );
}

/**
 * Opt-in for silent agent screenshots. Toggles the broad host permission
 * captureVisibleTab needs (see capture-permission.ts). Off is the safe default:
 * the box app falls back to its getDisplayMedia consent popup, so screenshots
 * still work, just with a one-time browser share prompt.
 */
function SilentCaptureToggle() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hasSilentCapturePermission().then(setGranted).catch((err: unknown) => {
      console.error("[clerk] failed to read capture permission:", err);
    });
  }, []);

  const toggle = useCallback(() => {
    if (granted === null) return;
    setBusy(true);
    // request()/remove() must stay inside the click gesture — no awaits before.
    const action = granted ? revokeSilentCapturePermission() : requestSilentCapturePermission();
    action
      .then((ok) => {
        // request → ok means granted; remove → ok means revoked.
        if (ok) setGranted(!granted);
      })
      .catch((err: unknown) => {
        console.error("[clerk] failed to change capture permission:", err);
      })
      .finally(() => setBusy(false));
  }, [granted]);

  if (granted === null) return null;

  return (
    <div className="mt-3 rounded border border-gray-200 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Silent screenshots</span>
        <button
          onClick={toggle}
          disabled={busy}
          className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
            granted ? "bg-teal-600 text-white hover:bg-teal-700" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          } disabled:opacity-50`}
        >
          {granted ? "On" : "Off"}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {granted
          ? "The agent can capture your box tabs without a prompt. Turn off to require the browser share prompt each time."
          : "Let the agent screenshot your box tabs without a prompt. Grants access to all sites (the extension only captures enabled boxes). Off = a browser share prompt each time."}
      </p>
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
