/**
 * The other call members' voices: one hidden autoplaying `<audio>` per
 * member (docs/plans/chat-calls.md, Track D). Mounted in the app bar, so a
 * call keeps sounding while the person moves around the app.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { callEngine } from "../../lib/call/engine";

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.srcObject = stream;
  }, [stream]);
  // eslint-disable-next-line jsx-a11y/media-has-caption -- live WebRTC audio has no caption file; the call transcript is its text form when on.
  return <audio ref={ref} autoPlay hidden />;
}

export function CallAudio() {
  const { remote } = useSyncExternalStore(callEngine.subscribe, callEngine.getSnapshot);
  return <>{[...remote].map(([peerId, stream]) => <RemoteAudio key={peerId} stream={stream} />)}</>;
}
