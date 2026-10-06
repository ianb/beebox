/**
 * One quick chat message on the box screen (docs/plans/box-screen.md, track
 * 2), in the face `rowFace` gives it: sent, needs a choice, not delivered, or
 * past its delivery window. Each face shows the thought itself and only the
 * actions that face allows.
 *
 * "Open chat" only navigates. It does not copy the thought into the chat's
 * composer: the thought is already in the chat.
 */

import { href, toSearch } from "../../lib/routing";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { rowFace, type QuickChatView } from "../../pages/box-screen/state";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextLink } from "../ui/TextLink";

export interface QuickChatRowActions {
  onChoose: (view: QuickChatView, candidateId: string) => Promise<void>;
  onRetry: (view: QuickChatView) => Promise<void>;
  onDiscard: (view: QuickChatView) => Promise<void>;
}

type ChatLinkFace = Extract<ReturnType<typeof rowFace>, { link: unknown }>["link"];

function ChatLink({ link, boxSlug, id }: { link: ChatLinkFace; boxSlug: string; id: string }) {
  if (link.kind === "chat") {
    return <TextLink id={`bbx-box-screen-open-${id}`} to={href(`/${boxSlug}/chat`)} search={toSearch({ session: link.sessionId })}>Open chat</TextLink>;
  }
  return <TextLink id={`bbx-box-screen-all-chats-${id}`} to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.landmarks}`)}>All chats</TextLink>;
}

function DiscardButton({ view, busy, actions }: { view: QuickChatView; busy: boolean; actions: QuickChatRowActions }) {
  return <Button id={`bbx-box-screen-discard-${view.id}`} size="sm" intent="ghost" disabled={busy} onClick={() => actions.onDiscard(view)}>Discard</Button>;
}

function FaceBody({ view, boxSlug, busy, actions }: { view: QuickChatView; boxSlug: string; busy: boolean; actions: QuickChatRowActions }) {
  const face = rowFace(view);
  switch (face.kind) {
    case "sent":
      return (
        <Row justify="between" gap="sm" wrap>
          <Text weight="medium">{face.title}</Text>
          <ChatLink link={face.link} boxSlug={boxSlug} id={view.id} />
        </Row>
      );
    case "needs-choice":
      return (
        <Stack gap="sm">
          <Text weight="medium">{face.title}</Text>
          <Row gap="sm" wrap>
            {face.choices.map((choice) => (
              <Button key={choice.candidateId} id={`bbx-box-screen-choose-${view.id}-${choice.candidateId}`} size="sm" disabled={busy}
                onClick={() => actions.onChoose(view, choice.candidateId)}>
                {choice.detail === undefined ? choice.label : `${choice.label} · ${choice.detail}`}
              </Button>
            ))}
            <DiscardButton view={view} busy={busy} actions={actions} />
          </Row>
        </Stack>
      );
    case "not-delivered":
      return (
        <Stack gap="sm">
          <Text weight="medium" tone="danger">{face.title}</Text>
          {face.detail === null ? null : <Text size="sm" tone="muted">{face.detail}</Text>}
          <Row gap="sm" wrap>
            <Button id={`bbx-box-screen-retry-${view.id}`} size="sm" intent="primary" disabled={busy} onClick={() => actions.onRetry(view)}>Retry</Button>
            <DiscardButton view={view} busy={busy} actions={actions} />
          </Row>
        </Stack>
      );
    case "expired":
      return (
        <Stack gap="sm">
          <Text weight="medium">{face.title}</Text>
          <Row gap="md" align="center" wrap>
            <ChatLink link={face.link} boxSlug={boxSlug} id={view.id} />
            <DiscardButton view={view} busy={busy} actions={actions} />
          </Row>
        </Stack>
      );
    case "discarded":
      return null;
  }
}

function QuickChatRow({ view, boxSlug, busy, error, actions }: {
  view: QuickChatView;
  boxSlug: string;
  busy: boolean;
  error: string | undefined;
  actions: QuickChatRowActions;
}) {
  return (
    <li>
      <Card padding="sm" border="subtle">
        <Stack gap="sm">
          <Text as="p" size="sm" tone="subtle" italic>&ldquo;{view.message}&rdquo;</Text>
          <FaceBody view={view} boxSlug={boxSlug} busy={busy} actions={actions} />
          {error === undefined ? null : <ErrorText>{error}</ErrorText>}
        </Stack>
      </Card>
    </li>
  );
}

/** A list of rows; `label` names it when no heading does. */
export function QuickChatList({ views, label, boxSlug, busy, errors, actions }: {
  views: QuickChatView[];
  label?: string;
  boxSlug: string;
  busy: string[];
  errors: Record<string, string>;
  actions: QuickChatRowActions;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {views.map((view) => (
        <QuickChatRow key={view.id} view={view} boxSlug={boxSlug} busy={busy.includes(view.id)} error={errors[view.id]} actions={actions} />
      ))}
    </ul>
  );
}
