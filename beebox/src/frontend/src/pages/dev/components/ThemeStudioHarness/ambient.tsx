/** Real callouts above the composer from an off-screen conversation, using a fictional already-loaded transcript. */
import { useMemo } from "react";
import { ComposerMaterial } from "../../../../components/chat/ComposerMaterial";
import { SessionCallouts } from "../../../../components/chat/ambient/AmbientReplies/view";
import { SelectedTranscriptRegion } from "../../../../components/chat/ambient/selected-transcript";
import { NotificationNotice } from "../../../../components/notifications/NotificationNotice";
import { StatusPill } from "../../../../components/chat/StatusPill";
import { ExpiredAttachmentsNotice } from "../../../../components/chat/InteractiveChat-layout/view/ChatComposerSection";
import { Accordion } from "../../../../components/ui/Accordion";
import { Hint } from "../../../../components/ui/Hint";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { Text } from "../../../../components/ui/Text";
import type { SessionEntry } from "../../../../api";

const SESSION = { sessionId: "theme-studio-ambient" };
const ENTRIES: SessionEntry[] = [
  { uuid: "studio-ambient-user", type: "user", timestamp: "2026-08-01T10:00:00Z", content: [{ type: "text", text: "Prepare the welcome table." }] },
  { uuid: "studio-ambient-reply", type: "assistant", timestamp: "2026-08-01T10:01:00Z", content: [{ type: "text", text: "The checklist is ready.\n<callout context=\"Welcome table\">Bring spare envelopes for new arrivals.</callout>" }] },
];
function noop() {}

export function AmbientSpecimen() {
  // A fresh completion restores the sample after a person dismissed it on a previous visit.
  const completion = useMemo(() => crypto.randomUUID(), []);
  return <ComposerMaterial id="bbx-theme-studio-ambient" className="flex flex-col w-full max-w-5xl mx-auto min-w-0">
    <SelectedTranscriptRegion sessionId={SESSION.sessionId} loaded entries={ENTRIES} total={20} busy={false}>
      <SessionCallouts boxSlug="test1" storageScope="theme-studio" session={SESSION}
        selectedSessionId={SESSION.sessionId} transcriptVisible={false} completion={completion} dismissal={0}
        onActivity={noop} onShowing={noop} onInspectCard={noop} />
    </SelectedTranscriptRegion>
  </ComposerMaterial>;
}

/** Light notices inside the composer retain their own foreground palette. */
export function ComposerNoticeSpecimen() {
  return <ComposerMaterial id="bbx-theme-studio-composer-notices" className="space-y-2">
    <NotificationNotice idPrefix="bbx-studio-notification" title="Welcome table reminder" body="Bring labels and spare envelopes." onDismiss={noop} />
    <StatusPill><Text size="xs" tone="subtle">Screenshot added to the chat</Text></StatusPill>
    <ExpiredAttachmentsNotice names={["Seed packets.png"]} onDismiss={noop} />
    <Card>
      <Accordion id="bbx-studio-light-accordion" defaultOpen title={<Text size="sm">Details on a light panel</Text>}>
        <Hint>A hint on the light panel.</Hint>
        <Button id="bbx-studio-light-ghost" intent="ghost" size="sm">Panel action</Button>
      </Accordion>
    </Card>
  </ComposerMaterial>;
}
