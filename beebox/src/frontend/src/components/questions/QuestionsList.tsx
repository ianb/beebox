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

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import { trpc } from "../../lib/trpc";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { QuestionForm, type QuestionInfo } from "./QuestionForm";
import { renderQuestionAnswer } from "./answer-display";
import { bbxSource } from "../../lib/source-tag";
import { Stack } from "../ui/Stack";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusBadge } from "../ui/StatusBadge";

function answeredCard(q: QuestionInfo) {
  return (
    <Card key={q.path} padding="sm" border="subtle" muted {...bbxSource("card", q.relativePath)}>
      <Stack gap="xs">
        <Text as="div" size="sm" weight="medium" tone="emphasis">
          {q.prompt ?? q.name}
        </Text>
        {renderQuestionAnswer(q, { size: "sm", tone: "default" })}
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

/**
 * A question card that failed to parse against `QuestionSchema` — bad
 * frontmatter, a lifecycle-coherence violation, etc. It carries none of the
 * typed question fields, only its raw `CardInfo`, so this renders just
 * enough to get the boxholder to the raw file: a link to `/browse/<path>`
 * where the card's frontmatter table and body are visible for hand-editing.
 */
function invalidCard(q: QuestionInfo, boxSlug: string | undefined) {
  const label = q.relativePath;
  return (
    <Card key={q.path} padding="sm" border="default" {...bbxSource("card", q.relativePath)}>
      <Stack gap="xs">
        <Text as="div" size="sm" weight="medium" tone="danger">
          Invalid question card
        </Text>
        {boxSlug !== undefined ? (
          <Link to={href(`/${boxSlug}/browse/${q.relativePath}`)}>
            <Text as="span" size="sm" tone="emphasis">{label}</Text>
          </Link>
        ) : (
          <Text as="span" size="sm" tone="emphasis">{label}</Text>
        )}
      </Stack>
    </Card>
  );
}

export function QuestionsList() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.status.questions.useQuery();
  const { boxSlug } = useParams({ strict: false });

  const questions = data?.items ?? [];

  useBusSubscription({
    onEvent: (event) => {
      if (
        event.event === "question-answered" ||
        event.event === "question-dismissed" ||
        event.event === "question-expired" ||
        event.event === "card-created" ||
        event.event === "file-change"
      ) {
        void utils.status.questions.invalidate();
      }
    },
  });

  const onAnswered = () => void utils.status.questions.invalidate();

  // Malformed cards (bad frontmatter, etc.) come back from status.questions
  // with `invalid: true` and no `status` — they must stay visible so the
  // boxholder can find and fix them, but they don't belong in any status
  // bucket (they aren't pending, answered, dismissed, or expired).
  const invalid = questions.filter((q) => q.invalid === true);
  const pending = questions.filter((q) => q.invalid !== true && q.status === "pending");
  const answered = questions.filter((q) => q.invalid !== true && q.status === "answered");
  const demoted = questions.filter(
    (q) => q.invalid !== true && (q.status === "dismissed" || q.status === "expired")
  );
  const archive = [...demoted, ...answered];

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading...</Text>;
  }

  return (
    <Stack gap="lg">
      {pending.length === 0 && archive.length === 0 && invalid.length === 0 ? (
        <Text as="p" tone="subtle">No questions yet.</Text>
      ) : null}

      {invalid.length > 0 ? (
        <Stack gap="sm">
          <Text as="h2" size="sm" weight="semibold" tone="danger" uppercase>
            Invalid
          </Text>
          <Stack gap="sm">
            {invalid.map((q) => invalidCard(q, boxSlug))}
          </Stack>
        </Stack>
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
