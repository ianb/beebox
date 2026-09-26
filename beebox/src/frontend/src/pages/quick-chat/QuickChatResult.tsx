import type { RouterOutput } from "../../lib/trpc";
import { href, toSearch } from "../../lib/routing";
import { getApiBase } from "../../api-core";
import { emissionKey, serializePersistedEmission } from "../../input/emission-persist";
import { storageScopeFor } from "../../lib/storage-scope";
import { Stack } from "../../components/ui/Stack";
import { Row } from "../../components/ui/Row";
import { Text } from "../../components/ui/Text";
import { TextLink } from "../../components/ui/TextLink";
import { Card } from "../../components/ui/Card";

export function QuickChatResult({ result, boxSlug }: { result: RouterOutput["quickChat"]["prepare"]; boxSlug: string }) {
  const sent = result.receipt !== undefined;
  const sessionId = result.receipt?.sessionId;
  const ranked = result.candidates.map(candidate => ({ candidate, probability: result.probabilities[candidate.id] ?? 0 })).toSorted((a, b) => b.probability - a.probability);
  function openDestination(): void {
    const draft = serializePersistedEmission({ text: result.message, images: [], files: [], selections: [], uploadBatch: null }, { updatedAt: Date.now() }).payload;
    try { localStorage.setItem(emissionKey({ boxSlug, scope: storageScopeFor(getApiBase()) }), draft); }
    catch (error) { console.warn("Could not stage Quick chat text in the destination composer", error); }
  }
  function destinationSearch(candidate: (typeof result.candidates)[number]): never {
    return toSearch(candidate.target.kind === "existing-session"
      ? { session: candidate.target.sessionId }
      : { session: "new", contextDir: candidate.target.contextDir });
  }
  return (
    <Card><Stack gap="sm">
      <Text as="h2" weight="bold">{sent ? (result.receipt?.queued ? "Queued in " : "Sent to ") + result.selected.label : "Destination: " + result.selected.label}</Text>
      {sessionId !== undefined && <TextLink id="bbx-quick-chat-open" to={href(`/${boxSlug}/chat`)} search={toSearch({ session: sessionId })} onClick={openDestination}>Open chat</TextLink>}
      {sent === true && !sessionId && <Text as="p" tone="muted">The message was accepted. Waiting for the new chat’s address; it will also appear in Chats.</Text>}
      {result.preferenceApplied === true && <Text as="p" tone="muted">Continued an existing chat because it was close to the top choice.</Text>}
      {result.candidates.some(candidate => candidate.contextTruncated) && <Text as="p" size="sm" tone="muted">Conversation excerpts were shortened to fit this routing request.</Text>}
      <Text as="p" size="sm" tone="muted">Jev’s top choices (experimental estimates):</Text>
      {ranked.slice(0, 3).map(({ candidate, probability }) => <Row key={candidate.id} justify="between">
        <Stack gap="xs">
        <TextLink id={`bbx-quick-chat-destination-${candidate.id}`} to={href(`/${boxSlug}/chat`)} search={destinationSearch(candidate)} onClick={openDestination}>
          {candidate.label}
        </TextLink>
        {candidate.target.kind === "existing-session" && (candidate.totalEntries !== undefined || candidate.lastMessageAt !== undefined) &&
          <Text size="sm" tone="muted">{[
            candidate.totalEntries === undefined ? null : `${candidate.totalEntries.toLocaleString()} history entries`,
            candidate.lastMessageAt === undefined ? null : `Last message ${new Date(candidate.lastMessageAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
          ].filter(Boolean).join(" · ")}</Text>}
        </Stack>
        <Text>{Math.round(probability * 100)}%</Text>
      </Row>)}
      <Text as="p" size="sm" tone="muted">Choose a destination to open that chat with this message in its composer. It will not send again automatically.</Text>
    </Stack></Card>
  );
}
