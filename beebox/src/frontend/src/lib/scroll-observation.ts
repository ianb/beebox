/** Read-only DOM observations, opt-in through the development trace API. */
type Detail = Record<string, string | number | boolean>;
type RecordEvent = (kind: string, detail: Detail) => void;

const SCROLLER = "[data-testid=chat-scroller]";
const COMPOSER = "textarea[id^=bbx-composer-input]";

function rounded(value: number): number { return Math.round(value * 10) / 10; }

function measureGeometry(scroller: HTMLElement | null): Detail {
  const composer = Array.from(document.querySelectorAll<HTMLTextAreaElement>(COMPOSER))
    .find((el) => el.getBoundingClientRect().height > 0);
  const viewport = window.visualViewport;
  return {
    scrollerPresent: scroller !== null,
    composerPresent: composer !== undefined,
    top: rounded(scroller?.scrollTop ?? 0),
    sh: scroller?.scrollHeight ?? 0,
    ch: scroller?.clientHeight ?? 0,
    composerH: rounded(composer?.getBoundingClientRect().height ?? 0),
    composerTop: rounded(composer?.getBoundingClientRect().top ?? 0),
    composerScroll: rounded(composer?.scrollTop ?? 0),
    viewportH: rounded(viewport?.height ?? window.innerHeight),
    viewportTop: rounded(viewport?.offsetTop ?? 0),
    pageTop: rounded(window.scrollY),
    focused: document.activeElement === composer,
    latestButton: document.getElementById("bbx-chat-scroll-latest") !== null,
  };
}

/** No text, paths, input values, or message identifiers enter the trace. */
export function startScrollObservation(record: RecordEvent): () => void {
  let frame = 0;
  let previous = "";
  let previousTime = performance.now();
  let scroller: HTMLElement | null = null;
  let anchor: Element | null = null;
  let anchorNumber = 0;
  const mutations = new MutationObserver((records) => {
    let added = 0;
    let removed = 0;
    let text = 0;
    for (const event of records) {
      added += event.addedNodes.length;
      removed += event.removedNodes.length;
      if (event.type === "characterData") text++;
    }
    record("dom", { added, removed, text });
  });
  const sample = (): void => {
    const now = performance.now();
    const elapsed = now - previousTime;
    previousTime = now;
    const current = document.querySelector<HTMLElement>(SCROLLER);
    if (current !== scroller) {
      record("scroller-node", { present: current !== null });
      mutations.disconnect();
      scroller = current;
      anchor = null;
      if (current) mutations.observe(current, { childList: true, subtree: true, characterData: true });
    }
    const geometry = measureGeometry(scroller);
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      // Keep the same visible paragraph across reflows; do not let a new
      // controller-selected anchor conceal movement of the original text.
      if (!anchor?.isConnected) {
        const candidates = scroller.querySelectorAll("[data-role] p, [data-role] pre");
        const next = Array.from(candidates.length > 0 ? candidates : scroller.querySelectorAll("[data-role]"))
          .find((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= rect.top && r.top < rect.bottom;
          }) ?? null;
        if (next !== anchor) {
          anchor = next;
          anchorNumber++;
          record("reading-anchor", { n: anchorNumber, present: anchor !== null });
        }
      }
      geometry.anchor = anchorNumber;
      geometry.anchorPresent = anchor !== null;
      geometry.anchorTop = rounded(anchor ? anchor.getBoundingClientRect().top - rect.top : 0);
      const user = Array.from(scroller.querySelectorAll("[data-role=user]")).at(-1);
      geometry.userPresent = user !== undefined;
      geometry.userTop = rounded(user ? user.getBoundingClientRect().top - rect.top : 0);
      const live = scroller.querySelector("[data-chat-live-turn-content]");
      geometry.liveH = rounded(live?.getBoundingClientRect().height ?? 0);
      geometry.turnH = rounded(live?.parentElement?.getBoundingClientRect().height ?? 0);
    }
    const serialized = JSON.stringify(geometry);
    if (serialized !== previous || elapsed > 50) {
      record("frame", { ...geometry, dt: rounded(elapsed) });
      previous = serialized;
    }
    frame = requestAnimationFrame(sample);
  };
  const action = (event: Event): void => {
    const target = event.target;
    const composer = target instanceof Element && target.matches(COMPOSER);
    const inChat = target instanceof Element && target.closest(SCROLLER) !== null;
    if (!composer && !inChat) return;
    record("interaction", { event: event.type, composer, trusted: event.isTrusted });
    if (inChat && (event.type === "wheel" || event.type === "touchstart")) anchor = null;
  };
  const eventNames = ["input", "focusin", "focusout", "wheel", "touchstart", "touchend"];
  for (const name of eventNames) document.addEventListener(name, action, { capture: true, passive: true });
  record("environment", { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio });
  frame = requestAnimationFrame(sample);
  return () => {
    cancelAnimationFrame(frame);
    mutations.disconnect();
    for (const name of eventNames) document.removeEventListener(name, action, true);
  };
}
