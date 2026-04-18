/* eslint-disable personal-vibe-check/restrict-component-classes */
/**
 * Questions page — view and answer pending questions.
 *
 * TODO: refactor to UI primitives to remove the eslint-disable above.
 */

import { getEventSourceBase } from "../api";
import { trpc } from "../lib/trpc";
import { useSSE } from "../hooks/useSSE";
import { QuestionForm } from "../components/QuestionForm";
import { cbSource } from "../lib/source-tag";

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
                sourcePath={q.relativePath}
                onAnswered={() => utils.status.questions.invalidate()}
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
                  {...cbSource("card", q.relativePath)}
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
