/**
 * News pipeline status — compact horizontal flow display.
 * Hidden if all counts are zero.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import type { RouterOutput } from "../../lib/trpc";
import { Card } from "../ui/Card";

type NewsStatusResponse = RouterOutput["status"]["newsStatus"];

interface NewsPipelineStatusProps {
  newsStatus: NewsStatusResponse;
}

export function NewsPipelineStatus({ newsStatus }: NewsPipelineStatusProps) {
  const { boxSlug } = useParams({ strict: false });
  const { inbox, pool, archive, trash } = newsStatus;

  if (inbox === 0 && pool === 0 && archive === 0 && trash === 0) {
    return null;
  }

  return (
    <Card shadow border="none">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-warm-700">News Pipeline</h3>
        <Link to={href(`/${boxSlug}/news`)} className="text-xs text-primary hover:text-primary-dark">
          Read Briefs &rarr;
        </Link>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={`px-2 py-1 rounded ${inbox > 0 ? "bg-info-100 text-primary-dark" : "bg-warm-100 text-warm-600"}`}>
          Inbox ({inbox})
        </span>
        <span className="text-warm-500">&rarr;</span>
        <span className={`px-2 py-1 rounded ${pool > 0 ? "bg-success-100 text-success-dark" : "bg-warm-100 text-warm-600"}`}>
          Pool ({pool})
        </span>
        <span className="text-warm-500">&rarr;</span>
        <span className="px-2 py-1 rounded bg-warm-100 text-warm-700">
          Archive ({archive})
        </span>
        <span className="text-warm-500">|</span>
        <span className="px-2 py-1 rounded bg-warm-100 text-warm-600">
          Trash ({trash})
        </span>
      </div>
    </Card>
  );
}
