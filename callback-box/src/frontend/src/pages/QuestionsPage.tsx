/**
 * Questions page — view and answer pending questions.
 */

import { getEventSourceBase } from "../api";
import { trpc } from "../lib/trpc";
import { useSSE } from "../hooks/useSSE";
import { QuestionForm } from "../components/QuestionForm";
import { cbSource } from "../lib/source-tag";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { Card } from "../components/ui/Card";
import { Text } from "../components/ui/Text";

export function QuestionsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.status.questions.useQuery();

  const questions = data?.items ?? [];

  useSSE(`${getEventSourceBase()}/events`, {
    onEvent: (event) => {
      if (
        event.event === "question-answered" ||
        event.event === "card-created" ||
        event.event === "file-change"
      ) {
        utils.status.questions.invalidate();
      }
    },
  });

  const pending = questions.filter((q) => q.status === "pending");
  const answered = questions.filter((q) => q.status !== "pending");

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading...</Text>;
  }

  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4">
        <Text as="h1" size="2xl" weight="bold">Questions</Text>

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
                onAnswered={() => utils.status.questions.invalidate()}
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
    </Column>
  );
}
