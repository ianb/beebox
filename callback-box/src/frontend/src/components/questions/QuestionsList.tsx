/**
 * The questions surface: pending questions as answerable forms, answered
 * ones as a muted archive below. Self-sufficient (fetches its own data,
 * live-refreshes on question/card events), so it serves both the
 * /questions page and `view: questions` cards — a straight port of the
 * page body; the query-card form (group-by, generic list renderer) is
 * future design (docs/plans/interface-as-cards.md).
 */

import { trpc } from "../../lib/trpc";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { QuestionForm } from "./QuestionForm";
import { cbSource } from "../../lib/source-tag";
import { Stack } from "../ui/Stack";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";

export function QuestionsList() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.status.questions.useQuery();

  const questions = data?.items ?? [];

  useBusSubscription({
    onEvent: (event) => {
      if (
        event.event === "question-answered" ||
        event.event === "card-created" ||
        event.event === "file-change"
      ) {
        void utils.status.questions.invalidate();
      }
    },
  });

  const pending = questions.filter((q) => q.status === "pending");
  const answered = questions.filter((q) => q.status !== "pending");

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading...</Text>;
  }

  return (
    <Stack gap="lg">
      {pending.length === 0 && answered.length === 0 ? (
        <Text as="p" tone="subtle">No questions yet.</Text>
      ) : null}

      {pending.length > 0 ? (
        <Stack gap="lg">
          {pending.map((q) => (
            <QuestionForm
              key={q.path}
              question={q}
              sourcePath={q.relativePath}
              onAnswered={() => void utils.status.questions.invalidate()}
            />
          ))}
        </Stack>
      ) : null}

      {answered.length > 0 ? (
        <Stack gap="sm">
          <Text as="h2" size="sm" weight="semibold" tone="subtle" uppercase>
            Answered
          </Text>
          <Stack gap="sm">
            {answered.map((q) => (
              <Card
                key={q.path}
                padding="sm"
                border="subtle"
                muted
                {...cbSource("card", q.relativePath)}
              >
                <Text as="div" size="sm" weight="medium" tone="emphasis">
                  {q.prompt || q.name}
                </Text>
                <Text as="div" size="xs" tone="muted" className="mt-1">
                  {q.status}
                </Text>
              </Card>
            ))}
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
}
