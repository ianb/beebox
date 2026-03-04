/**
 * Attention cards — pending questions + inbox items, side by side.
 * Hidden entirely if both are zero.
 */

import { Link, useParams } from "react-router-dom";
import type { RouterOutput } from "../../lib/trpc";

type CardInfo = RouterOutput["status"]["questions"]["items"][number];

interface AttentionCardsProps {
  questions: CardInfo[];
  inboxCount: number;
}

export function AttentionCards({ questions, inboxCount }: AttentionCardsProps) {
  const { boxSlug } = useParams();
  const pendingQuestions = questions.filter((q) => q.status === "pending");

  if (pendingQuestions.length === 0 && inboxCount === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Questions */}
      {pendingQuestions.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-warm-700">
              Questions
              <span className="ml-2 status-badge status-pending">
                {pendingQuestions.length}
              </span>
            </h3>
          </div>
          <ul className="space-y-1">
            {pendingQuestions.slice(0, 5).map((q) => (
              <li key={q.path} className="text-sm">
                <Link
                  to={`/${boxSlug}/card/${q.relativePath}`}
                  className="text-plum hover:text-plum-dark hover:underline"
                >
                  {q.prompt || q.name}
                </Link>
              </li>
            ))}
            {pendingQuestions.length > 5 && (
              <li className="text-xs text-warm-600">
                +{pendingQuestions.length - 5} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Inbox */}
      {inboxCount > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-warm-700">
              Inbox
              <span className="ml-2 status-badge status-new">
                {inboxCount}
              </span>
            </h3>
            <Link
              to={`/${boxSlug}/browse/box/inbox`}
              className="text-xs text-plum hover:text-plum-dark"
            >
              Browse &rarr;
            </Link>
          </div>
          <p className="text-sm text-warm-700">
            {inboxCount} item{inboxCount !== 1 ? "s" : ""} waiting
          </p>
        </div>
      )}
    </div>
  );
}
