/**
 * The on-device language pack row in Voice settings, shown only on a device
 * opted in to the browser's recognizer (`lib/audio/live-engine.ts`). The
 * download has to start here: the browser requires a click for it.
 */

import { useEffect, useState } from "react";
import { MenuItem } from "../../ui/dropdown-menu-item";
import { toastError } from "../../ui/toast-store";
import {
  browserSpeechAvailability,
  browserSpeechLang,
  installBrowserSpeech,
  liveEngine,
  type BrowserSpeechAvailability,
} from "../../../lib/audio/live-engine";

export function BrowserSpeechRow() {
  const [availability, setAvailability] = useState<BrowserSpeechAvailability | null>(null);
  const optedIn = liveEngine() === "browser";
  const lang = browserSpeechLang();

  useEffect(() => {
    if (!optedIn) return;
    void browserSpeechAvailability(lang).then(setAvailability).catch((e: unknown) => {
      toastError("Could not check on-device speech", { cause: e });
    });
  }, [optedIn, lang]);

  if (!optedIn || availability === null) return null;
  if (availability === "unavailable") {
    return <div className="px-3 py-1 text-xs text-warm-700">On-device speech is not available in this browser for {lang}</div>;
  }
  if (availability === "available") {
    return <div className="px-3 py-1 text-xs text-warm-700">✓ On-device speech is ready</div>;
  }
  if (availability === "downloading") {
    return <div className="px-3 py-1 text-xs text-warm-700">Downloading on-device speech… this takes a few minutes</div>;
  }
  const download = () => {
    setAvailability("downloading");
    void installBrowserSpeech(lang)
      .then((installed) => {
        if (!installed) toastError("The on-device speech download did not finish");
        return browserSpeechAvailability(lang);
      })
      .then(setAvailability)
      .catch((e: unknown) => {
        toastError("The on-device speech download failed", { cause: e });
        setAvailability("downloadable");
      });
  };
  return (
    <MenuItem id="bbx-voice-browser-speech-download" onClick={download} keepOpen>
      <span>
        Download on-device speech
        <span className="block text-xs text-warm-700">About 220 MB. Live text then stays on this device.</span>
      </span>
    </MenuItem>
  );
}
