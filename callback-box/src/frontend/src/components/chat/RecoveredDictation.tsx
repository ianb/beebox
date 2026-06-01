/**
 * Recovered-dictation widget. Surfaces a dictation transcript that was
 * persisted mid-session (see `useDictationDraft`) when the session was
 * interrupted — screen sleep, tab eviction, reload. Rather than auto-filling
 * the composer (awkward: it may or may not get submitted, and loses the
 * narration framing), the captured text is shown in this dedicated card with
 * explicit Send / Discard actions.
 *
 * Send commits the text as a narration `<speech>` message — the audio is gone
 * after a drop, so this is the realtime transcript taking the place of the HQ
 * pass, exactly the design's documented HQ-failure fallback.
 */

import { useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Button } from "../ui/Button";
import { cbSource } from "../../lib/source-tag";
import { formatDraftAge, type DictationDraft } from "../../lib/dictation-draft";

export function RecoveredDictation(props: {
  draft: DictationDraft;
  sessionId: string | null;
  onSend: () => void;
  onDiscard: () => void;
}) {
  const { draft, sessionId, onSend, onDiscard } = props;
  // Age is derived from the wall clock, so compute it in an effect (Date.now
  // is impure and can't run during render). The card is short-lived — the user
  // sends or discards promptly — so it needn't tick.
  const [age, setAge] = useState("just now");
  useEffect(() => {
    setAge(formatDraftAge(Date.now() - draft.updatedAt));
  }, [draft.updatedAt]);

  return (
    <Card
      background="info"
      padding="sm"
      rounding="lg"
      className="mx-3 mb-2"
      {...cbSource("session", sessionId ?? "new")}
    >
      <Stack gap="sm">
        <Row gap="xs" wrap>
          <Text as="span" size="xs" weight="semibold" uppercase tone="subtle">
            Recovered dictation
          </Text>
          <Text as="span" size="xs" tone="muted">· captured {age}</Text>
        </Row>
        <Text as="p" size="sm" tone="emphasis" className="max-h-40 overflow-y-auto whitespace-pre-wrap">
          {draft.text}
        </Text>
        <Row gap="sm" justify="between" align="center">
          <Text as="span" size="xs" tone="muted">
            {draft.narration ? "Narration · " : ""}realtime transcript — review before sending
          </Text>
          <Row gap="sm">
            <Button intent="secondary" size="sm" onClick={onDiscard}>Discard</Button>
            <Button intent="primary" size="sm" onClick={onSend}>Send</Button>
          </Row>
        </Row>
      </Stack>
    </Card>
  );
}
