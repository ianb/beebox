import { focusRemainsWithin } from "../../../lib/dom-focus.js";
import { trpc } from "../../../lib/trpc/client";
import { useRevealOnce } from "../use-reveal-once";
import { Button } from "../../ui/Button";
import { ErrorText } from "../../ui/ErrorText";
import { Stack } from "../../ui/Stack";

export function RevealCloudflareToken({ name }: { name: string }) {
  const reveal = trpc.cloudflarePublishConnections.revealToken.useMutation();
  const { value: token, shownRef, show, hide } = useRevealOnce(async () => (await reveal.mutateAsync({ name })).token, reveal.reset);
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
