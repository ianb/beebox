/**
 * Recent activity — interleaved git commits and scheduler events.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import { toSearch } from "../../lib/routing";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import type { RouterOutput } from "../../lib/trpc/client";
import { bbxSource } from "../../lib/source-tag";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { StatusMessage } from "../ui/StatusMessage";
import { phaseTone } from "../history/phase-tone";
import { tickHadActivity } from "./ScheduleTicks";
import { agoOnClock, formatDuration } from "../../lib/relative-time";
import { useBoxNow } from "../../lib/box-clock";

type LogEntry = RouterOutput["status"]["activity"]["entries"][number];
type SchedulerLogEntry = RouterOutput["scheduler"]["log"]["entries"][number];

interface RecentActivityProps {
  commits: LogEntry[];
  ticks: SchedulerLogEntry[];
  loading?: boolean;
  error?: { message: string } | null;
}

type ActivityItem =
  | { type: "commit"; ts: number; data: LogEntry }
  | { type: "tick"; ts: number; data: SchedulerLogEntry };

function CommitRow({ commit }: { commit: LogEntry }) {
  const { boxSlug } = useParams({ strict: false });
  const phase = commit.trailers?.["Phase"];
  return (
    <div className="py-2 flex items-start justify-between gap-2" {...bbxSource("commit", commit.hash)}>
      <div className="min-w-0">
        <div className="text-sm text-warm-900 truncate">
          <Link to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.history}`)} search={toSearch({ viewState: { commit: commit.hash } })} className="hover:text-primary">
            {commit.subject}
          </Link>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-warm-700 font-mono">
            {commit.hash.substring(0, 7)}
          </span>
          {phase ? (
            <Badge tone={phaseTone(phase)} size="sm">{phase}</Badge>
          ) : null}
        </div>
      </div>
      <span className="text-xs text-warm-700 whitespace-nowrap">
        {agoOnClock(commit.date, "box")}
      </span>
    </div>
  );
}

/**
 * Colour and glyph for one script's outcome. `inconclusive` gets neither the
 * green of a pass nor the red of a failure: its work ran and nothing judged
 * it, and colouring it as success is the misreading the whole outcome exists
 * to prevent.
 */
function scriptStatusStyle(status: NonNullable<SchedulerLogEntry["result"]>["scripts"][number]["status"]): {
  className: string;
  glyph: string;
  title: string;
} {
  if (status === "error") return { className: "text-danger-dark", glyph: "", title: "Failed" };
  if (status === "inconclusive") {
    return {
      className: "text-warm-700",
      glyph: "? ",
      title: "Inconclusive — work ran; the check reached no verdict",
    };
  }
  return { className: "text-success", glyph: "", title: "Ran" };
}

function TickRow({ tick }: { tick: SchedulerLogEntry }) {
  const scripts = tick.result?.scripts.filter((s) => s.status !== "skipped") ?? [];
  return (
    <div className="py-2 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-sm text-warm-700">
          <Badge tone="info" size="sm" className="mr-1">tick</Badge>
          {scripts.map((s, si) => {
            const style = scriptStatusStyle(s.status);
            return (
              <span
                key={`${s.name}-${si}`}
                className={`text-xs mr-1 ${style.className}`}
                title={style.title}
              >
                {style.glyph}
                {s.name}
                {s.durationMs != null ? (
                  <span className="text-warm-700 ml-0.5">
                    {formatDuration(s.durationMs)}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
      <span className="text-xs text-warm-700 whitespace-nowrap">
        {agoOnClock(tick.ts, "real")}
      </span>
    </div>
  );
}

export function RecentActivity({ commits, ticks, loading, error }: RecentActivityProps) {
  const { boxSlug } = useParams({ strict: false });
  // Re-render each minute so the ages in the rows stay current.
  useBoxNow(60_000);
  // Only include ticks that had activity — an unjudged run is activity.
  const activeTicks = ticks.filter(tickHadActivity);

  // Merge and sort by timestamp
  const items: ActivityItem[] = [
    ...commits.map((c): ActivityItem => ({
      type: "commit",
      ts: new Date(c.date).getTime(),
      data: c,
    })),
    ...activeTicks.map((t): ActivityItem => ({
      type: "tick",
      ts: new Date(t.ts).getTime(),
      data: t,
    })),
  ];

  items.sort((a, b) => b.ts - a.ts);

  const display = items.slice(0, 15);

  return (
    <Card as="section" aria-label="Recent activity" shadow border="none">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-warm-700">Recent Activity</h2>
        <Link id="bbx-dashboard-all-history" to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.history}`)} className="text-xs text-primary hover:text-primary-dark">
          All history &rarr;
        </Link>
      </div>

      {loading ? (
        <StatusMessage>Loading...</StatusMessage>
      ) : error ? (
        <p className="text-sm text-danger-dark">Failed to load: {error.message}</p>
      ) : display.length === 0 ? (
        <p className="text-sm text-warm-700">No recent activity</p>
      ) : (
        <div className="divide-y divide-warm-200">
          {display.map((item, i) =>
            item.type === "commit" ? (
              <CommitRow key={`c-${item.data.hash}`} commit={item.data} />
            ) : (
              <TickRow key={`t-${i}`} tick={item.data} />
            ),
          )}
        </div>
      )}
    </Card>
  );
}
