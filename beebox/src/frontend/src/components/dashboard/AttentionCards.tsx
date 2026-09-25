/**
 * Attention cards — pending questions, inbox items, and browser tasks that
 * are due, side by side. Hidden entirely if all are zero.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import type { QuestionInfo } from "../questions/QuestionForm";
import { bbxSource } from "../../lib/source-tag";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

/** A browser task the boxholder should run: due by its cadence, or never scanned. */
export interface DueBrowserTask {
  path: string;
  title: string;
  stateLabel: string;
}

interface AttentionCardsProps {
  questions: QuestionInfo[];
  inboxCount: number;
  dueBrowserTasks?: DueBrowserTask[];
}

export function AttentionCards({ questions, inboxCount, dueBrowserTasks }: AttentionCardsProps) {
  const { boxSlug } = useParams({ strict: false });
  const pendingQuestions = questions.filter((q) => q.status === "pending");
  const dueTasks = dueBrowserTasks ?? [];

  if (pendingQuestions.length === 0 && inboxCount === 0 && dueTasks.length === 0) {
    return null;
  }

  return (
    <section aria-label="Needs attention" className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Questions */}
      {pendingQuestions.length > 0 && (
        <Card shadow border="none">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-warm-700">
              Questions
              <StatusBadge status="pending" className="ml-2">{pendingQuestions.length}</StatusBadge>
            </h2>
          </div>
          <ul className="space-y-1">
            {pendingQuestions.slice(0, 5).map((q) => (
              <li key={q.path} className="text-sm" {...bbxSource("card", q.relativePath)}>
                <Link
                  to={href(`/${boxSlug}/views/${q.relativePath}`)}
                  className="text-primary hover:text-primary-dark hover:underline"
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
        </Card>
      )}

      {/* Browser tasks due: someone with a logged-in browser has to run these */}
      {dueTasks.length > 0 && (
        <Card shadow border="none">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-warm-700">
              Browser tasks to run
              <StatusBadge status="pending" className="ml-2">{dueTasks.length}</StatusBadge>
            </h2>
          </div>
          <ul className="space-y-1">
            {dueTasks.slice(0, 5).map((t) => (
              <li key={t.path} className="text-sm" {...bbxSource("card", t.path)}>
                <Link to={href(`/${boxSlug}/browse/${t.path}`)} className="text-primary hover:text-primary-dark hover:underline">
                  {t.title}
                </Link>
                <span className="text-xs text-warm-600 ml-2">{t.stateLabel}</span>
              </li>
            ))}
            {dueTasks.length > 5 && (
              <li className="text-xs text-warm-600">
                +{dueTasks.length - 5} more
              </li>
            )}
          </ul>
        </Card>
      )}

      {/* Inbox */}
      {inboxCount > 0 && (
        <Card shadow border="none">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-warm-700">
              Inbox
              <StatusBadge status="new" className="ml-2">{inboxCount}</StatusBadge>
            </h2>
            <Link
              id="bbx-dashboard-inbox-browse"
              to={href(`/${boxSlug}/browse/_content/inbox`)}
              className="text-xs text-primary hover:text-primary-dark"
            >
              Browse &rarr;
            </Link>
          </div>
          <p className="text-sm text-warm-700">
            {inboxCount} item{inboxCount !== 1 ? "s" : ""} waiting
          </p>
        </Card>
      )}
    </section>
  );
}
