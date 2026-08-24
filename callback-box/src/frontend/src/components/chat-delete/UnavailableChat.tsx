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

export function UnavailableChat(props: { boxSlug: string | undefined; sessionId: string; label: string | null; huskPath: string | null }) {
  const { boxSlug, sessionId, label, huskPath } = props;
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
            Its local transcript is missing, so callback-box will not try to resume it.
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
