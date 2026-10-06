import { useCallback, useEffect, useRef, useState } from "react";
import { mayRevealSecretInBrowser } from "@shared/secret-reveal.js";
import { focusRemainsWithin } from "../../../lib/dom-focus.js";
import { trpc } from "../../../lib/trpc/client";
import { Button } from "../../ui/Button";
import { ErrorText } from "../../ui/ErrorText";
import { Stack } from "../../ui/Stack";

export function RevealCloudflareToken({ name }: { name: string }) {
  const [token, setToken] = useState<string | null>(null);
  const shownRef = useRef<HTMLDivElement>(null);
  const reveal = trpc.cloudflarePublishConnections.revealToken.useMutation();
  const resetReveal = reveal.reset;
  const hide = useCallback(() => { setToken(null); resetReveal(); }, [resetReveal]);
  const show = async () => {
    if (!mayRevealSecretInBrowser(navigator.webdriver)) return;
    setToken(null);
    const result = await reveal.mutateAsync({ name });
    if (document.visibilityState === "visible") setToken(result.token);
  };
  useEffect(() => {
    if (!token) return;
    shownRef.current?.focus();
    const timer = window.setTimeout(hide, 30_000);
    return () => window.clearTimeout(timer);
  }, [token, hide]);
  useEffect(() => () => { resetReveal(); }, [resetReveal]);
  useEffect(() => {
    const hideWhenHidden = () => { if (document.visibilityState !== "visible") setToken(null); };
    window.addEventListener("pagehide", hideWhenHidden);
    document.addEventListener("visibilitychange", hideWhenHidden);
    return () => {
      window.removeEventListener("pagehide", hideWhenHidden);
      document.removeEventListener("visibilitychange", hideWhenHidden);
    };
  }, []);
  return !token ? (
    <Stack gap="xs">
      <Button intent="secondary" loading={reveal.isPending} onClick={() => { void show(); }}>Show token</Button>
      {reveal.error ? <div role="alert"><ErrorText>{reveal.error.message}</ErrorText></div> : null}
    </Stack>
  ) : (
    <div
      ref={shownRef}
      tabIndex={-1}
      className="flex items-center gap-2"
      onBlur={(event) => { if (!focusRemainsWithin(event.currentTarget, event.relatedTarget)) hide(); }}
    >
      <span className="font-mono text-sm break-all">{token}</span>
      <Button intent="secondary" onClick={hide}>Hide</Button>
    </div>
  );
}
