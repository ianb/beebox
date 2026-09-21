import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { z } from "zod";
import { trpc, trpcClient } from "../../lib/trpc";
import type { RouterOutput } from "../../lib/trpc";
import { startChatTurn } from "../../api-chat";
import { href } from "../../lib/routing";
import { usePageTitle } from "../../components/DocumentTitle";
import { Stack } from "../../components/ui/Stack";
import { Row } from "../../components/ui/Row";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextareaField } from "../../components/ui/fields";
import { ErrorText } from "../../components/ui/ErrorText";
import { TextLink } from "../../components/ui/TextLink";
import { QuickChatResult } from "./QuickChatResult";

type Result = RouterOutput["quickChat"]["prepare"];
const draftSchema = z.object({ message: z.string(), id: z.string().uuid().nullable(), sourceId: z.string().uuid().optional(), candidateId: z.string().optional() });
type Draft = z.infer<typeof draftSchema>;
function readDraft(key: string): Draft {
  if (typeof localStorage === "undefined") return { message: "", id: null };
  const raw = localStorage.getItem(key);
  if (!raw) return { message: "", id: null };
  try { return draftSchema.parse(JSON.parse(raw)); }
  catch (error) { console.error("Could not restore Quick chat draft", error); return { message: "", id: null }; }
}

export function QuickChatPage() {
  const { boxSlug = "" } = useParams({ strict: false });
  return <QuickChatForm key={boxSlug} boxSlug={boxSlug} />;
}
function QuickChatForm({ boxSlug }: { boxSlug: string }) {
  usePageTitle("Quick chat");
  const key = `quick-chat:${typeof location === "undefined" ? boxSlug : location.origin + location.pathname}`;
  const [draft, setDraft] = useState(() => readDraft(key));
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { localStorage.setItem(key, JSON.stringify(draft)); }, [draft, key]);
  const sent = result?.receipt !== undefined;
  const turnId = result?.receipt?.turnId;
  trpc.events.turnStream.useSubscription({ turnId: turnId ?? "", lastEventId: null }, {
    enabled: Boolean(turnId),
    onData(payload) {
      const frame = "data" in payload ? payload.data : payload;
      if (frame.t === "error") setError(`The message was accepted, but the chat failed: ${frame.error}`);
      if (frame.t === "msg" && frame.msg.type === "system" && result) {
        const sessionId = frame.msg.session_id;
        setResult(old => old ? { ...old, receipt: { ...old.receipt, sessionId } } : old);
        void trpcClient.quickChat.receipt.mutate({ id: result.id, receipt: { sessionId } }).catch(failure => {
          console.error("Could not save Quick chat destination", failure);
          setError("The chat started, but its destination link could not be saved. Keep this page open or use chat history.");
        });
      }
    },
    onError(failure) { setError(`Could not follow the chat: ${failure.message}`); },
  });
  async function send(candidateId?: string) {
    if (busy || !draft.message.trim()) return;
    setBusy(true); setError(null);
    const source = candidateId ? result : null;
    const id = source ? crypto.randomUUID() : draft.id ?? crypto.randomUUID();
    const message = source?.message ?? draft.message.trim();
    const origin = source && candidateId ? { sourceId: source.id, candidateId } : draft.sourceId ? { sourceId: draft.sourceId, candidateId: draft.candidateId } : {};
    setDraft({ id, message, ...origin });
    try {
      const prepared = await trpcClient.quickChat.prepare.mutate({ id, message,
        ...origin });
      setResult(prepared);
      if (prepared.receipt || !prepared.delivery) return;
      const ack = await startChatTurn({ ...prepared.delivery, message: prepared.message, messageId: prepared.id });
      const receipt = { ...(prepared.delivery.session !== "new" ? { sessionId: prepared.delivery.session } : {}),
        ...(ack.turnId ? { turnId: ack.turnId } : {}), ...(ack.queued ? { queued: true } : {}) };
      setResult({ ...prepared, receipt });
      await trpcClient.quickChat.receipt.mutate({ id: prepared.id, receipt });
    } catch (failure) {
      console.error("Quick chat failed", failure);
      setError(failure instanceof Error ? failure.message : "Quick chat failed. Your text is still here.");
    } finally { setBusy(false); }
  }
  function reset() { setDraft({ id: null, message: "" }); setResult(null); setError(null); }
  return <Stack className="max-w-xl mx-auto p-4 h-app" overflow="auto" gap="md">
    <Row justify="between"><Text as="h1" size="xl" weight="bold">Quick chat</Text><TextLink id="bbx-quick-chat-history" to={href(`/${boxSlug}/chats`)}>Chats</TextLink></Row>
    <Text as="p" tone="muted">Send a thought. We’ll choose a conversation and show you where it went.</Text>
    <form onSubmit={event => { event.preventDefault(); void send(); }} aria-busy={busy}>
      <Stack gap="sm">
        <TextareaField id="bbx-quick-chat-message" label="Message" value={draft.message} rows={5} required maxLength={12000}
          disabled={busy} readOnly={draft.id !== null} onChange={message => setDraft({ id: null, message })} />
        {!sent && <Button id="bbx-quick-chat-send" type="submit" intent="primary" disabled={busy || !draft.message.trim() || result?.selected.target.kind === "no-match"}>
          {busy ? "Routing and sending…" : draft.id ? "Recover or retry send" : "Send"}
        </Button>}
        {draft.id !== null && <Button id="bbx-quick-chat-new" disabled={busy} onClick={reset}>Another message</Button>}
      </Stack>
    </form>
    {error !== null && <div role="alert"><ErrorText>{error}</ErrorText></div>}
    {result !== null && <QuickChatResult result={result} boxSlug={boxSlug} busy={busy} onSend={candidateId => void send(candidateId)} />}
  </Stack>;
}
