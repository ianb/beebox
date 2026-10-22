/**
 * The photos added to this capture, as a row of thumbnails between the camera
 * and the controls, so the person can check the set before pressing Done. The
 * status bar's "✓ 2 photos" said how many, not which.
 *
 * A tap opens the photo in the lightbox, as the composer's thumbnails do. There
 * is no remove: a staged photo is already on the box, and capture has no route
 * to take one back. Each tile wears its upload state: dimmed with a spinner
 * while it uploads, a red ring when it failed (the banner below offers the
 * retry), and a struck tile when the file could not be read at all.
 *
 * A photo staged before a resume has no local copy; it shows as a plain tile
 * so the row still counts every photo in the capture.
 */

import { useLightbox } from "../../LightboxProvider";
import type { UploadState } from "../../../pages/capture/api";

export function CapturePhotoStrip({ states, previews, includeControlIds }: { states: UploadState[]; previews: (string | null)[]; includeControlIds: boolean }) {
  const lightbox = useLightbox();
  if (states.length === 0) return null;

  // The lightbox pages through the photos it can show; map each tile to its slot.
  const viewable = states.flatMap((_s, i) => {
    const src = previews[i] ?? null;
    return src === null ? [] : [{ index: i, src }];
  });
  const open = (index: number) => {
    const at = viewable.findIndex((v) => v.index === index);
    if (at === -1) return;
    lightbox.openList(viewable.map((v) => ({ src: v.src, alt: `Photo ${String(v.index + 1)}` })), at);
  };

  return (
    <ul className="flex gap-2 px-4 py-2 overflow-x-auto bg-gray-900/80" aria-label="Photos in this capture">
      {states.map((state, i) => (
        <li key={i} className="flex-shrink-0">
          <PhotoTile index={i} state={state} src={previews[i] ?? null} onOpen={() => open(i)} id={includeControlIds ? `bbx-capture-photo-${String(i + 1)}` : undefined} />
        </li>
      ))}
    </ul>
  );
}

const STATE_LABEL: Record<UploadState, string> = {
  uploading: "uploading",
  uploaded: "uploaded",
  failed: "failed to upload",
  unreadable: "can't be read",
};

function PhotoTile({ index, state, src, onOpen, id }: { index: number; state: UploadState; src: string | null; onOpen: () => void; id: string | undefined }) {
  const label = `Photo ${String(index + 1)}, ${STATE_LABEL[state]}`;
  const ring = state === "failed" || state === "unreadable" ? "ring-2 ring-danger" : "";
  if (state === "unreadable" || src === null) {
    return (
      <div
        className={`w-14 h-14 rounded bg-gray-800 flex items-center justify-center text-xs text-center leading-tight ${ring} ${state === "unreadable" ? "text-danger-light" : "text-gray-400"}`}
        role="img"
        aria-label={label}
        title={state === "unreadable" ? "This photo can't be read. It may have been moved or deleted." : label}
        data-bbx-capture-photo-state={state}
      >
        {state === "unreadable" ? "can't read" : String(index + 1)}
      </div>
    );
  }
  return (
    <button
      id={id}
      type="button"
      onClick={onOpen}
      className={`relative block w-14 h-14 rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-white ${ring}`}
      aria-label={label}
      title={label}
      data-bbx-capture-photo-state={state}
    >
      <img src={src} alt="" className={`w-full h-full object-cover ${state === "uploading" ? "opacity-50" : ""}`} />
      {state === "uploading" ? (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </span>
      ) : null}
      {state === "failed" ? (
        <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-danger text-white text-[10px] leading-4 text-center font-bold" aria-hidden="true">!</span>
      ) : null}
    </button>
  );
}
