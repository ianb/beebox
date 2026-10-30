import { useCallback, useEffect, useRef, useState } from "react";
import { mayRevealSecretInBrowser } from "@shared/secret-reveal.js";

/**
 * A secret fetched only on a human click and held in state just long enough to
 * read: hidden after 30s, when the page is hidden, and on unmount. `fetchValue`
 * runs the reveal mutation; `reset` clears that mutation's cached result.
 */
export function useRevealOnce(fetchValue: () => Promise<string>, reset: () => void) {
  const [value, setValue] = useState<string | null>(null);
  const shownRef = useRef<HTMLDivElement>(null);
  const hide = useCallback(() => { setValue(null); reset(); }, [reset]);
  const show = async () => {
    if (!mayRevealSecretInBrowser(navigator.webdriver)) return;
    setValue(null);
    const result = await fetchValue();
    if (document.visibilityState === "visible") setValue(result);
  };
  useEffect(() => {
    if (!value) return;
    shownRef.current?.focus();
    const timer = window.setTimeout(hide, 30_000);
    return () => window.clearTimeout(timer);
  }, [value, hide]);
  useEffect(() => () => { reset(); }, [reset]);
  useEffect(() => {
    const hideWhenHidden = () => { if (document.visibilityState !== "visible") setValue(null); };
    window.addEventListener("pagehide", hideWhenHidden);
    document.addEventListener("visibilitychange", hideWhenHidden);
    return () => {
      window.removeEventListener("pagehide", hideWhenHidden);
      document.removeEventListener("visibilitychange", hideWhenHidden);
    };
  }, []);
  return { value, shownRef, show, hide };
}
