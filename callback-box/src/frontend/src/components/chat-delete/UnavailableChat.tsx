import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextLink } from "../ui/TextLink";
import { DeleteChatDialog } from "./DeleteChatDialog";
import { transcriptStateSentence } from "../../lib/transcript-state";
import type { RouterOutput } from "../../lib/trpc";

/** The bootstrap answer this page exists to render. */
type UnavailableBootstrap = Extract<RouterOutput["chat"]["bootstrap"], { kind: "unavailable" }>;

export function UnavailableChat({ boxSlug, chat }: { boxSlug: string | undefined; chat: UnavailableBootstrap }) {
  const { sessionId, label, huskPath } = chat;
  // A deletion in flight says nothing about where the transcript is — reporting
  // a state there would be a guess presented as fact.
  const transcript = chat.reason === "deletion-in-progress" ? null : chat.transcript;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();
  const startNew = (): void => {
    void navigate({
      to: href(`/${boxSlug}/chat`),
      search: toSearch({ session: "new" }),
    });
  };
  return (
    <div className="mx-auto max-w-xl p-4 sm:p-8">
      <Card padding="md" border="subtle">
        <Stack gap="md">
          <Text as="h1" size="lg" weight="semibold">
            Conversation not available on this machine
          </Text>
          <Text as="p" size="sm" tone="muted">
            {transcript === null ? "Cleanup of this conversation is in progress." : transcriptStateSentence(transcript)}
          </Text>
          <Row wrap>
            <Button id="cb-chat-unavailable-new" intent="primary" size="sm" onClick={startNew}>
              Start a new conversation
            </Button>
            {huskPath === null ? null : <TextLink id="cb-chat-unavailable-open-card" to={href(`/${boxSlug}/browse/${huskPath}`)}>Open chat card</TextLink>}
            <Button id="cb-chat-unavailable-delete" intent="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              Delete conversation…
            </Button>
          </Row>
        </Stack>
      </Card>
      <DeleteChatDialog
        open={deleteOpen}
        sessionId={sessionId}
        label={label}
        huskPath={huskPath ?? undefined}
        onClose={() => setDeleteOpen(false)}
        onResult={(result) => {
          if (result.status === "deleted" || result.storage !== "present") startNew();
        }}
      />
    </div>
  );
}
