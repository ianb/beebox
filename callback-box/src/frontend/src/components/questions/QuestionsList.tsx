/**
 * The questions surface: pending questions as answerable forms, everything
 * else as a muted archive below. Self-sufficient (fetches its own data,
 * live-refreshes on question/card events), so it serves both the
 * /questions page and `view: questions` cards — a straight port of the
 * page body; the query-card form (group-by, generic list renderer) is
 * future design (docs/plans/interface-as-cards.md).
 *
 * The archive is not a dead end: `answered` shows the recorded answer;
 * `dismissed`/`expired` are demoted, not closed — they keep the answer form
 * (Track C — expiry/dismissal only lower visibility, they never synthesize
 * an answer or foreclose one).
 */

import { trpc } from "../../lib/trpc";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { QuestionForm, type QuestionInfo } from "./QuestionForm";
import { cbSource } from "../../lib/source-tag";
import { Stack } from "../ui/Stack";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusBadge } from "../ui/StatusBadge";

function answeredCard(q: QuestionInfo) {
  return (
    <Card key={q.path} padding="sm" border="subtle" muted {...cbSource("card", q.relativePath)}>
      <Stack gap="xs">
        <Text as="div" size="sm" weight="medium" tone="emphasis">
          {q.prompt ?? q.name}
        </Text>
        {q.answer?.text !== undefined && q.answer.text !== "" ? (
          <Text as="div" size="sm" tone="default">
            {q.answer.text}
          </Text>
        ) : null}
        <StatusBadge status={q.status ?? "answered"} size="sm" />
      </Stack>
    </Card>
  );
}

function demotedCard(q: QuestionInfo, onAnswered: () => void) {
  return (
    <Stack key={q.path} gap="xs">
      <StatusBadge status={q.status ?? "expired"} size="sm" />
      <QuestionForm question={q} sourcePath={q.relativePath} onAnswered={onAnswered} />
    </Stack>
  );
}

export function QuestionsList() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.status.questions.useQuery();

  const questions = data?.items ?? [];

  useBusSubscription({
    onEvent: (event) => {
      if (
        event.event === "question-answered" ||
        event.event === "question-dismissed" ||
        event.event === "card-created" ||
        event.event === "file-change"
      ) {
        void utils.status.questions.invalidate();
      }
    },
  });

  const onAnswered = () => void utils.status.questions.invalidate();

  const pending = questions.filter((q) => q.status === "pending");
  const answered = questions.filter((q) => q.status === "answered");
  const demoted = questions.filter((q) => q.status === "dismissed" || q.status === "expired");
  const archive = [...demoted, ...answered];

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading...</Text>;
  }

  return (
    <Stack gap="lg">
      {pending.length === 0 && archive.length === 0 ? (
        <Text as="p" tone="subtle">No questions yet.</Text>
      ) : null}

      {pending.length > 0 ? (
        <Stack gap="lg">
          {pending.map((q) => (
            <QuestionForm
              key={q.path}
              question={q}
              sourcePath={q.relativePath}
              onAnswered={onAnswered}
            />
          ))}
        </Stack>
      ) : null}

      {archive.length > 0 ? (
        <Stack gap="sm">
          <Text as="h2" size="sm" weight="semibold" tone="subtle" uppercase>
            Archive
          </Text>
          <Stack gap="sm">
            {demoted.map((q) => demotedCard(q, onAnswered))}
            {answered.map((q) => answeredCard(q))}
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
}
