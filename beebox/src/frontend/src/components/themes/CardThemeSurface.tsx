import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { THEME_CATALOG, type ResolvedCardTheme } from "@shared/card-theme";
import type { FileViewMode } from "../file-view-types";

export interface CardThemeSurfaceProps {
  theme: ResolvedCardTheme;
  title: string;
  mode: Exclude<FileViewMode, "embed">;
  children: ReactNode;
  properties: ReactNode;
  actions?: ReactNode;
  problem?: ReactNode;
}

/** Front stays mounted while turned over, retaining authored view state. */
export function CardThemeSurface({ theme, title, mode, children, properties, actions, problem }: CardThemeSurfaceProps) {
  const [back, setBack] = useState(false);
  const [turn, setTurn] = useState<"out" | "in" | null>(null);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const frontId = `bbx-card-front-${id}`;
  const backId = `bbx-card-back-${id}`;
  const descriptor = THEME_CATALOG.find((item) => item.name === theme.choice.name);
  useEffect(() => {
    front.current?.toggleAttribute("inert", back);
  }, [back]);
  function flip() {
    if (turn !== null) return;
    toggle.current?.focus();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setBack(!back);
    else setTurn("out");
  }
  return (
    <article
      className="bbx-card-theme bbx-card-surface"
      data-card-mode={mode}
      data-card-theme={theme.choice.name}
      data-card-stock={theme.choice.stock}
      data-card-turn={turn ?? undefined}
      data-card-side={back ? "back" : "front"}
      data-default-quote-treatment={descriptor?.quoteTreatment}
      data-default-blockquote-treatment={descriptor?.blockquoteTreatment}
      aria-label={title}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (turn === "out") {
          setBack(!back);
          setTurn("in");
        } else setTurn(null);
      }}
    >
      <button
        ref={toggle}
        id={`bbx-card-properties-${id}`}
        type="button"
        className="bbx-card-properties print:hidden"
        aria-label={back ? "Back to card" : "Properties"}
        title={back ? "Back to card" : "Properties: appearance and alternate views"}
        aria-expanded={back}
        aria-busy={turn !== null}
        aria-controls={backId}
        onClick={flip}
      >
        <span className="bbx-card-properties-label" aria-hidden="true">
          {back ? "← Back to card" : "Properties"}
        </span>
        <span className="sr-only">{back ? "Back to card" : "Properties"}</span>
      </button>
      <header className="bbx-card-heading">
        <h2>{title}</h2>
        {actions ? <div className="flex gap-2 mt-2 print:hidden">{actions}</div> : null}
      </header>
      {problem}
      <div ref={front} id={frontId} className="bbx-card-front" data-card-mode={mode} hidden={back} aria-hidden={back}>
        {children}
      </div>
      <section id={backId} className="bbx-card-back" hidden={!back} aria-label="Card properties">
        {back ? properties : null}
      </section>
    </article>
  );
}
