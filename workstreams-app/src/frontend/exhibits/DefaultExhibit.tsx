import type { ReactNode } from "react";

import { Markdown } from "../components/Markdown.js";
import type { ExhibitAsk, ExhibitBoot, ExhibitFigure } from "../../shared/exhibits.js";

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
        <img alt={figure.caption ?? figure.label} className="max-w-full rounded border border-stone-200" src={figure.file} />
      ) : (
        <a className="font-semibold text-blue-800 hover:underline" href={figure.file}>
          {figure.file}
        </a>
      )}
      {figure.caption === undefined ? null : <figcaption className="text-sm text-stone-600">{figure.caption}</figcaption>}
    </figure>
  );
}

function DispositionControl({ ask }: { ask: ExhibitAsk }): ReactNode {
  if (ask.type === "decide") {
    const options = ask.options ?? [];
    return (
      <div className="flex flex-wrap gap-2">
        {options.length === 0 ? (
          <span className="text-sm text-stone-500">This decide ask declares no options.</span>
        ) : (
          options.map((option) => (
            <button className="rounded border border-stone-400 bg-white px-3 py-1.5 disabled:opacity-50" disabled key={option} type="button">
              {option}
            </button>
          ))
        )}
      </div>
    );
  }
  const labels =
    ask.type === "confirm" ? ["Looks right", "Something is wrong"] : ask.type === "fyi" ? ["Got it"] : [];
  return (
    <div className="flex flex-wrap gap-2">
      {labels.map((label) => (
        <button className="rounded border border-stone-400 bg-white px-3 py-1.5 disabled:opacity-50" disabled key={label} type="button">
          {label}
        </button>
      ))}
      {ask.type === "react" ? <span className="text-sm text-stone-500">Your comment is the answer.</span> : null}
    </div>
  );
}

/**
 * The default presentation renderer: what an exhibit gets when it does not
 * override with its own index.tsx. Disposition capture is rendered but inert —
 * the write path (documents, events, captures) lands in Track C.
 */
export function DefaultExhibit({ boot }: { boot: ExhibitBoot }): ReactNode {
  const figures = boot.manifest.figures ?? [];
  const { ask } = boot.manifest;
  return (
    <>
      {boot.doc === null ? null : (
        <section className="rounded-lg border border-stone-300 bg-white p-4">
          <Markdown source={boot.doc} />
        </section>
      )}
      {figures.length === 0 ? null : (
        <section className="flex flex-col gap-4">
          {figures.map((figure) => (
            <Figure figure={figure} key={figure.label} />
          ))}
        </section>
      )}
      <section className="flex flex-col gap-3 rounded-lg border border-dashed border-stone-400 p-4">
        <h2 className="m-0 text-base font-bold">Your answer</h2>
        {ask === undefined ? null : <DispositionControl ask={ask} />}
        <textarea
          className="min-h-24 w-full rounded border border-stone-400 p-2 disabled:bg-stone-100"
          disabled
          placeholder="Freeform comment — address figures by label (A1, A2 …)"
        />
        <p className="m-0 text-sm text-stone-500">
          Answering is wired in Track C; until then, reply in chat and the agent records the disposition.
        </p>
      </section>
    </>
  );
}
