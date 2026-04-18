/**
 * Dashboard page — single scrollable overview of the box.
 */

import { useState } from "react";
import { useSSE } from "../hooks/useSSE";
import { getEventSourceBase } from "../api";
import { trpc } from "../lib/trpc";
import { HeaderStrip } from "../components/dashboard/HeaderStrip";
import { AttentionCards } from "../components/dashboard/AttentionCards";
import { ScheduleOverview } from "../components/dashboard/ScheduleOverview";
import { RecentActivity } from "../components/dashboard/RecentActivity";
import { NewsPipelineStatus } from "../components/dashboard/NewsPipelineStatus";
import { SystemInfo } from "../components/dashboard/SystemInfo";
import { HealthWarnings } from "../components/dashboard/HealthWarnings";
import { ActionModal, type ActionType } from "../components/dashboard/ActionModal";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";

export function DashboardPage() {
  const [activeAction, setActiveAction] = useState<ActionType>(null);

  const utils = trpc.useUtils();
  const statusQuery = trpc.status.status.useQuery();
  const healthQuery = trpc.health.check.useQuery();
  const schedulesQuery = trpc.scheduler.schedules.useQuery();
  const ticksQuery = trpc.scheduler.log.useQuery({ limit: 20, event: "tick" });
  const commitsQuery = trpc.status.activity.useQuery({ count: 15 });
  const questionsQuery = trpc.status.questions.useQuery();
  const newsStatusQuery = trpc.status.newsStatus.useQuery();

  const invalidateAll = () => {
    utils.status.invalidate();
    utils.scheduler.invalidate();
  };

  const { connected } = useSSE(`${getEventSourceBase()}/events`, {
    onEvent: (event) => {
      if (
        event.event === "file-change" ||
        event.event === "question-answered" ||
        event.event === "card-created" ||
        event.event === "wakeup-complete"
      ) {
        invalidateAll();
      }
    },
  });

  const status = statusQuery.data ?? null;
  const schedules = schedulesQuery.data?.schedules ?? [];
  const ticks = ticksQuery.data?.entries ?? [];
  const commits = commitsQuery.data?.entries ?? [];
  const questions = questionsQuery.data?.items ?? [];
  const newsStatus = newsStatusQuery.data ?? { inbox: 0, pool: 0, archive: 0, trash: 0 };

  const schedulesLoading = schedulesQuery.isLoading || ticksQuery.isLoading;
  const schedulesError = schedulesQuery.error || ticksQuery.error;
  const activityLoading = commitsQuery.isLoading || ticksQuery.isLoading;
  const activityError = commitsQuery.error || ticksQuery.error;

  return (
    <Column overflow="hidden" className="h-full">
      <HeaderStrip
        status={status}
        connected={connected}
        onAction={setActiveAction}
      />

      <Column overflow="auto" className="flex-1">
        <Stack gap="lg" className="max-w-4xl mx-auto py-4 px-4">
          <HealthWarnings health={healthQuery.data ?? null} />

          <AttentionCards
            questions={questions}
            inboxCount={status?.counts.inbox ?? 0}
          />

          <ScheduleOverview
            schedules={schedules}
            recentTicks={ticks}
            loading={schedulesLoading}
            error={schedulesError}
          />

          <RecentActivity
            commits={commits}
            ticks={ticks}
            loading={activityLoading}
            error={activityError}
          />

          <NewsPipelineStatus newsStatus={newsStatus} />
        </Stack>
      </Column>

      <SystemInfo status={status} />

      <ActionModal
        action={activeAction}
        onClose={() => setActiveAction(null)}
        onComplete={invalidateAll}
        newsInboxCount={newsStatus.inbox}
        newsPoolCount={newsStatus.pool}
      />
    </Column>
  );
}
