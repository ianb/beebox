/**
 * "This device" in Voice settings → While you speak: live text from the
 * browser's on-device recognizer (`lib/audio/live-engine.ts`), chosen per
 * device. Offered only where the browser can run it. Choosing it starts the
 * language pack download on that click, since the browser requires a click.
 */

import { useEffect, useState } from "react";
import { MenuItem } from "../../ui/menu-item";
import { toastError } from "../../ui/toast-store";
import {
  browserSpeechAvailability,
  browserSpeechLang,
  installBrowserSpeech,
  setLiveEngine,
  type BrowserSpeechAvailability,
} from "../../../lib/audio/live-engine";

export const DEVICE_OPTION_LABEL = "This device (Chrome, on-device)";
/** The root panel's "Live:" summary when this device's choice is on. */
export const DEVICE_OPTION_SUMMARY = "This device";

function optionNote(availability: BrowserSpeechAvailability, chosen: boolean): string {
  switch (availability) {
    case "unavailable":
      return "Not available in this browser";
    case "downloadable":
      return chosen ? "Not downloaded yet. Choose it again to download (about 220 MB)." : "Live text is made on this device. First use downloads about 220 MB.";
    case "downloading":
      return "Downloading… this takes a few minutes";
    case "available":
      return "Live text is made on this device";
  }
}

export function DeviceSpeechOption({ chosen }: { chosen: boolean }) {
  const [availability, setAvailability] = useState<BrowserSpeechAvailability | null>(null);
  const lang = browserSpeechLang();

  useEffect(() => {
    void browserSpeechAvailability(lang).then(setAvailability).catch((e: unknown) => {
      toastError("Could not check on-device speech", { cause: e });
    });
  }, [lang]);

  // Still checking, or this browser cannot run it: offer nothing. A device
  // that already chose it keeps the row, so the check and the reason show.
  if (!chosen && (availability === null || availability === "unavailable")) return null;

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
  const choose = () => {
    if (!chosen && !setLiveEngine("browser")) {
      toastError("This browser would not save the choice");
      return;
    }
    if (availability === "downloadable") download();
  };

  return (
    <MenuItem id="bbx-voice-live-device" onClick={choose} keepOpen disabled={availability === "unavailable"}>
      <span>
        {chosen ? "✓ " : "  "}{DEVICE_OPTION_LABEL}
        {availability !== null && <span className="block pl-4 text-xs text-warm-700">{optionNote(availability, chosen)}</span>}
      </span>
    </MenuItem>
  );
}
