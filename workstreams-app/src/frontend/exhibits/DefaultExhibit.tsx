import { useEffect, useMemo, useState, type ReactNode } from "react";

import { EventLog, Storage } from "./client.js";
import { Markdown } from "../components/Markdown.js";
import {
  DISPOSITION_KEY,
  dispositionSchema,
  type ExhibitAsk,
  type ExhibitBoot,
  type ExhibitDisposition,
  type ExhibitFigure,
} from "../../shared/exhibits.js";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

const BUTTON_CLASSES = "rounded border border-stone-400 bg-white px-3 py-1.5 disabled:opacity-50";

function isImage(file: string): boolean {
  return IMAGE_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/**
 * What the developer picks from, by ask type. `react` and `fyi` have nothing to
 * pick: the comment is the answer, and an empty comment on an `fyi` is a
 * legitimate "read it".
 */
function choicesFor(ask: ExhibitAsk): string[] {
  if (ask.type === "decide") return ask.options ?? [];
  if (ask.type === "confirm") return ["Looks right", "Something is wrong"];
  return [];
}

type SaveStatus = "loading" | "idle" | "saving" | "saved";

/**
 * The ask's answer, recorded as an ordinary exhibit document
 * (`data/disposition.json`) plus one event. Nothing here is silent: a failed
 * read or write says so inline, because an answer the developer believes they
 * gave and the agent never sees is worse than no answer.
 */
function DispositionForm({ ask }: { ask: ExhibitAsk }): ReactNode {
  const storage = useMemo(() => new Storage(DISPOSITION_KEY, { schema: dispositionSchema }), []);
  const events = useMemo(() => new EventLog<ExhibitDisposition>("disposition"), []);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [answered, setAnswered] = useState<ExhibitDisposition | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  useEffect(() => {
    let live = true;
    async function load(): Promise<void> {
      try {
        const existing = await storage.load();
        if (!live) return;
        if (existing !== null) {
          setAnswered(existing);
          setChoice(existing.choice ?? null);
          setComment(existing.comment ?? "");
        }
      } catch (error) {
        if (!live) return;
        setProblem(`Could not read the recorded answer: ${describe(error)}`);
      } finally {
        if (live) setStatus("idle");
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [storage]);

  const choices = choicesFor(ask);
  const trimmed = comment.trim();

  async function submit(): Promise<void> {
    const disposition: ExhibitDisposition = {
      askType: ask.type,
      decidedAt: new Date().toISOString(),
      ...(choice === null ? {} : { choice }),
      ...(trimmed === "" ? {} : { comment: trimmed }),
    };
    setStatus("saving");
    setProblem(null);
    try {
      await storage.save(disposition);
      await events.append(disposition);
      setAnswered(disposition);
      setStatus("saved");
    } catch (error) {
      setStatus("idle");
      setProblem(`Your answer was not recorded: ${describe(error)}`);
    }
  }

  if (status === "loading") return <p className="m-0 text-sm text-stone-500">Checking for a recorded answer…</p>;

  const missingChoice = choices.length > 0 && choice === null;
  return (
    <>
      {answered === null ? null : (
        <p className="m-0 text-sm text-stone-600">
          Recorded {answered.choice === undefined ? "a comment" : `“${answered.choice}”`} at{" "}
          {new Date(answered.decidedAt).toLocaleString()}. Change it below to revise.
        </p>
      )}
      {choices.length === 0 ? (
        <p className="m-0 text-sm text-stone-500">
          {ask.type === "fyi" ? "Nothing is needed — acknowledge if you want to." : "Your comment is the answer."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Your choice">
          {choices.map((option) => (
            <button
              aria-checked={choice === option}
              className={`${BUTTON_CLASSES} ${choice === option ? "border-blue-700 bg-blue-50 font-semibold text-blue-900" : ""}`}
              key={option}
              onClick={() => setChoice(option)}
              role="radio"
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {ask.type === "decide" && choices.length === 0 ? (
        <p className="m-0 text-sm text-amber-800">This decide ask declares no options; answer in the comment.</p>
      ) : null}
      <textarea
        aria-label="Comment"
        className="min-h-24 w-full rounded border border-stone-400 p-2"
        onChange={(event) => setComment(event.target.value)}
        placeholder="Freeform comment — address figures by label (A1, A2 …)"
        value={comment}
      />
      <div className="flex items-center gap-3">
        <button
          className={`${BUTTON_CLASSES} border-stone-700 font-semibold`}
          disabled={status === "saving" || missingChoice}
          onClick={() => void submit()}
          type="button"
        >
          {status === "saving" ? "Recording…" : answered === null ? "Record answer" : "Update answer"}
        </button>
        {missingChoice ? <span className="text-sm text-stone-500">Pick one to record an answer.</span> : null}
        {status === "saved" && problem === null ? (
          <span className="text-sm text-green-800" role="status">
            Recorded. The agent reads it from disk.
          </span>
        ) : null}
      </div>
      {problem === null ? null : (
        <p className="m-0 text-sm text-red-800" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

/**
 * The default presentation renderer: what an exhibit gets when it does not
 * override with its own index.tsx.
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
      {ask === undefined ? null : (
        <section className="flex flex-col gap-3 rounded-lg border border-dashed border-stone-400 p-4">
          <h2 className="m-0 text-base font-bold">Your answer</h2>
          <DispositionForm ask={ask} />
        </section>
      )}
    </>
  );
}
