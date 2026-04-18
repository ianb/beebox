/**
 * Tap-to-capture camera viewport. Shows a placeholder prompt when the
 * camera is off; once on, displays the live video with focus ring + the
 * two corner controls (disable camera, flip camera).
 *
 * Forwards the videoRef so CapturePage can attach it to CameraCapture.
 */

import { forwardRef } from "react";

interface CameraViewportProps {
  cameraOn: boolean;
  flashing: boolean;
  onTap: () => void;
  onToggleCamera: () => void;
  onFlipCamera: () => void;
}

export const CameraViewport = forwardRef<HTMLVideoElement, CameraViewportProps>(function CameraViewport(
  { cameraOn, flashing, onTap, onToggleCamera, onFlipCamera },
  ref,
) {
  return (
    <div
      className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden cursor-pointer"
      onClick={onTap}
    >
      <video
        ref={ref}
        className={`w-full h-full object-contain ${cameraOn ? "" : "hidden"}`}
        style={flashing ? { filter: "brightness(3) saturate(0)" } : undefined}
        playsInline
        muted
      />
      {cameraOn ? (
        <>
          <div className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none z-10">
            <div className="w-16 h-16 rounded-full border-4 border-white/40" />
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCamera(); }}
            className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 z-10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onFlipCamera(); }}
            className="absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 z-10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </>
      ) : (
        <div className="text-gray-600 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 mx-auto mb-2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-sm">Tap to start camera</p>
        </div>
      )}
    </div>
  );
});
