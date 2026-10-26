/**
 * The theme studio's conversation: real chat components on fixed fictional
 * entries — the empty-chat openers, user messages (one's own with a
 * selection, an unsure word, an upload and a queued status; another
 * person's), a reply with tool activity, the meta lines, a callout, a card
 * shown in chat, and the composer in its states.
 */

import type { SessionEntry } from "../../../../api";
import { AssistantMessage, CompactionMessage, InterruptedMessage, UserMessage } from "../../../../components/chat/ChatMessages/view";
import { CalloutStack } from "../../../../components/chat/CalloutBlock";
import { EmptyChat } from "../../../../components/chat/EmptyChat";
import { LoadOlderHeader } from "../../../../components/chat/LoadOlderHeader";
import { CardThemeSurface } from "../../../../components/themes/ThemedFileCard/CardThemeSurface";
import { CardSurfaceActions } from "../../../../components/themes/ThemedFileCard/CardSurfaceActions";
import { ThemeSwatchPicker } from "../../../../components/themes/ThemedFileCard/ThemeSwatchPicker";
import { Markdown } from "../../../../components/Markdown/body";
import { ComposerSpecimen } from "../ComposerStatesHarness";

function noop() { /* The specimen never sends a message or opens a card. */ }

/** The composer at rest, then in the states themes style: a draft, dictation, dictation paused for speech, narration, the phone keyboard with a draft and empty (send disabled). */
const RESTING = {
  input: "",
  isTranscribing: false, transcript: "", speechPlaying: false,
  voicePaused: false, isStreaming: false, narrationEnabled: false,
  badge: false, muted: false, typingMode: false, typingLocked: false,
};
const DRAFT = "Make a short checklist for Saturday";
const COMPOSER_STATES = [
  { ...RESTING, input: DRAFT },
  { ...RESTING, isTranscribing: true, transcript: "bring the spare tape" },
  { ...RESTING, speechPlaying: true, voicePaused: true },
  { ...RESTING, narrationEnabled: true, badge: true },
  { ...RESTING, input: DRAFT, typingMode: true },
  { ...RESTING, typingMode: true },
];

/** No such card: a swatch click reports that it could not save, and changes nothing. */
const WELCOME_PATH = "_theme-studio/Welcome table.doc.card";

function entry(over: Partial<SessionEntry> & Pick<SessionEntry, "uuid" | "type">, text: string): SessionEntry[] {
  return [{ timestamp: "2026-08-01T10:00:00Z", content: [{ type: "text", text }], ...over }];
}

const DANA = { user: "Dana", userEmail: "dana@example.com" };
const OWN = [
  ...entry({ uuid: "studio-own", type: "user", ...DANA },
    "What should we prepare for <unsure>Saturday</unsure>? <user-selection ref=\"notes/Seed exchange.doc.card\">Label each envelope clearly</user-selection>"),
  ...entry({ uuid: "studio-upload", type: "user", ...DANA },
    "<upload doc=\"tmp-upload/seeds/Batch.upload-batch.card\" files=\"3\" bytes=\"2 MB\" failed=\"1\">\nPhotos of the seed table\n\n3 files uploaded (2 MB).\n</upload>"),
];
const QUEUED = entry({ uuid: "studio-queued", type: "user", ...DANA, pending: true }, "And bring the spare tape.");
const OTHER = entry({ uuid: "studio-other", type: "user", user: "Lee", userEmail: "lee@example.com" }, "I can bring the folding table.");
const REPLY: SessionEntry[] = [{
  uuid: "studio-reply", type: "assistant", timestamp: "2026-08-01T10:00:00Z",
  content: [
    { type: "tool_use", toolName: "Read", toolId: "studio-read", input: { file_path: "notes/Seed exchange.doc.card" } },
    { type: "tool_result", toolUseId: "studio-read", resultSummary: "Before Saturday: choose three seed varieties…" },
    { type: "tool_use", toolName: "Grep", toolId: "studio-grep", input: { pattern: "envelope", path: "notes" } },
    { type: "tool_result", toolUseId: "studio-grep", resultSummary: "notes/Seed exchange.doc.card: Label each envelope clearly" },
    { type: "text", text: "Start with labeled envelopes and a small welcome table. **Keep the instructions short** so everyone can join in. See [before Saturday](#before-saturday)." },
  ],
}];
const COMPACTED = entry({ uuid: "studio-compacted", type: "compaction" }, "Earlier: the hall, the date and who brings tape.");

/** A card shown in the conversation, turned to its back: the chat path and the appearance swatches. */
function ChatCard({ card, cardStock }: { card: string; cardStock: string }) {
  return <CardThemeSurface theme={{ choice: { name: card, stock: cardStock }, origin: { kind: "engine" }, problem: null }}
    title="Welcome table" detail="Seed exchange · in chat" symbol={{ glyph: "🌱" }} boxSlug={undefined} mode="chat" initialSide="back"
    actions={<CardSurfaceActions mode="chat" path={WELCOME_PATH} />}
    properties={<><h2>Properties</h2><p>The back of a card shown in chat, with its appearance swatches.</p>
      <h3>Appearance</h3><ThemeSwatchPicker path={WELCOME_PATH} choice={{ name: card, stock: cardStock }} hasOverride /></>}>
    <div className="bbx-card-content"><Markdown prose="block" onNavigate={noop}>{"A card shown in the conversation: **by the door**, with name tags."}</Markdown></div>
  </CardThemeSurface>;
}

export function StudioConversation({ card, cardStock }: { card: string; cardStock: string }) {
  return <section aria-label="Conversation styling sample" className="min-w-0">
    <div className="flex py-4">
      <EmptyChat openers={["Plan the seed exchange"]} onSendOpener={() => "accepted"} />
    </div>
    <div className="space-y-2 pb-4">
      <LoadOlderHeader hasOlder loadingOlder={false} onLoadOlder={noop} />
      <CompactionMessage entries={COMPACTED} />
      <UserMessage entries={OWN} currentUserEmail="dana@example.com" currentUserName="Dana" />
      <UserMessage entries={OTHER} currentUserEmail="dana@example.com" currentUserName="Dana" />
      <AssistantMessage entries={REPLY} />
      <InterruptedMessage />
      <UserMessage entries={QUEUED} currentUserEmail="dana@example.com" currentUserName="Dana" />
      <CalloutStack callouts={[{ context: "Ready to review", body: "The draft checklist is ready. **Bring spare envelopes** for new arrivals." }]} />
      <div className="px-3 sm:px-6"><ChatCard card={card} cardStock={cardStock} /></div>
    </div>
    {/* Each state keeps the composer's ids, which theme rules key on, so the ids repeat. */}
    <div className="space-y-3">
      {[RESTING, ...COMPOSER_STATES].map((spec, i) => <ComposerSpecimen key={i} spec={spec} includeControlIds showHeader={false} material label={`Compose message, state ${i + 1}`} />)}
    </div>
  </section>;
}
