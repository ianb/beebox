/**
 * Question card renderer — shows an embedded answer form when the question
 * is answerable (pending/expired/dismissed), or the recorded answer +
 * learning outcome once it's answered. Registered for the `question` file
 * type (Track C) so `/browse/<path>` deep links (notifications, dashboard,
 * `context:` refs) always land on something actionable instead of the
 * generic frontmatter table.
 *
 * Reuses `trpc.status.questions` (the same query `QuestionsList` drives) to
 * get the fully-typed, already-validated question rather than re-parsing
 * `data.frontmatter` by hand — one source of truth for "what does a
 * question look like on the wire."
 *
 * In the workspace the card is beside the chat
 * (docs/plans/questions-later-and-figure-it-out.md, Track A): the question
 * pasted onto a stub card (`QuestionBeside`); the person answers in the chat,
 * or chooses Later or Decide for me. The agent answers from the CLI, so the
 * card refreshes on the bus.
 */

import { trpc } from "../lib/trpc/client";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { oneOf } from "../lib/live-refresh";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { cardTarget } from "./chat/workspace/use-open-beside/hook";
import { QuestionForm } from "./questions/QuestionForm/view";
import { QuestionBeside } from "./questions/QuestionBeside/view";
import { useBesideActions } from "./questions/question-tab";
import { Card } from "./ui/Card";
import { Text } from "./ui/Text";
import { StatusMessage } from "./ui/StatusMessage";
import { Heading } from "./ui/Heading";
import { StatusBadge } from "./ui/StatusBadge";
import { Stack } from "./ui/Stack";
import { Button } from "./ui/Button";
import { InlineAction } from "./ui/InlineAction";
import { bbxSource } from "../lib/source-tag";
import { renderQuestionAnswer } from "./questions/answer-display";
import type { RendererProps } from "../file-type-registry";

const ANSWERABLE = new Set(["pending", "expired", "dismissed"]);

export function QuestionCardView({ data, onNavigate, mode }: RendererProps) {
  const utils = trpc.useUtils();
  const { data: questions, isLoading, isError, refetch } = trpc.status.questions.useQuery();
  useLiveRefresh({
    when: oneOf("question-answered", "question-dismissed", "question-expired", "file-change"),
    refresh: () => { void utils.status.questions.invalidate(); },
  });
  const question = questions?.items.find((q) => q.relativePath === data.path);
  // A tab beside the chat; an embed in a chat message or a full page is not.
  const beside = useBesideActions(data.path, mode === "companion");

  if (isLoading) {
    return <StatusMessage>Loading...</StatusMessage>;
  }

  if (isError) {
    return (
      <StatusMessage>
        Couldn't load this question.{" "}
        <Button type="button" intent="ghost" size="sm" onClick={() => void refetch()}>Retry</Button>
      </StatusMessage>
    );
  }

  if (question === undefined) {
    return <StatusMessage>Question card not found.</StatusMessage>;
  }

  const onAnswered = () => void utils.status.questions.invalidate();
  const answerable = ANSWERABLE.has(question.state ?? "pending");

  if (answerable && beside !== undefined) {
    return <div className="p-4 max-w-2xl mx-auto"><QuestionBeside question={question} actions={beside} /></div>;
  }

  if (answerable) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <QuestionForm question={question} sourcePath={data.path} onAnswered={onAnswered} />
      </div>
    );
  }

  const others = (questions?.items ?? []).filter((q) => q.state === "pending" && q.invalid !== true).length;
  const answered = (
    <Stack gap="sm">
      <Heading level={2}>{question.prompt}</Heading>
      {renderQuestionAnswer(question)}
      {question.learning?.proposal !== undefined ? (
        <Card padding="sm" background="info" border="none">
          <Text as="div" size="xs" tone="subtle" uppercase weight="semibold" className="mb-1">
            What the box wanted to learn
          </Text>
          <Text as="div" size="sm">{question.learning.proposal}</Text>
        </Card>
      ) : null}
      <StatusBadge status={question.state ?? "answered"} size="sm" className="self-start" />
      {beside === undefined || others === 0 ? null : (
        <InlineAction intent="quiet" className="self-start underline"
          onClick={() => onNavigate(cardTarget(SYSTEM_CARD_PATHS.questions), { label: "Questions" })}>
          {others === 1 ? "1 more question" : `${others} more questions`}
        </InlineAction>
      )}
    </Stack>
  );
  return (
    <div className="p-4 max-w-2xl mx-auto">
      {beside === undefined
        ? <Card padding="md" {...bbxSource("card", data.path)}>{answered}</Card>
        : <div className="bbx-question-patch" data-question-beside="" data-chat-side={beside.chatSide} {...bbxSource("card", data.path)}>{answered}</div>}
    </div>
  );
}
