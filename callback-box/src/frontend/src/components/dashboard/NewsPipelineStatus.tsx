/**
 * News pipeline status — compact horizontal flow display.
 * Hidden if all counts are zero.
 */

import { Link } from "react-router-dom";
import type { NewsStatusResponse } from "../../api";

interface NewsPipelineStatusProps {
  newsStatus: NewsStatusResponse;
}

export function NewsPipelineStatus({ newsStatus }: NewsPipelineStatusProps) {
  const { inbox, pool, archive, trash } = newsStatus;

  if (inbox === 0 && pool === 0 && archive === 0 && trash === 0) {
    return null;
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">News Pipeline</h3>
        <Link to="/news" className="text-xs text-blue-600 hover:text-blue-800">
          Read Briefs &rarr;
        </Link>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={`px-2 py-1 rounded ${inbox > 0 ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-500"}`}>
          Inbox ({inbox})
        </span>
        <span className="text-gray-400">&rarr;</span>
        <span className={`px-2 py-1 rounded ${pool > 0 ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
          Pool ({pool})
        </span>
        <span className="text-gray-400">&rarr;</span>
        <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">
          Archive ({archive})
        </span>
        <span className="text-gray-400">|</span>
        <span className="px-2 py-1 rounded bg-gray-100 text-gray-500">
          Trash ({trash})
        </span>
      </div>
    </div>
  );
}
