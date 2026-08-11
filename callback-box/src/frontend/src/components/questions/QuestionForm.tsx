/**
 * Form for answering a question — dispatches on `input.type` (Track C).
 *
 * `confirm` → Yes/No buttons + optional note, submits `{selectedId, answer?}`.
 * `select` → card-style radios, submits the chosen label as `answer` (the
 * backend resolves the label to the option id — see answer.ts's
 * `resolveSelectAnswer`).
 * `text` → a plain textarea, submits `{answer}`.
 *
 * Answering is allowed for pending, expired, and dismissed questions (Track
 * B) — only `answered` is terminal — so this form renders the same way for
 * all three; callers decide when to show it. A Dismiss affordance is a
 * single, reversible tap: dismissed questions stay answerable.
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { cbSource } from "../../lib/source-tag";
import { RadioGroup, TextareaField } from "../ui/fields";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import type { RouterOutput } from "../../lib/trpc";

export type QuestionInfo = RouterOutput["status"]["questions"]["items"][number];

interface QuestionFormProps {
  question: QuestionInfo;
  onAnswered: () => void;
  sourcePath?: string;
}

/**
 * Shared preamble shown above every widget: title and prompt always fully
 * visible, supporting prose (memo, learning) height-capped with its own
 * scroll.
 *
 * The question and its answer controls are the card's point, and long prose
 * used to push them below an invisible fold — a field-test operator judged a
 * real person "would have read that card as informational and closed it,"
 * silently breaking the questions loop. So the prompt leads (it's the
 * question), the context scrolls, and the answer never hides.
 */
