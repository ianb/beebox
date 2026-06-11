import { useEffect, useState } from "react";
import { getMicLevel } from "../lib/mic-level";

const HISTORY_BARS = 3;
const SAMPLE_MS = 100;
const MAX_BAR_PX = 40;

/**
 * Live mic-volume bars shown while recording, ported from memory-atlas: the
 * newest sample leads, older samples trail at reduced opacity. Reads the
 * level from the mic-level bridge (the capture pipeline owns the analyser),
 * so flat bars mean no audio is reaching the recorder — a direct "is the
 * mic actually hearing me / is the right mic selected" signal, including
 * during interruptions. `degraded` (session recovering from a network or
 * mic blip) recolors the bars amber.
 */
export function VolumeIndicator({ degraded }: { degraded?: boolean }) {
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: HISTORY_BARS }, () => 0));

  useEffect(() => {
    const id = setInterval(() => {
      setHistory((prev) => [getMicLevel(), ...prev.slice(0, HISTORY_BARS - 1)]);
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, []);

  const barColor = degraded === true ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-end gap-[2px]" style={{ height: `${MAX_BAR_PX}px` }} aria-hidden="true">
      {history.map((volume, i) => (
        <div
          key={i}
          className={`w-[3px] ${barColor} transition-all duration-100 rounded-full`}
          style={{ height: `${Math.max(4, Math.round(volume * MAX_BAR_PX))}px`, opacity: 1 - i * 0.2 }}
        />
      ))}
    </div>
  );
}
