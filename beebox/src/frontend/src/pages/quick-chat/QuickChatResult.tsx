import { useState } from "react";
import type { RouterOutput } from "../../lib/trpc";
import { href } from "../../lib/routing";
import { Stack } from "../../components/ui/Stack";
import { Row } from "../../components/ui/Row";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { SelectField } from "../../components/ui/fields";
import { TextLink } from "../../components/ui/TextLink";
import { Card } from "../../components/ui/Card";

export function QuickChatResult({ result, boxSlug, busy, onSend }: { result: RouterOutput["quickChat"]["prepare"]; boxSlug: string; busy: boolean; onSend: (id: string) => void }) {
  const [alternative, setAlternative] = useState("");
  const sent = result.receipt !== undefined;
  const sessionId = result.receipt?.sessionId;
  const ranked = result.candidates.map(candidate => ({ candidate, probability: result.probabilities[candidate.id] ?? 0 })).toSorted((a, b) => b.probability - a.probability);
  return (
    <Card><Stack gap="sm">
      <Text as="h2" weight="bold">{sent ? (result.receipt?.queued ? "Queued in " : "Sent to ") + result.selected.label : result.selected.target.kind === "no-match" ? "Choose a destination" : "Destination: " + result.selected.label}</Text>
      {sessionId !== undefined && <TextLink id="bbx-quick-chat-open" to={href(`/${boxSlug}/chat?session=${encodeURIComponent(sessionId)}`)}>Open chat</TextLink>}
      {sent === true && !sessionId && <Text as="p" tone="muted">The message was accepted. Waiting for the new chat’s address; it will also appear in Chats.</Text>}
      {result.preferenceApplied === true && <Text as="p" tone="muted">Continued an existing chat because it was close to the top choice.</Text>}
      {result.candidates.some(candidate => candidate.contextTruncated) && <Text as="p" size="sm" tone="muted">Conversation excerpts were shortened to fit this routing request.</Text>}
      <Text as="p" size="sm" tone="muted">Jev’s top choices (experimental estimates):</Text>
      {ranked.slice(0, 3).map(({ candidate, probability }) => <Row key={candidate.id} justify="between"><Text>{candidate.label}</Text><Text>{Math.round(probability * 100)}%</Text></Row>)}
      <SelectField id="bbx-quick-chat-alternative" label={sent ? "Wrong destination?" : "Destination"} value={alternative} onChange={setAlternative}
        options={[{ value: "", label: "Choose a conversation or place…" }, ...ranked.filter(row => row.candidate.target.kind !== "no-match").map(row => ({ value: row.candidate.id, label: row.candidate.label }))]} />
      {sent === true && <Text as="p" size="sm" tone="muted">Sending elsewhere sends another copy. It does not undo anything the first chat has done.</Text>}
      <Button id="bbx-quick-chat-correct" disabled={busy || !alternative} onClick={() => onSend(alternative)}>{sent ? "Send a copy there" : "Send there"}</Button>
    </Stack></Card>
  );
}
