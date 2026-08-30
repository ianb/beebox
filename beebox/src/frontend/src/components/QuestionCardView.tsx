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
 */

import { trpc } from "../lib/trpc";
import { QuestionForm } from "./questions/QuestionForm";
import { Card } from "./ui/Card";
import { Text } from "./ui/Text";
import { StatusBadge } from "./ui/StatusBadge";
import { Stack } from "./ui/Stack";
import { bbxSource } from "../lib/source-tag";
import { renderQuestionAnswer } from "./questions/answer-display";
import type { RendererProps } from "../renderers";

const ANSWERABLE = new Set(["pending", "expired", "dismissed"]);

export function QuestionCardView({ data }: RendererProps) {
  const utils = trpc.useUtils();
  const { data: questions, isLoading } = trpc.status.questions.useQuery();
  const question = questions?.items.find((q) => q.relativePath === data.path);

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading...</Text>;
  }

  if (question === undefined) {
    return <Text as="div" tone="subtle" className="p-8">Question card not found.</Text>;
  }

  const onAnswered = () => void utils.status.questions.invalidate();
  const answerable = ANSWERABLE.has(question.status ?? "pending");

  if (answerable) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <QuestionForm question={question} sourcePath={data.path} onAnswered={onAnswered} />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <Card padding="md" {...bbxSource("card", data.path)}>
        <Stack gap="sm">
          <Text as="h2" size="lg" weight="bold">{question.name}</Text>
          <Text as="p">{question.prompt}</Text>
          {renderQuestionAnswer(question)}
          {question.learning?.proposal !== undefined ? (
            <Card padding="sm" background="info" border="none">
              <Text as="div" size="xs" tone="subtle" uppercase weight="semibold" className="mb-1">
                What the box wanted to learn
              </Text>
              <Text as="div" size="sm">{question.learning.proposal}</Text>
            </Card>
          ) : null}
          <StatusBadge status={question.status ?? "answered"} size="sm" />
        </Stack>
      </Card>
    </div>
  );
}
