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
import { trpc } from "../../../lib/trpc/client";
import { bbxSource } from "../../../lib/source-tag";
import { RadioGroup, TextareaField } from "../../ui/fields/field";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Stack } from "../../ui/Stack";
import { Row } from "../../ui/Row";
import { Text } from "../../ui/Text";
import { ErrorText } from "../../ui/ErrorText";
import { Heading } from "../../ui/Heading";
import { QuestionMemo } from "./memo";
import { NOT_NOW } from "../question-tab";
import type { RouterOutput } from "../../../lib/trpc/client";

export type QuestionInfo = RouterOutput["status"]["questions"]["items"][number];

/**
 * Where the form is shown, beyond the Questions page
 * (docs/plans/questions-beside-the-chat.md, Track B). `beside`: the question is
 * a card beside the chat, so a text question is answered in the chat, a
 * confirm needs no note, and "Not now" closes the tab (which dismisses it).
 * `onAnswerInChat`: a list row offers to open the question beside the chat.
 */
interface FormPlace {
  /** `onShowChat` is set when the chat is hidden (desktop focus, or two card panes), so "Answer in the chat" can reveal it. */
  beside?: { onNotNow: () => void; onShowChat?: (() => void) | undefined };
  onAnswerInChat?: () => void;
}

interface QuestionFormProps extends FormPlace {
  question: QuestionInfo;
  onAnswered: () => void;
  sourcePath?: string;
}

/**
 * Shared preamble shown above every widget: the prompt (as the heading) always fully
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
      <Heading level={2} className="mb-2">
        {question.prompt}
      </Heading>
      {hasMemo || hasLearning ? (
        <div className="max-h-[30vh] overflow-y-auto mb-4">
          {hasMemo ? (
            <Text as="div" tone="subtle" size="sm" className="mb-2">
              <QuestionMemo memo={question.memo ?? ""} path={question.relativePath} />
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

/**
 * The row's secondary actions: "Answer in chat" where a list offers it, then
 * the decline for a pending question: "Dismiss" on the Questions page, or
 * "Not now" beside the chat, which closes the tab (and that dismisses it).
 */
function DismissButton({ question, onAnswered, place }: { question: QuestionInfo; onAnswered: () => void; place: FormPlace }) {
  const dismissMutation = trpc.actions.dismiss.useMutation({ onSuccess: () => onAnswered() });
  const pending = question.state === "pending";
  const handleAnswerInChat = place.onAnswerInChat;
  const handleNotNow = place.beside?.onNotNow;
  return (
    <>
      {handleAnswerInChat === undefined ? null : (
        <Button type="button" intent="ghost" size="sm" onClick={handleAnswerInChat}>Answer in chat</Button>
      )}
      {!pending ? null : handleNotNow !== undefined ? (
        <Button type="button" intent="ghost" size="sm" onClick={handleNotNow}>{NOT_NOW}</Button>
      ) : (
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
      )}
    </>
  );
}

function ConfirmForm({ question, onAnswered, place }: { question: QuestionInfo; onAnswered: () => void; place: FormPlace }) {
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
      {place.beside === undefined ? (
        <TextareaField
          label="Note (optional)"
          value={note}
          onChange={setNote}
          placeholder="Add context for your answer..."
          rows={2}
        />
      ) : null}
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
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
        <DismissButton question={question} onAnswered={onAnswered} place={place} />
      </Row>
    </Stack>
  );
}

function SelectForm({ question, onAnswered, place }: { question: QuestionInfo; onAnswered: () => void; place: FormPlace }) {
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
          <DismissButton question={question} onAnswered={onAnswered} place={place} />
        </Row>
      </Stack>
    </form>
  );
}

/** Beside the chat a text question has no box of its own: the chat's composer is where the answer goes. */
function AnswerInTheChat({ question, onAnswered, place }: { question: QuestionInfo; onAnswered: () => void; place: FormPlace }) {
  const handleShowChat = place.beside?.onShowChat;
  return (
    <Row gap="sm" className={SUBMIT_ROW_CLASSES}>
      {handleShowChat === undefined
        ? <Text as="p" size="sm" tone="subtle">Answer in the chat.</Text>
        : <Button type="button" intent="secondary" size="sm" onClick={handleShowChat}>Answer in the chat</Button>}
      <DismissButton question={question} onAnswered={onAnswered} place={place} />
    </Row>
  );
}

function TextForm({ question, onAnswered, place }: { question: QuestionInfo; onAnswered: () => void; place: FormPlace }) {
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
          <DismissButton question={question} onAnswered={onAnswered} place={place} />
        </Row>
      </Stack>
    </form>
  );
}

export function QuestionForm({ question, onAnswered, sourcePath, ...place }: QuestionFormProps) {
  const inputType = question.inputType;

  return (
    <Card padding="md" {...(sourcePath ? bbxSource("card", sourcePath) : {})}>
      <QuestionContext question={question} />
      {(() => {
        switch (inputType) {
          case "confirm":
            return <ConfirmForm question={question} onAnswered={onAnswered} place={place} />;
          case "select":
            return <SelectForm question={question} onAnswered={onAnswered} place={place} />;
          case "text":
            return place.beside === undefined
              ? <TextForm question={question} onAnswered={onAnswered} place={place} />
              : <AnswerInTheChat question={question} onAnswered={onAnswered} place={place} />;
          case undefined:
            // The question card failed to load (see status.ts's questions query)
            // — no widget can be rendered; only Dismiss (or nothing) is offered.
            return <DismissButton question={question} onAnswered={onAnswered} place={place} />;
        }
      })()}
    </Card>
  );
}
