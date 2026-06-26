/**
 * Form for answering a question.
 */

import { useState } from "react";
import { trpc } from "../lib/trpc";
import { cbSource } from "../lib/source-tag";
import { RadioGroup, TextareaField } from "./ui/fields";
import { Button } from "./ui/Button";
import type { CardInfo } from "../api";

interface QuestionFormProps {
  question: CardInfo;
  onAnswered: () => void;
  sourcePath?: string;
}

export function QuestionForm({ question, onAnswered, sourcePath }: QuestionFormProps) {
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [textAnswer, setTextAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const answerMutation = trpc.actions.answer.useMutation({
    onSuccess: () => onAnswered(),
    onError: (err) => setError(err.message),
  });

  const hasOptions = question.options && question.options.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const answer = hasOptions ? selectedOption : textAnswer;
    if (!answer) {
      setError("Please provide an answer");
      return;
    }

    setError(null);

    // Send the chosen option's label as the answer; the backend resolves it to
    // the real option id (the frontend only has labels, not ids). Passing a
    // synthesized letter here would be stored verbatim instead of resolving.
    answerMutation.mutate({ questionPath: question.relativePath, answer });
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow" {...(sourcePath ? cbSource("card", sourcePath) : {})}>
      <h3 className="text-lg font-bold text-warm-900 mb-2">{question.name}</h3>
      <p className="text-warm-700 mb-4">{question.prompt}</p>

      <form onSubmit={handleSubmit}>
        {hasOptions && question.options !== undefined ? (
          <RadioGroup
            label="Answer"
            name="answer"
            variant="cards"
            value={selectedOption}
            onChange={setSelectedOption}
            options={question.options.map((option) => ({ value: option, label: option }))}
            error={error !== null ? error : undefined}
            className="mb-4"
          />
        ) : (
          <TextareaField
            label="Answer"
            value={textAnswer}
            onChange={setTextAnswer}
            placeholder="Enter your answer..."
            rows={3}
            error={error !== null ? error : undefined}
            className="mb-4"
          />
        )}

        <Button
          type="submit"
          intent="primary"
          fullWidth
          disabled={!selectedOption && !textAnswer}
          loading={answerMutation.isPending}
          loadingLabel="Submitting…"
        >
          Submit Answer
        </Button>
      </form>
    </div>
  );
}
