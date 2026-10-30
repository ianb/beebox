/**
 * The theme studio: real app components on fixed fictional content, under
 * the system and card themes the URL names (`system`, `systemStock`, `card`,
 * `cardStock`). The presentation fills the window and its samples scroll
 * inside it, as in the app. `screen` previews it at one of `SCREENS` in a
 * frame; `controls=0` hides the floating controls. `bin/theme-check` measures
 * this page, and fails on a theme rule that matches nothing here.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { THEME_CATALOG } from "@shared/card-theme/core";
import type { StudioCase } from "@shared/theme-studio-case";
import { findScreen, type Screen } from "@shared/theme-screens";
import { PresentationNotice, PresentationSnapshot, type PresentationData } from "../../../../components/themes/BoxPresentationProvider";
import { useDoodlebitMotion } from "../../../../components/themes/useDoodlebitMotion";
import { VisuallyHidden } from "../../../../components/ui/VisuallyHidden";
import { ThemeStudioControls, type StudioState } from "./controls";
import { StudioNav } from "./nav";
import { StudioConversation } from "./chat";
import { StudioCards } from "./cards";
import { useSelectionPreview } from "./selection";

const ROUTE = "/$boxSlug/dev-harness/dev/theme-studio";
const LEGACY_STUDY_IDS: Record<string, string> = {
  "phosphor-study": "phosphor",
  "overprint-study": "overprint",
  "posy-study": "posy",
};
function canonicalThemeId(name: string): string { return LEGACY_STUDY_IDS[name] ?? name; }

export function ThemeStudioHarness() {
  const search = useSearch({ from: ROUTE });
  const navigate = useNavigate({ from: "/$boxSlug/dev/theme-studio" });
  const studioCase: StudioCase = { system: canonicalThemeId(search.system), systemStock: search.systemStock, card: canonicalThemeId(search.card), cardStock: search.cardStock };
  const screen = findScreen(search.screen);
  const state: StudioState = { ...studioCase, screen: search.screen };
  return <div className="bbx-theme-studio h-full">
    <VisuallyHidden as="h1">Theme studio</VisuallyHidden>
    {screen === undefined ? <StudioPresentation {...studioCase} /> : <ScreenFrame screen={screen} />}
    {search.controls === "0" ? null : <ThemeStudioControls state={state}
      // Router owns search state; replace avoids a history entry per keystroke.
      onChange={(next) => { void navigate({ search: { ...search, ...next }, replace: true }); }} />}
  </div>;
}

/**
 * What the specimens read of the box's presentation: the studio's themes, and
 * one problem so the appearance notice shows.
 */
function usePresentation({ system, systemStock }: StudioCase): PresentationData {
  return useMemo(() => ({
    catalog: THEME_CATALOG,
    presentation: { status: "absent" },
    typeDefaults: {},
    chrome: { choice: { name: system, stock: systemStock }, origin: "box-chrome", problem: null },
    systemTheme: { contextDir: "", landmark: null, boxExplicitTheme: null, boxHasOverride: false },
    configProblems: [],
    canEditCardThemes: true,
  }), [system, systemStock]);
}

/**
 * The presentation fills the window and its samples scroll inside it
 * (`#bbx-theme-studio-scroll`), as in the app (`BoxPresentationProvider`), so
 * artwork sized to the presentation paints at the scale a screen shows.
 */
function StudioPresentation(studioCase: StudioCase) {
  const { system, systemStock, card, cardStock } = studioCase;
  const surface = useDoodlebitMotion(system === "doodlebit");
  const scroller = useRef<HTMLDivElement>(null);
  // The composer specimen takes focus as it mounts, which scrolls it into
  // view; the studio opens at the top.
  useLayoutEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, []);
  useSelectionPreview(scroller);
  return <PresentationSnapshot data={usePresentation(studioCase)} error="presentation.json: rules[2].theme must name a theme">
    <div ref={surface} className="bbx-box-presentation h-full flex flex-col" data-chrome-theme={system} data-chrome-stock={systemStock}>
      <StudioNav />
      <PresentationNotice />
      <div ref={scroller} id="bbx-theme-studio-scroll" className="flex-1 min-h-0 overflow-auto"><StudioDesks card={card} cardStock={cardStock} /></div>
    </div>
  </PresentationSnapshot>;
}

/** The conversation desk beside the card column, as the workspace splits them. */
function StudioDesks({ card, cardStock }: Pick<StudioCase, "card" | "cardStock">) {
  return <div className="grid lg:grid-cols-2 gap-4 p-3 sm:p-5 items-start">
    <div className="bbx-conversation-desk flex flex-col min-w-0 relative"><StudioConversation card={card} cardStock={cardStock} /></div>
    <StudioCards name={card} stock={cardStock} />
  </div>;
}

/**
 * The studio at one screen's size. CSS media queries follow the viewport, so
 * a smaller screen needs its own document: the frame loads this page without
 * controls or a screen, scaled down to fit the window.
 */
function ScreenFrame({ screen }: { screen: Screen }) {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const resize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const url = new URL(window.location.href);
  url.searchParams.set("controls", "0");
  url.searchParams.delete("screen");
  const scale = Math.min(1, (size.w - 32) / screen.width, (size.h - 32) / screen.height);
  return <div className="h-full flex items-center justify-center bg-warm-200 overflow-hidden">
    <div style={{ width: screen.width * scale, height: screen.height * scale }} className="shrink-0">
      <iframe id="bbx-theme-studio-screen" title={`Theme studio at ${screen.label} size`} src={url.href} width={screen.width} height={screen.height}
        style={{ transform: `scale(${String(scale)})`, transformOrigin: "0 0" }} className="block border-0 bg-white shadow-lg" />
    </div>
  </div>;
}
