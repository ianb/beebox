/**
 * Video from the call, floating under the app bar's top-right avatar beside
 * the heads of others in the chat, while anyone sends video
 * (docs/chat-calls.md). Mounted with `CallAudio` in the app bar, so it stays
 * on screen while the person moves around the app. Tiles are muted: voices
 * play through `CallAudio`, so a tile coming and going never cuts the sound.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { callEngine } from "../../lib/call/engine";
import { List } from "../ui/List";

function hasVideo(stream: MediaStream | null): stream is MediaStream {
  return stream !== null && stream.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
}

function Tile({ stream, name, self }: { stream: MediaStream; name: string; self: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <li className="relative w-40 aspect-video rounded-lg overflow-hidden bg-warm-900 shadow-md pointer-events-auto">
      <video ref={ref} autoPlay playsInline muted className={`w-full h-full object-cover ${self ? "-scale-x-100" : ""}`} aria-label={self ? "Your camera" : `${name}'s camera`} />
      <span className="absolute bottom-1 left-1 px-1.5 rounded bg-warm-900/70 text-white text-xs">{self ? "You" : name}</span>
    </li>
  );
}

export function CallVideoTiles() {
  const { ui, local, remote } = useSyncExternalStore(callEngine.subscribe, callEngine.getSnapshot);
  if (ui.phase !== "in-call") return null;
  const names = new Map(ui.members.map((m) => [m.peerId, m.person.name]));
  const tiles = [...remote].filter(([, stream]) => hasVideo(stream));
  if (tiles.length === 0 && !hasVideo(local)) return null;
  return (
    <List
      id="bbx-call-video"
      aria-label="Call video"
      gap="sm"
      // eslint-disable-next-line personal-vibe-check/restricted-classes -- not a panel: live video hanging under the app bar beside the presence heads while a call sends video, with nothing to dismiss, focus, or flip at the viewport edge.
      className="absolute top-full right-9 mt-1.5 z-30 pointer-events-none"
    >
      {hasVideo(local) ? <Tile stream={local} name="You" self /> : null}
      {tiles.map(([peerId, stream]) => <Tile key={peerId} stream={stream} name={names.get(peerId) ?? "Someone"} self={false} />)}
    </List>
  );
}
