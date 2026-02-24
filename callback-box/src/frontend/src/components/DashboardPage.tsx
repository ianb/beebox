/**
 * Dashboard page — single scrollable overview of the box.
 */

import { useState, useEffect, useCallback } from "react";
import { useSSE } from "../hooks/useSSE";
import {
  getStatus,
  getSchedules,
  getSchedulerLog,
  getLog,
  getQuestions,
  getNewsStatus,
  type StatusResponse,
  type ScheduleInfo,
  type SchedulerLogEntry,
  type LogEntry,
  type CardInfo,
  type NewsStatusResponse,
} from "../api";
import { HeaderStrip } from "./dashboard/HeaderStrip";
import { AttentionCards } from "./dashboard/AttentionCards";
import { ScheduleOverview } from "./dashboard/ScheduleOverview";
import { RecentActivity } from "./dashboard/RecentActivity";
import { NewsPipelineStatus } from "./dashboard/NewsPipelineStatus";
import { SystemInfo } from "./dashboard/SystemInfo";
import { ActionModal, type ActionType } from "./dashboard/ActionModal";

interface DashboardData {
  status: StatusResponse | null;
  schedules: ScheduleInfo[];
  ticks: SchedulerLogEntry[];
  commits: LogEntry[];
  questions: CardInfo[];
  newsStatus: NewsStatusResponse;
}

const EMPTY_DATA: DashboardData = {
  status: null,
  schedules: [],
  ticks: [],
  commits: [],
  questions: [],
  newsStatus: { inbox: 0, pool: 0, archive: 0, trash: 0 },
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [activeAction, setActiveAction] = useState<ActionType>(null);

  const fetchData = useCallback(async () => {
    // Fetch each independently so one failure doesn't block the rest
    const results = await Promise.allSettled([
      getStatus(),
      getSchedules(),
      getSchedulerLog({ limit: 20, event: "tick" }),
      getLog(15),
      getQuestions(),
      getNewsStatus(),
    ]);

    const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === "fulfilled" ? r.value : fallback;

    const emptyNews = { inbox: 0, pool: 0, archive: 0, trash: 0 };

    setData({
      status: val(results[0]!, null),
      schedules: val(results[1]!, { schedules: [] }).schedules,
      ticks: val(results[2]!, { entries: [] }).entries,
      commits: val(results[3]!, { entries: [] }).entries,
      questions: val(results[4]!, { items: [] }).items,
      newsStatus: val(results[5]!, emptyNews),
    });
  }, []);

  const { connected } = useSSE("/api/events", {
    onEvent: (event) => {
      if (
        event.event === "file-change" ||
        event.event === "question-answered" ||
        event.event === "card-created" ||
        event.event === "wakeup-complete"
      ) {
        fetchData();
      }
    },
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const handleActionComplete = () => {
    fetchData();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <HeaderStrip
        status={data.status}
        connected={connected}
        onAction={setActiveAction}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto py-4 px-4 space-y-4">
          <AttentionCards
            questions={data.questions}
            inboxCount={data.status?.counts.inbox ?? 0}
          />

          <ScheduleOverview
            schedules={data.schedules}
            recentTicks={data.ticks}
          />

          <RecentActivity
            commits={data.commits}
            ticks={data.ticks}
          />

          <NewsPipelineStatus newsStatus={data.newsStatus} />
        </div>
      </div>

      <SystemInfo status={data.status} />

      <ActionModal
        action={activeAction}
        onClose={() => setActiveAction(null)}
        onComplete={handleActionComplete}
        newsInboxCount={data.newsStatus.inbox}
        newsPoolCount={data.newsStatus.pool}
      />
    </div>
  );
}