function QuestionContext({ question }: { question: QuestionInfo }) {
  const hasMemo = question.memo !== undefined && question.memo !== "";
  const hasLearning = question.learning?.proposal !== undefined;
  return (
    <>
      <Text as="h3" size="lg" weight="bold" className="mb-2">
        {question.name}
      </Text>
      <Text as="p" className="mb-2">
        {question.prompt}
      </Text>
      {hasMemo || hasLearning ? (
        <div className="max-h-[30vh] overflow-y-auto mb-4">
          {hasMemo ? (
            <Text as="p" tone="subtle" size="sm" className="mb-2">
              {question.memo}
            </Text>
          ) : null}
          {hasLearning ? (
            <Card padding="sm" background="info" border="none">
              <Text as="div" size="xs" tone="subtle" uppercase weight="semibold" className="mb-1">
                What the box is trying to learn
              </Text>
              <Text as="div" size="sm">{question.learning?.proposal}</Text>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className="mb-2" />
      )}
    </>
  );
}

/** The submit/dismiss row, pinned to the bottom of whatever scrolls the
 *  card: even a long option list never scrolls the answer buttons out of
 *  reach (the second fold the field-test operator hit). Card backgrounds
 *  are white, so the pinned row paints over content sliding beneath it. */
const SUBMIT_ROW_CLASSES = "sticky bottom-0 bg-white py-2 -mb-2";

function DismissButton({ question, onAnswered }: { question: QuestionInfo; onAnswered: () => void }) {
  const dismissMutation = trpc.actions.dismiss.useMutation({ onSuccess: () => onAnswered() });
  if (question.status !== "pending") return null;
  return (
    <Button
      type="button"
      intent="ghost"
      size="sm"
      loading={dismissMutation.isPending}
      loadingLabel="Dismissing…"
      onClick={() => dismissMutation.mutate({ questionPath: question.relativePath })}
    >
      Dismiss
    </Button>
  );
}

function ConfirmForm({ question, onAnswered }: { question: QuestionInfo; onAnswered: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const answerMutation = trpc.actions.answer.useMutation({
    onSuccess: () => onAnswered(),
    onError: (err) => setError(err.message),
  });

  const submit = (selectedId: "yes" | "no") => {
    setError(null);
    answerMutation.mutate({
      questionPath: question.relativePath,
      selectedId,
      answer: note !== "" ? note : undefined,
    });
  };

  return (
    <Stack gap="sm">
      <TextareaField
        label="Note (optional)"
        value={note}
        onChange={setNote}
        placeholder="Add context for your answer..."
        rows={2}
      />
      {error !== null ? <Text as="div" tone="danger" size="sm">{error}</Text> : null}
      <Row gap="sm" className={SUBMIT_ROW_CLASSES}>
        <Button
          type="button"
          intent="primary"
          loading={answerMutation.isPending}
          loadingLabel="Submitting…"
          onClick={() => submit("yes")}
        >
          Yes
        </Button>
        <Button
          type="button"
          intent="secondary"
          loading={answerMutation.isPending}
          loadingLabel="Submitting…"
          onClick={() => submit("no")}
        >
          No
        </Button>
        <DismissButton question={question} onAnswered={onAnswered} />
      </Row>
    </Stack>
  );
}

function SelectForm({ question, onAnswered }: { question: QuestionInfo; onAnswered: () => void }) {
  const [selectedOption, setSelectedOption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const answerMutation = trpc.actions.answer.useMutation({
    onSuccess: () => onAnswered(),
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOption) {
      setError("Please choose an answer");
      return;
    }
    setError(null);
    // Send the chosen option's label as the answer; the backend resolves it to
    // the real option id (the frontend only has labels, not ids).
    answerMutation.mutate({ questionPath: question.relativePath, answer: selectedOption });
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <RadioGroup
          label="Answer"
          name="answer"
          variant="cards"
          value={selectedOption}
          onChange={setSelectedOption}
          options={(question.options ?? []).map((option) => ({ value: option, label: option }))}
          error={error !== null ? error : undefined}
        />
        <Row gap="sm" className={SUBMIT_ROW_CLASSES}>
          <Button
            type="submit"
            intent="primary"
            disabled={!selectedOption}
            loading={answerMutation.isPending}
            loadingLabel="Submitting…"
          >
            Submit Answer
          </Button>
          <DismissButton question={question} onAnswered={onAnswered} />
        </Row>
      </Stack>
    </form>
  );
}

function TextForm({ question, onAnswered }: { question: QuestionInfo; onAnswered: () => void }) {
  const [textAnswer, setTextAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const answerMutation = trpc.actions.answer.useMutation({
    onSuccess: () => onAnswered(),
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textAnswer) {
      setError("Please provide an answer");
      return;
    }
    setError(null);
    answerMutation.mutate({ questionPath: question.relativePath, answer: textAnswer });
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <TextareaField
          label="Answer"
          value={textAnswer}
          onChange={setTextAnswer}
          placeholder="Enter your answer..."
          rows={3}
          error={error !== null ? error : undefined}
        />
        <Row gap="sm" className={SUBMIT_ROW_CLASSES}>
          <Button
            type="submit"
            intent="primary"
            disabled={!textAnswer}
            loading={answerMutation.isPending}
            loadingLabel="Submitting…"
          >
            Submit Answer
          </Button>
          <DismissButton question={question} onAnswered={onAnswered} />
        </Row>
      </Stack>
    </form>
  );
}

export function QuestionForm({ question, onAnswered, sourcePath }: QuestionFormProps) {
  const inputType = question.inputType;

  return (
    <Card padding="md" {...(sourcePath ? cbSource("card", sourcePath) : {})}>
      <QuestionContext question={question} />
      {(() => {
        switch (inputType) {
          case "confirm":
            return <ConfirmForm question={question} onAnswered={onAnswered} />;
          case "select":
            return <SelectForm question={question} onAnswered={onAnswered} />;
          case "text":
            return <TextForm question={question} onAnswered={onAnswered} />;
          case undefined:
            // The question card failed to load (see status.ts's questions query)
            // — no widget can be rendered; only Dismiss (or nothing) is offered.
            return <DismissButton question={question} onAnswered={onAnswered} />;
        }
      })()}
    </Card>
  );
}
