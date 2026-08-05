/**
 * Dashboard page — single scrollable overview of the box.
 */

import { useBusSubscription } from "../hooks/useBusSubscription";
import { useState } from "react";
import { errorMessage } from "@shared/error-guards";
import { trpc, trpcClient } from "../lib/trpc";
import { HeaderStrip } from "../components/dashboard/HeaderStrip";
import { AttentionCards } from "../components/dashboard/AttentionCards";
import { ScheduleOverview } from "../components/dashboard/ScheduleOverview";
import { RecentActivity } from "../components/dashboard/RecentActivity";
import { SystemInfo } from "../components/dashboard/SystemInfo";
import { HealthWarnings } from "../components/dashboard/HealthWarnings";
import { OpsLinks } from "../components/dashboard/OpsLinks";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { useCurrentUser } from "../hooks/useCurrentUser";

export function DashboardPage() {
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();
  const [growthAcceptanceError, setGrowthAcceptanceError] = useState<string | null>(null);
  const statusQuery = trpc.status.status.useQuery();
  const healthQuery = trpc.health.check.useQuery();
  const acceptBoxGrowth = trpc.health.acceptBoxGrowth.useMutation();
  const schedulesQuery = trpc.scheduler.schedules.useQuery();
  const ticksQuery = trpc.scheduler.log.useQuery({ limit: 20, event: "tick" });
  const commitsQuery = trpc.status.activity.useQuery({ count: 15 });
  const questionsQuery = trpc.status.questions.useQuery();

  const invalidateAll = () => {
    void utils.status.invalidate();
    void utils.scheduler.invalidate();
  };

  const { connected } = useBusSubscription({
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

  const schedulesLoading = schedulesQuery.isLoading || ticksQuery.isLoading;
  const schedulesError = schedulesQuery.error || ticksQuery.error;
  const activityLoading = commitsQuery.isLoading || ticksQuery.isLoading;
  const activityError = commitsQuery.error || ticksQuery.error;

  async function acceptCurrentGrowth(): Promise<void> {
    setGrowthAcceptanceError(null);
    try {
      await acceptBoxGrowth.mutateAsync();
      // Do not invalidate into an older in-flight snapshot. Force a live read,
      // then put that exact result into the normal dashboard query cache.
      const health = await trpcClient.health.check.query({ fresh: true });
      utils.health.check.setData(undefined, health);
    } catch (error) {
      setGrowthAcceptanceError(errorMessage(error));
    }
  }

  return (
    <Column overflow="hidden" className="h-full">
      <HeaderStrip
        status={status}
        connected={connected}
      />

      <Column overflow="auto" className="flex-1">
        <Stack gap="lg" className="w-full min-w-0 max-w-4xl mx-auto py-4 px-4">
          <OpsLinks />

          <HealthWarnings
            health={healthQuery.data ?? null}
            canAcceptBoxGrowth={currentUser?.isOwner === true}
            acceptingBoxGrowth={acceptBoxGrowth.isPending}
            acceptanceError={growthAcceptanceError}
            onAcceptBoxGrowth={acceptCurrentGrowth}
          />

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
        </Stack>
      </Column>

      <SystemInfo status={status} version={healthQuery.data?.version ?? null} />
    </Column>
  );
}
