/**
 * Questions page — view and answer pending questions.
 */

import { useState, useEffect, useCallback } from "react";
import { getQuestions, getApiBase, type CardInfo } from "../api";
import { useSSE } from "../hooks/useSSE";
import { QuestionForm } from "./QuestionForm";

export function QuestionsPage() {
  const [questions, setQuestions] = useState<CardInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQuestions = useCallback(async () => {
    try {
      const resp = await getQuestions();
      setQuestions(resp.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useSSE(`${getApiBase()}/events`, {
    onEvent: (event) => {
      if (
        event.event === "question-answered" ||
        event.event === "card-created" ||
        event.event === "file-change"
      ) {
        fetchQuestions();
      }
    },
  });

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const pending = questions.filter((q) => q.status === "pending");
  const answered = questions.filter((q) => q.status !== "pending");

  if (loading) {
    return <div className="p-8 text-warm-600">Loading...</div>;
  }

  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold text-warm-900 mb-6">Questions</h1>

        {pending.length === 0 && answered.length === 0 ? (
          <p className="text-warm-600">No questions yet.</p>
        ) : null}

        {pending.length > 0 ? (
          <div className="space-y-4 mb-8">
            {pending.map((q) => (
              <QuestionForm
                key={q.path}
                question={q}
                onAnswered={fetchQuestions}
              />
            ))}
          </div>
        ) : null}

        {answered.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wide mb-3">
              Answered
            </h2>
            <div className="space-y-2">
              {answered.map((q) => (
                <div
                  key={q.path}
                  className="p-3 bg-white rounded-lg border border-warm-200 opacity-60"
                >
                  <div className="text-sm font-medium text-warm-800">
                    {q.prompt || q.name}
                  </div>
                  <div className="text-xs text-warm-500 mt-1">
                    {q.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
