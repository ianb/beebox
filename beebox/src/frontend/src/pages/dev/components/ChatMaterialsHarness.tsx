/** Deterministic production message components; no model, audio, or persisted chat. */
import { useState } from "react";
import { THEME_CATALOG } from "@shared/card-theme/catalog";
import type { SessionEntry } from "../../../api";
import { AssistantMessage, CompactionMessage, InterruptedMessage, SelfNoteMessage, UserMessage } from "../../../components/chat/ChatMessages/view";
import { Button } from "../../../components/ui/Button";
import { PendingHqMessage } from "../../../components/chat/pending-hq-message";
import { TargetStrip } from "../../../components/chat/TargetStrip";
import { CaptureBubbleView } from "../../../components/chat/capture-bubble";
import { ChatStatusBanners } from "../../../components/chat/InteractiveChat-layout/view";

const THEMES = THEME_CATALOG.filter((theme) => "composition" in theme).map((theme) => ({
  name: theme.name, stock: theme.defaultStock, label: theme.label,
}));
const TIMESTAMP = "2026-10-08T12:00:00Z";
const USER: SessionEntry[] = [{ uuid: "material-user", type: "user", timestamp: TIMESTAMP,
  content: [{ type: "text", text: "Compare the three sketches and tell me what to try next." }] }];
const REPLY: SessionEntry[] = [{ uuid: "material-assistant", type: "assistant", timestamp: TIMESTAMP, content: [
  { type: "text", text: "## A clear next step\n\nKeep the **strongest composition**, but give the small details room to breathe. The background should never compete with these words.\n\n- Compare the light and dark shapes.\n- Keep links such as [the studio guide](https://example.com) easy to recognize.\n\n> A quiet reading surface makes a lively surrounding possible.\n\n`palette.primary` remains legible too." },
  { type: "thinking", text: "Checking the local sample materials before recommending a change.", progressUpdate: true },
  { type: "tool_use", toolName: "Read", toolId: "material-read", input: { file_path: "_content/studio/samples.memo.card" } },
  { type: "tool_result", toolUseId: "material-read", resultSummary: "Three sample descriptions read." },
  { type: "text", text: "The blue sketch has the clearest hierarchy. Try one smaller warm accent.\n\n<callout context=\"Next experiment\">Keep the text panel opaque while you test a bolder background.</callout>" },
] }];
const STREAM: SessionEntry[] = [{ uuid: "material-stream", type: "assistant", timestamp: TIMESTAMP, content: [
  { type: "thinking", text: "Inspecting the sample list…", progressUpdate: true },
  { type: "tool_use", toolName: "Bash", toolId: "material-running", input: { command: "list local samples" } },
  { type: "text", text: "This is a **partial streaming reply**. Its growing text stays on the same reading surface…" },
] }];
// A multi-step row for the expanded activity detail: names, places, an edit's
// before/after, a search, a failed edit, and a step with only its description.
// Results sit on the call, as `cli/lib/session-entry.ts` merges them.
const ACTIVITY: SessionEntry[] = [{ uuid: "material-activity", type: "assistant", timestamp: TIMESTAMP, content: [
  { type: "tool_use", toolName: "Grep", toolId: "activity-grep", input: { pattern: "Lemon Chicken", path: "/box/_content" } },
  { type: "tool_use", toolName: "Read", toolId: "activity-read", input: { file_path: "/box/_content/recipes/Lemon_Chicken.recipe.card" } },
  { type: "tool_use", toolName: "Edit", toolId: "activity-edit-failed", input: { file_path: "/box/_content/recipes/Lemon_Chicken.recipe.card", old_string: "Bake at 350 F", new_string: "Bake at 375 F" },
    resultSummary: "<tool_use_error>String to replace not found in file." },
  { type: "tool_use", toolName: "Edit", toolId: "activity-edit", input: { file_path: "/box/_content/recipes/Lemon_Chicken.recipe.card", old_string: "Bake at 350°F for 40 minutes.", new_string: "Bake at 375°F for 35 minutes, until the skin is golden." },
    resultSummary: "The file has been updated." },
  { type: "tool_use", toolName: "Edit", toolId: "activity-doc", input: { file_path: "/box/_content/lists/Errands.md", old_string: "- pick up chicken", new_string: "- pick up chicken\n- lemons (3)" },
    resultSummary: "The file has been updated." },
  { type: "tool_use", toolName: "Glob", toolId: "activity-glob", input: { pattern: "**/*.recipe.card" } },
  { type: "tool_use", toolName: "Bash", toolId: "activity-bash", input: { description: "check the recipe still opens", command: "bbx validate _content/recipes/Lemon_Chicken.recipe.card" } },
  { type: "text", text: "Done: Lemon Chicken now bakes at 375°F, and lemons are on your errands list." },
] }];
// One step: its line is the collapsed view, so the excerpt waits behind its click.
const ONE_STEP: SessionEntry[] = [{ uuid: "material-one-step", type: "assistant", timestamp: TIMESTAMP, content: [
  { type: "tool_use", toolName: "Edit", toolId: "one-step-edit", input: { file_path: "/box/_content/lists/Errands.md", old_string: "- milk", new_string: "- oat milk" },
    resultSummary: "The file has been updated." },
  { type: "text", text: "Changed milk to oat milk." },
] }];
const COMPACT: SessionEntry[] = [{ uuid: "material-compact", type: "compaction", timestamp: TIMESTAMP,
  content: [{ type: "text", text: "Retained the three sketches and the next experiment." }] }];

