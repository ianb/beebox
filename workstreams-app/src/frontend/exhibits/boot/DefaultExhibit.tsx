import { useEffect, useRef, useState, type ReactNode } from "react";

import { Markdown } from "../../components/Markdown.js";
import type { ExhibitBoot, ExhibitFigure } from "../../../shared/exhibits.js";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

function isImage(file: string): boolean {
  return IMAGE_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension));
}

/**
 * The enlarged view of one figure: a native modal dialog, so Escape and focus
 * containment come from the browser. The image is shown at its natural pixel
 * size (a Retina screenshot is twice the width it was captured at, which is
 * the detail the fitted view hides) and never narrower than the viewport, and
 * the dialog scrolls to pan. A click anywhere closes it.
 */
function EnlargedFigure({ figure, onClose }: { figure: ExhibitFigure; onClose: () => void }): ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
  }, []);
  return (
    <dialog
      aria-label={`${figure.label} enlarged`}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-auto bg-stone-900 p-0 backdrop:bg-stone-900"
      // Escape closes a modal dialog natively; the close event is what
      // unmounts this, so the next click can open it again.
      onClose={onClose}
      ref={dialogRef}
    >
      <button
        aria-label="Close the enlarged view"
        className="m-0 block min-h-full min-w-full cursor-zoom-out border-0 bg-transparent p-0 text-left"
        // Closing through the dialog, as Escape does, returns focus to the
        // figure's button; unmounting directly would drop it on the body.
        onClick={() => { dialogRef.current?.close(); }}
        type="button"
      >
        <img
          alt={figure.caption ?? figure.label}
          className="block h-auto min-w-full max-w-none"
          src={figure.file}
        />
      </button>
    </dialog>
  );
}

function Figure({ figure }: { figure: ExhibitFigure }): ReactNode {
  const [enlarged, setEnlarged] = useState(false);
  return (
    <figure className="m-0 flex flex-col gap-2 rounded-lg border border-stone-300 bg-white p-3">
      <div className="flex items-baseline gap-2">
        <span className="rounded bg-stone-800 px-1.5 py-0.5 text-xs font-bold text-white">{figure.label}</span>
        <a className="text-xs text-stone-500 hover:underline" href={figure.file} rel="noreferrer" target="_blank">
          {figure.file}
        </a>
      </div>
      {isImage(figure.file) ? (
        // self-start + w-auto: a flex column stretches its items, which blew a
        // 320px screenshot up to the container width and made it look blurry
        // and wrong. Natural size, capped to the container; the click opens
        // the full-size view.
        <button
          aria-label={`Enlarge ${figure.label}`}
          className="m-0 cursor-zoom-in self-start border-0 bg-transparent p-0"
          onClick={() => { setEnlarged(true); }}
          type="button"
        >
          <img
            alt={figure.caption ?? figure.label}
            className="block h-auto w-auto max-w-full rounded border border-stone-200"
            src={figure.file}
          />
        </button>
      ) : (
        <a className="font-semibold text-blue-800 hover:underline" href={figure.file}>
          {figure.file}
        </a>
      )}
      {figure.caption === undefined ? null : <figcaption className="text-sm text-stone-600">{figure.caption}</figcaption>}
      {enlarged ? <EnlargedFigure figure={figure} onClose={() => { setEnlarged(false); }} /> : null}
    </figure>
  );
}

/**
 * The default presentation renderer: what an exhibit gets when it does not
 * override with its own index.tsx.
 */
export function DefaultExhibit({ boot }: { boot: ExhibitBoot }): ReactNode {
  const figures = boot.manifest.figures ?? [];
  return (
    <>
      {boot.doc === null ? null : (
        // min-w-0: a flex child defaults to min-width:auto, which would let a
        // long code line in the document widen the page instead of scrolling
        // inside the <pre> typography already makes scrollable.
        <section className="min-w-0 rounded-lg border border-stone-300 bg-white p-4">
          <Markdown source={boot.doc} />
        </section>
      )}
      {figures.length === 0 ? null : (
        <section className="flex min-w-0 flex-col gap-4">
          {figures.map((figure) => (
            <Figure figure={figure} key={figure.label} />
          ))}
        </section>
      )}
    </>
  );
}
