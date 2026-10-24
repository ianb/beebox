import { trpc } from "../../../lib/trpc/client";
import { useRevealOnce } from "../use-reveal-once";
import { focusRemainsWithin } from "../../../lib/dom-focus.js";
import { Button } from "../../ui/Button";
import { ErrorText } from "../../ui/ErrorText";
import { Row } from "../../ui/Row";

/** Value is requested only after a human clicks Show and is cleared on blur, timeout, or unmount. */
export function RevealSecretValue({ name }: { name: string }) {
  const reveal = trpc.secrets.revealValue.useMutation();
  const { value, shownRef, show, hide } = useRevealOnce(async () => (await reveal.mutateAsync({ name })).value, reveal.reset);
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
