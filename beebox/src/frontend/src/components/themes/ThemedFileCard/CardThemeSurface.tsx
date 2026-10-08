import { themeComposition } from "@shared/card-theme/catalog";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { THEME_CATALOG, type ResolvedCardTheme } from "@shared/card-theme/core";
import { controlAddress } from "@shared/ui-scan/control-address";
import type { FileViewMode } from "../../file-view-types";
import type { CardSymbolData } from "@shared/card-symbol";
import { CardMark } from "../../ui/CardMark";

export interface CardThemeSurfaceProps {
  theme: ResolvedCardTheme;
  title: string;
  /** The card's symbol, drawn before the title; `null` draws nothing. */
  symbol: CardSymbolData | null;
  boxSlug: string | undefined;
  mode: Exclude<FileViewMode, "embed">;
  children: ReactNode;
  /** The back face; its controls can turn the card over with {@link useShowCardFront}. */
  properties: ReactNode;
  actions?: ReactNode;
  problem?: ReactNode;
}

/** Provided around the back face; exported so a test can render the face alone. */
export const ShowFrontContext = createContext<(() => void) | null>(null);

class ShowCardFrontContextError extends Error {
  constructor() {
    super("useShowCardFront must be used inside a CardThemeSurface's properties");
    this.name = "ShowCardFrontContextError";
  }
}

/** Turn the enclosing card from its properties back to its front, as the toggle does. */
export function useShowCardFront(): () => void {
  const showFront = useContext(ShowFrontContext);
  if (showFront === null) throw new ShowCardFrontContextError();
  return showFront;
}

/** Front stays mounted while turned over, retaining authored view state. */
export function CardThemeSurface({ theme, title, symbol, boxSlug, mode, children, properties, actions, problem }: CardThemeSurfaceProps) {
  const [back, setBack] = useState(false);
  const [turn, setTurn] = useState<"out" | "in" | null>(null);
  // React's `useId` spells its values with colons, which the control address
  // grammar has no room for, so the instance key is encoded rather than
  // interpolated — an id outside the grammar is one the scan drops and
  // `bin/browse` cannot act on.
  const instance = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const propertiesId = controlAddress("bbx-card-properties", instance);
  const frontId = controlAddress("bbx-card-front", instance);
  const backId = controlAddress("bbx-card-back", instance);
  const descriptor = THEME_CATALOG.find((item) => item.name === theme.choice.name);
  useEffect(() => {
    front.current?.toggleAttribute("inert", back);
  }, [back]);
  const flip = useCallback(() => {
    if (turn !== null) return;
    toggle.current?.focus();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setBack(!back);
    else setTurn("out");
  }, [turn, back]);
  const showFront = useCallback(() => {
    if (back) flip();
  }, [back, flip]);
  return (
    <article
      className="bbx-card-theme bbx-card-surface"
      data-card-mode={mode}
      data-theme-composition={themeComposition(theme.choice.name)} data-card-theme={theme.choice.name}
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
        id={propertiesId}
        type="button"
        className="bbx-card-properties print:hidden"
        aria-label={back ? "Back to card" : "Properties"}
        title={back ? "Back to card" : "Properties: where this card is filed, how it is found, what it carries"}
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
        {symbol === null ? <h2>{title}</h2> : <div className="flex items-center gap-2">
          <CardMark symbol={symbol} size="md" boxSlug={boxSlug} />
          <h2 className="min-w-0">{title}</h2>
        </div>}
        {actions ? <div className="flex gap-2 mt-2 print:hidden">{actions}</div> : null}
      </header>
      {problem}
      <div ref={front} id={frontId} className="bbx-card-front" data-card-mode={mode} hidden={back} aria-hidden={back}>
        {children}
      </div>
      <section id={backId} className="bbx-card-back" hidden={!back} aria-label="Card properties">
        {back ? <ShowFrontContext.Provider value={showFront}>{properties}</ShowFrontContext.Provider> : null}
      </section>
    </article>
  );
}
