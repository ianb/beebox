import type { ReactNode } from "react";

import { Markdown } from "../components/Markdown.js";
import type { ExhibitBoot, ExhibitFigure } from "../../shared/exhibits.js";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

function isImage(file: string): boolean {
  return IMAGE_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension));
}

function Figure({ figure }: { figure: ExhibitFigure }): ReactNode {
  return (
    <figure className="m-0 flex flex-col gap-2 rounded-lg border border-stone-300 bg-white p-3">
      <div className="flex items-baseline gap-2">
        <span className="rounded bg-stone-800 px-1.5 py-0.5 text-xs font-bold text-white">{figure.label}</span>
        <span className="text-xs text-stone-500">{figure.file}</span>
      </div>
      {isImage(figure.file) ? (
        // self-start + w-auto: a flex column stretches its items, which blew a
        // 320px screenshot up to the container width and made it look blurry
        // and wrong. Natural size, capped to the container.
        <img
          alt={figure.caption ?? figure.label}
          className="h-auto w-auto max-w-full self-start rounded border border-stone-200"
          src={figure.file}
        />
      ) : (
        <a className="font-semibold text-blue-800 hover:underline" href={figure.file}>
          {figure.file}
        </a>
      )}
      {figure.caption === undefined ? null : <figcaption className="text-sm text-stone-600">{figure.caption}</figcaption>}
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
