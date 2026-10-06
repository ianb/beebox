import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "../../../lib/trpc/client";
import { mayRevealSecretInBrowser } from "@shared/secret-reveal.js";
import { focusRemainsWithin } from "../../../lib/dom-focus.js";
import { Button } from "../../ui/Button";
import { ErrorText } from "../../ui/ErrorText";
import { Row } from "../../ui/Row";

/** Value is requested only after a human clicks Show and is cleared on blur, timeout, or unmount. */
export function RevealSecretValue({ name }: { name: string }) {
  const [value, setValue] = useState<string | null>(null);
  const shownRef = useRef<HTMLDivElement>(null);
  const reveal = trpc.secrets.revealValue.useMutation();
  const resetReveal = reveal.reset;
  const hide = useCallback(() => { setValue(null); resetReveal(); }, [resetReveal]);
  const show = async () => {
    if (!mayRevealSecretInBrowser(navigator.webdriver)) return;
    setValue(null);
    const result = await reveal.mutateAsync({ name });
    if (document.visibilityState === "visible") setValue(result.value);
  };
  useEffect(() => {
    if (!value) return;
    shownRef.current?.focus();
    const timer = window.setTimeout(hide, 30_000);
    return () => window.clearTimeout(timer);
  }, [value, hide]);
  useEffect(() => () => { resetReveal(); }, [resetReveal]);
  useEffect(() => {
    const hideWhenHidden = () => { if (document.visibilityState !== "visible") setValue(null); };
    window.addEventListener("pagehide", hideWhenHidden);
    document.addEventListener("visibilitychange", hideWhenHidden);
    return () => {
      window.removeEventListener("pagehide", hideWhenHidden);
      document.removeEventListener("visibilitychange", hideWhenHidden);
    };
  }, []);
  return (
    <Row gap="sm" align="center" wrap>
      {!value ? (
        <Button intent="secondary" loading={reveal.isPending} onClick={() => { void show(); }}>Show value</Button>
      ) : (
        <div
          ref={shownRef}
          tabIndex={-1}
          className="flex items-center gap-2"
          onBlur={(event) => { if (!focusRemainsWithin(event.currentTarget, event.relatedTarget)) hide(); }}
        >
          <span className="font-mono text-sm break-all">{value}</span>
          <Button intent="secondary" onClick={hide}>Hide</Button>
        </div>
      )}
      {reveal.error ? <ErrorText>{reveal.error.message}</ErrorText> : null}
    </Row>
  );
}
