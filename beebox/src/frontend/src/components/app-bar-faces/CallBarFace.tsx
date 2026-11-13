/**
 * The call bar at the top of the chat's status banners
 * (docs/plans/chat-calls.md, Track D): a call ringing or going that this tab
 * can join, this tab's own call with its controls, or how a call ended.
 * Pure: `CallBar` computes the view and passes the actions, so tests render
 * every state.
 */

import type { ReactNode } from "react";
import type { CallBarView, CallEndReason, FailCause, InCall, PeerLink } from "../../lib/call-state";
import { CALL_MEMBER_CAP } from "../../lib/call-state";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { Hint } from "../ui/Hint";
import { InlineAction } from "../ui/InlineAction";
import { List } from "../ui/List";
import { LiveDot } from "../ui/LiveDot";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";

export interface CallBarActions {
  handleJoin: () => Promise<void>;
  /** Leave the call, or clear an ended call's message. */
  handleLeave: () => void;
  handleMute: () => void;
  handleCamera: () => Promise<void>;
  handleTranscribe: (on: boolean) => Promise<void>;
  handleRetryMic: () => Promise<void>;
}

const ENDED: Record<CallEndReason, string> = {
  "no-answer": "No one joined.",
  full: `Call is full (${CALL_MEMBER_CAP}).`,
  gone: "The call ended.",
};

const CAUSE: Record<FailCause, string> = {
  "no-relay": "This box has no relay for calls; ask the boxholder to add one.",
  failed: "The connection failed.",
};

function TranscribingMarker() {
  return <Badge tone="danger" size="sm"><LiveDot tone="danger" size="sm" /> Transcribing</Badge>;
}

function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function Bar({ children }: { children: ReactNode }) {
  return <Card id="bbx-call-bar" role="group" aria-label="Call" padding="sm" border="subtle" className="mx-3 mb-2">{children}</Card>;
}

function MemberHead({ name, email, link }: { name: string; email: string; link: PeerLink | undefined }) {
  return (
    <li>
      <Row gap="xs" align="center">
        <Avatar name={name} email={email} size="sm" />
        <Text size="sm">{name}</Text>
        {link?.state === "connecting" ? <Text size="xs" tone="muted">connecting…</Text> : null}
      </Row>
      {link?.state === "failed" ? <ErrorText>Can&apos;t connect to {name}. {CAUSE[link.cause]}</ErrorText> : null}
    </li>
  );
}

function callStatus(call: InCall, others: number): string | null {
  if (call.phase === "joining") return "Joining…";
  if (others > 0) return null;
  return call.everJoined ? "Waiting for others to join." : "Ringing…";
}

function MediaNotices({ call, actions }: { call: InCall; actions: CallBarActions }) {
  return (
    <>
      {call.mic === "denied" || call.mic === "lost" ? (
        <Hint>
          {call.mic === "lost" ? "Your microphone stopped." : "Your microphone is blocked or missing, so others cannot hear you; you can still listen. Allow it in the browser's site settings, then "}
          <InlineAction id="bbx-call-retry-mic" onClick={actions.handleRetryMic}>try again</InlineAction>.
        </Hint>
      ) : null}
      {call.camera === "denied" ? <Hint>The camera is blocked or missing. Allow it in the browser&apos;s site settings.</Hint> : null}
      {call.recording.state === "failed" ? <ErrorText>Transcription is not recording your microphone: {call.recording.message}</ErrorText> : null}
    </>
  );
}

function InCallBar({ call, actions }: { call: InCall; actions: CallBarActions }) {
  const others = call.members.filter((m) => m.peerId !== call.selfPeerId);
  const status = callStatus(call, others.length);
  const micUsable = call.mic === "on" || call.mic === "muted";
  return (
    <Bar>
      <Row gap="sm" align="center" wrap>
        {status === null ? null : <Text size="sm" tone="muted">{status}</Text>}
        <List aria-label="On the call" direction="row" gap="sm">
          {others.map((m) => <MemberHead key={m.peerId} name={m.person.name} email={m.person.email} link={call.links[m.peerId]} />)}
        </List>
        {call.transcribing ? <TranscribingMarker /> : null}
        <Row gap="xs" className="ml-auto">
          <Button id="bbx-call-mute" size="sm" intent={call.mic === "muted" ? "accent" : "secondary"} aria-pressed={call.mic === "muted"} disabled={!micUsable} onClick={actions.handleMute}>Mute</Button>
          <Button id="bbx-call-camera" size="sm" intent={call.camera === "on" ? "accent" : "secondary"} aria-pressed={call.camera === "on"} disabled={call.phase !== "in-call"} onClick={actions.handleCamera}>Camera</Button>
          <Button id="bbx-call-transcribe" size="sm" intent={call.transcribing ? "accent" : "secondary"} aria-pressed={call.transcribing} disabled={call.phase !== "in-call"} onClick={() => actions.handleTranscribe(!call.transcribing)}>Transcribe</Button>
          <Button id="bbx-call-leave" size="sm" intent="destructive" onClick={actions.handleLeave}>Leave</Button>
        </Row>
      </Row>
      <MediaNotices call={call} actions={actions} />
    </Bar>
  );
}

export function CallBarFace({ view, actions }: { view: CallBarView; actions: CallBarActions }) {
  switch (view.kind) {
    case "none":
      return null;
    case "ringing":
    case "going":
      return (
        <Bar>
          <Row gap="sm" align="center" wrap>
            <Text size="sm" weight="medium">{view.kind === "ringing" ? `${namesText(view.people)} is calling` : `${namesText(view.people)} ${view.people.length === 1 ? "is" : "are"} on a call`}</Text>
            {view.transcribing ? <TranscribingMarker /> : null}
            {view.full
              ? <Text size="sm" tone="muted">{ENDED.full}</Text>
              : <Button id="bbx-call-bar-join" size="sm" intent="success" className="ml-auto" onClick={actions.handleJoin}>Join</Button>}
          </Row>
        </Bar>
      );
    case "other-tab":
      return (
        <Bar>
          <Row gap="sm" align="center">
            <Text size="sm">On the call in another tab.</Text>
            {view.transcribing ? <TranscribingMarker /> : null}
          </Row>
        </Bar>
      );
    case "in-call":
      return <InCallBar call={view.call} actions={actions} />;
    case "ended":
      return (
        <Bar>
          <Row gap="sm" align="center">
            <Text size="sm">{ENDED[view.reason]}</Text>
            <Button id="bbx-call-dismiss" size="sm" intent="ghost" className="ml-auto" onClick={actions.handleLeave}>Dismiss</Button>
          </Row>
        </Bar>
      );
  }
}