export function ChatMaterialsHarness() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>(THEMES[0] ?? { name: "retired-theme-a", stock: "pigment", label: "retired-theme-a" });
  return <div className="bbx-box-presentation h-full shrink-0 overflow-auto" data-chrome-theme={theme.name} data-chrome-stock={theme.stock} data-theme-composition="expressive">
    <header className="bg-white text-warm-900 p-3">
      <h1 className="font-semibold">Chat material verification</h1>
      <p className="text-sm">Deterministic fixtures in real message components; no live agent or tool runs.</p>
      <div className="flex flex-wrap gap-2 mt-2">{THEMES.map((choice) =>
        <Button key={choice.name} id={`bbx-chat-material-${choice.name}`} size="sm" intent={theme.name === choice.name ? "primary" : "secondary"} onClick={() => setTheme(choice)}>{choice.label}</Button>
      )}</div>
    </header>
    <div className="max-w-3xl mx-auto py-4">
      <UserMessage entries={USER} />
      <UserMessage entries={USER.map((entry) => ({ ...entry, uuid: "material-queued", pending: true }))} />
      <AssistantMessage entries={REPLY} />
      <AssistantMessage entries={STREAM} />
      <AssistantMessage entries={ACTIVITY} />
      <AssistantMessage entries={ONE_STEP} />
      <CompactionMessage entries={COMPACT} />
      <InterruptedMessage />
      <SelfNoteMessage note={{ ref: null, commit: null, body: "Saved the comparison for the next studio session." }} />
      <PendingHqMessage pending={{ id: "material-hq", text: "Keep the blue sketch for tomorrow.", status: "Improving transcript…" }} onSendLive={() => {}} />
      <CaptureBubbleView model={{ id: "material-capture", state: "failed:deliver", counts: { photos: 2, files: 0, audioSegments: 1 }, startedAt: TIMESTAMP, lastActivityAt: TIMESTAMP }} now={Date.parse(TIMESTAMP)} onRetry={async () => {}} onDiscard={async () => {}} />
      <div className="bbx-composer-material">
        <div hidden />
        <TargetStrip status={{ state: "busy", disposition: "will-queue" }} pendingCount={1} isStreaming speechPlaying={false} onInterrupt={() => {}} onStopSpeech={() => {}} />
      </div>
      <ChatStatusBanners error="Example connection error: your draft is still here." transcriptionError={null} activeSchedules={[]} onDismissError={() => {}} onCancelSchedule={() => {}} />
    </div>
  </div>;
}
