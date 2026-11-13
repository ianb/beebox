/**
 * Video from the call, above the transcript, while anyone sends video
 * (docs/plans/chat-calls.md, Track D). Tiles are muted: voices play through
 * `CallAudio`, so a tile coming and going never cuts the sound.
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
    <li className="relative h-32 aspect-video rounded-lg overflow-hidden bg-warm-900">
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
    <List id="bbx-call-video" aria-label="Call video" direction="row" gap="sm" className="px-3 py-2 overflow-x-auto">
      {hasVideo(local) ? <Tile stream={local} name="You" self /> : null}
      {tiles.map(([peerId, stream]) => <Tile key={peerId} stream={stream} name={names.get(peerId) ?? "Someone"} self={false} />)}
    </List>
  );
}
