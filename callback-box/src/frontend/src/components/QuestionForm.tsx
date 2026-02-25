/**
 * Form for answering a question.
 */

import { useState } from "react";
import { answerQuestion, type CardInfo } from "../api";

interface QuestionFormProps {
  question: CardInfo;
  onAnswered: () => void;
}

export function QuestionForm({ question, onAnswered }: QuestionFormProps) {
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [textAnswer, setTextAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasOptions = question.options && question.options.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const answer = hasOptions ? selectedOption : textAnswer;
    if (!answer) {
      setError("Please provide an answer");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // For select questions, find the option ID
      const selectedId = hasOptions
        ? String.fromCodePoint(97 + (question.options?.indexOf(selectedOption) ?? 0))
        : undefined;

      await answerQuestion({ questionPath: question.relativePath, answer, selectedId });
      onAnswered();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-bold text-warm-900 mb-2">{question.name}</h3>
      <p className="text-warm-700 mb-4">{question.prompt}</p>

      <form onSubmit={handleSubmit}>
        {hasOptions ? (
          <div className="space-y-2 mb-4">
            {question.options?.map((option, index) => (
              <label
                key={index}
                className={`block p-3 border rounded cursor-pointer transition-colors ${
                  selectedOption === option
                    ? "border-plum bg-iris-50"
                    : "border-warm-300 hover:border-warm-400"
                }`}
              >
                <input
                  type="radio"
                  name="answer"
                  value={option}
                  checked={selectedOption === option}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  className="sr-only"
                />
                <span className="text-warm-900">{option}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="mb-4">
            <textarea
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              placeholder="Enter your answer..."
              className="input w-full h-24"
            />
          </div>
        )}

        {error ? <div className="text-red-600 text-sm mb-4">Error: {error}</div> : null}

        <button
          type="submit"
          disabled={submitting || (!selectedOption && !textAnswer)}
          className="btn btn-primary w-full"
        >
          {submitting ? "Submitting..." : "Submit Answer"}
        </button>
      </form>
    </div>
  );
}
