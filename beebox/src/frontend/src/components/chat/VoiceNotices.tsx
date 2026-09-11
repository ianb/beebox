import { useSyncExternalStore } from "react";
import { hqFailureNotices } from "../../lib/audio/hq-failure-notices";
import { voiceStagingFailures, voiceStagingIsPersistent, voiceStagingStatus } from "../../lib/audio/voice-staging-queue";

/**
 * Voice problems that will not fix themselves, shown on the voice chip
 * (docs/plans/resilient-voice-recording.md, Track 4): a permanent HQ failure
 * (once per service and code, until dismissed), a recording upload the queue
 * gave up on, and a browser that cannot keep recordings durably.
 */
export interface VoiceNotice {
  key: string;
  message: string;
  dismiss: () => void;
}

/** Upload failures and the storage warning dismissed in this tab. */
let dismissed: ReadonlySet<string> = new Set();
const dismissListeners = new Set<() => void>();
const dismissals = {
  subscribe: (listener: () => void): (() => void) => {
    dismissListeners.add(listener);
    return () => dismissListeners.delete(listener);
  },
  getSnapshot: (): ReadonlySet<string> => dismissed,
  add: (key: string): void => {
    dismissed = new Set([...dismissed, key]);
    for (const listener of dismissListeners) listener();
  },
};

const STORAGE_KEY = "storage";

export function useVoiceNotices(): VoiceNotice[] {
  const hq = useSyncExternalStore(hqFailureNotices.subscribe, hqFailureNotices.getSnapshot);
  const failures = useSyncExternalStore(voiceStagingFailures.subscribe, voiceStagingFailures.getSnapshot);
  const persistent = useSyncExternalStore(voiceStagingStatus.subscribe, voiceStagingIsPersistent);
  const hidden = useSyncExternalStore(dismissals.subscribe, dismissals.getSnapshot);
  const notices: VoiceNotice[] = hq.map((n) => ({
    key: `hq:${n.key}`,
    message: `HQ transcription failed: ${n.message}`,
    dismiss: () => hqFailureNotices.dismiss(n.key),
  }));
  for (const failure of failures) {
    const key = `upload:${failure.recordingId}:${String(failure.at)}`;
    if (!hidden.has(key)) notices.push({ key, message: `A voice recording could not be uploaded: ${failure.message}`, dismiss: () => dismissals.add(key) });
  }
  if (!persistent && !hidden.has(STORAGE_KEY)) {
    notices.push({
      key: STORAGE_KEY,
      message: "This browser cannot keep voice recordings on the device; a reload before they finish uploading loses them.",
      dismiss: () => dismissals.add(STORAGE_KEY),
    });
  }
  return notices;
}

/** The notices, each with a Dismiss control, at the top of the voice menu. */
export function VoiceNoticeList() {
  const notices = useVoiceNotices();
  if (notices.length === 0) return null;
  return (
    <div role="alert" className="mx-2 my-1 flex flex-col gap-1">
      {notices.map((notice) => (
        <div key={notice.key} className="flex items-start gap-2 rounded bg-warning-50 px-2 py-1 text-xs text-warning-dark">
          <span className="flex-1">{notice.message}</span>
          <button type="button" className="underline" onClick={() => notice.dismiss()}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}
