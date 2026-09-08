import { useLayoutEffect, useRef, type RefObject } from "react";

const MATERIAL_PROPERTIES = [
  "--bbx-material-width",
  "--bbx-material-height",
  "--bbx-material-tab-height",
  "--bbx-material-tab-x",
  "--bbx-material-tab-right",
] as const;

/**
 * Keeps the active companion tab and card on one shared material coordinate
 * plane. The values live on the pane so both surfaces can sample them without
 * adding React render state for layout measurements.
 */
export function useCompanionMaterial(activePath: string): RefObject<HTMLDivElement> {
  const paneRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return;

    let frame: number | null = null;
    let observedTab: HTMLElement | null = null;
    let observedCard: HTMLElement | null = null;

    const clear = () => {
      for (const property of MATERIAL_PROPERTIES) pane.style.removeProperty(property);
    };

    const resizeObserver = new ResizeObserver(() => scheduleMeasure());

    const observeTargets = (tab: HTMLElement | null, card: HTMLElement | null) => {
      if (tab === observedTab && card === observedCard) return;
      resizeObserver.disconnect();
      resizeObserver.observe(pane);
      if (tab !== null) resizeObserver.observe(tab);
      if (card !== null) resizeObserver.observe(card);
      observedTab = tab;
      observedCard = card;
    };

    const measure = () => {
      frame = null;
      const tab = pane.querySelector<HTMLElement>('.bbx-interface-tab[data-active="true"]');
      const card = pane.querySelector<HTMLElement>(
        '.bbx-interface-card-desk[aria-hidden="false"] > .bbx-card-surface',
      );
      observeTargets(tab, card);
      if (tab === null || card === null) {
        clear();
        return;
      }
      // rotateY collapses the bounding rect midway through a card turn. Keep
      // the last stable coordinates until the animation has completed.
      if (card.dataset.cardTurn !== undefined) return;

      const tabRect = tab.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      pane.style.setProperty("--bbx-material-width", `${card.offsetWidth}px`);
      pane.style.setProperty("--bbx-material-height", `${card.offsetHeight + tab.offsetHeight}px`);
      pane.style.setProperty("--bbx-material-tab-height", `${tab.offsetHeight}px`);
      pane.style.setProperty("--bbx-material-tab-x", `${tabRect.left - cardRect.left}px`);
      pane.style.setProperty("--bbx-material-tab-right", `${tabRect.right - cardRect.left}px`);
    };

    function scheduleMeasure() {
      if (frame !== null) return;
      frame = requestAnimationFrame(measure);
    }

    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(pane, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "data-active", "data-card-theme", "data-card-stock", "data-card-turn"],
    });
    pane.addEventListener("scroll", scheduleMeasure, true);
    pane.addEventListener("animationend", scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);
    measure();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      pane.removeEventListener("scroll", scheduleMeasure, true);
      pane.removeEventListener("animationend", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      clear();
    };
  }, [activePath]);

  return paneRef;
}
